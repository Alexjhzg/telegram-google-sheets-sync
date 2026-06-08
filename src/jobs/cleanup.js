"use strict";

import { Cron } from "croner";
import { config } from "../config/index.js";
import {
  obtenerHojaDeCalculo,
  COLUMNAS,
  resetearFila,
  resetearFilasDeDiasAnteriores,
  guardarHistoricoDiario,
  sheetsMutex,
} from "../services/sheets.js";
import { ordenarYLimpiarHojaPrincipal } from "../services/sheets.business.js";
import { enviarReporteDiario } from "../services/reporting.js";
import { enviarAvisoCierre, enviarAvisoNodosFaltantes } from "../services/notifications.js";


/**
 * Verifica si un mensaje de Telegram sigue existiendo intentando
 * llamar a editMessageReplyMarkup con una lista vacía (operación no destructiva).
 *
 * @param {import("grammy").Api} api - API de Telegram.
 * @param {number} chatId
 * @param {number} messageId
 * @returns {Promise<boolean>} `true` si el mensaje existe, `false` si fue borrado.
 */
async function mensajeExiste(api, chatId, messageId) {
  try {
    // Como el mensaje fue enviado por un usuario (y no por el bot), si el mensaje existe
    // esta llamada FALLARÁ con "message can't be edited". Si fue borrado, fallará con
    // "message to edit not found". Esto nos permite verificar 100% silenciosamente.
    await api.editMessageReplyMarkup(chatId, messageId, { reply_markup: { inline_keyboard: [] } });
    return true;
  } catch (error) {
    const desc = (error.description || "").toLowerCase();

    if (
      desc.includes("message to edit not found") ||
      desc.includes("message_id_invalid") ||
      desc.includes("message not found")
    ) {
      return false;
    }

    if (
      desc.includes("message can't be edited") ||
      desc.includes("message is not modified")
    ) {
      return true;
    }

    // Otro error (rate-limit, permisos…): asumir que existe para no borrar datos válidos.
    console.warn(`[ADVERTENCIA] No se pudo verificar Mensaje ID ${messageId} en Chat ${chatId}: ${error.message}`);
    return true;
  }
}

/**
 * Recorre las filas de Google Sheets que tengan un ID de mensaje registrado
 * y resetea aquellas cuyo mensaje ya no exista en Telegram o lleven más de
 * 5 minutos en estado de revisión.
 *
 * @param {import("grammy").Api} api - API de Telegram para verificar mensajes.
 * @param {number} limiteFilas - Límite de filas más recientes a analizar.
 */
export async function ejecutarLimpieza(api, limiteFilas = 15) {
  return sheetsMutex.runExclusive(async () => {
    console.log(`[INFO] Iniciando limpieza de mensajes eliminados en Telegram (límite: ${limiteFilas} filas)...`);
    try {
      const doc   = await obtenerHojaDeCalculo();
      const hoja  = doc.sheetsByTitle["registros_telegram"];
      const filas = await hoja.getRows();

      let eliminados = 0;
      let analizados = 0;

      // Iteramos en orden inverso para que los índices de Google Sheets no se desplacen
      // cuando eliminamos una fila intermedia.
      for (let i = filas.length - 1; i >= 0; i--) {
        const fila      = filas[i];
        const obj       = fila.toObject();
        const messageId = parseInt(obj[COLUMNAS.ID_MENSAJE], 10);
        const chatId    = parseInt(obj[COLUMNAS.ID_CHAT], 10);

        if (isNaN(messageId) || isNaN(chatId)) continue;

        analizados++;
        if (analizados > limiteFilas) {
          console.log(`[INFO] Se alcanzó el límite de seguridad de ${limiteFilas} filas analizadas. Finalizando escaneo.`);
          break;
        }

        // Comprobar si la fila lleva más de 5 minutos en estado de revisión
        const estado = obj[COLUMNAS.ESTADO] || "";
        let debeBorrarse = false;

        if (estado.startsWith("Revisión desde:")) {
          const timestampRevision = new Date(estado.replace("Revisión desde:", "").trim()).getTime();
          if (!isNaN(timestampRevision)) {
            const transcurridoMins = (Date.now() - timestampRevision) / 1000 / 60;
            if (transcurridoMins >= 5) {
              console.log(`[INFO] Fila en REVISIÓN superó el tiempo de gracia de 5 min (${Math.round(transcurridoMins)} min). Reseteando...`);
              debeBorrarse = true;
            }
          }
        }

        const existe = debeBorrarse ? false : await mensajeExiste(api, chatId, messageId);

        if (!existe) {
          if (!debeBorrarse) {
            console.log(`[INFO] Mensaje eliminado en Telegram (Chat: ${chatId}, ID: ${messageId}). Reseteando fila...`);
          }
          await resetearFila(fila);
          eliminados++;
        }

        // Respetar los límites de velocidad de la API de Telegram
        await new Promise((r) => setTimeout(r, config.app.cleanupRequestDelayMs));
      }

      console.log(
        eliminados > 0
          ? `[INFO] Limpieza finalizada: ${eliminados} fila(s) reseteada(s).`
          : "[INFO] Limpieza finalizada: no se detectaron mensajes borrados."
      );
    } catch (error) {
      console.error("[ERROR] Falló la ejecución de la limpieza:", error);
    }
  });
}

/**
 * Registra y activa todos los cron jobs del sistema.
 * Responsabilidad única: planificación temporal de tareas.
 *
 * @param {import("grammy").Api} api
 */
export function programarLimpieza(api) {
  // 1. Limpieza inicial al arrancar el bot
  setTimeout(() => ejecutarLimpieza(api, 60), config.app.cleanupInitialDelayMs);

  // 2. Limpieza periódica continua (cada 5 minutos)
  new Cron("*/5 * * * *", { timezone: "America/Caracas" }, () => ejecutarLimpieza(api, 60));

  // 3. Limpieza de precisión en las horas de corte (9am, 2pm, 6pm)
  const jobCortes = new Cron("0 9,14,18 * * *", { timezone: "America/Caracas" }, () => ejecutarLimpieza(api, 60));

  // 4. Reseteo diario a la medianoche + ordenamiento y saneamiento de la hoja
  new Cron("0 0 * * *", { timezone: "America/Caracas" }, async () => {
    await sheetsMutex.runExclusive(async () => {
      console.log("[INFO] Iniciando reseteo diario de medianoche...");
      try {
        const doc = await obtenerHojaDeCalculo();
        await resetearFilasDeDiasAnteriores(doc);
        await ordenarYLimpiarHojaPrincipal(doc);
      } catch (err) {
        console.error("[ERROR] Fallo en el reseteo diario de medianoche:", err);
      }
    });
  });

  // 5. Reportes consolidados por cortes
  const jobReporte9am = new Cron("5 9 * * *",  { timezone: "America/Caracas" }, () => enviarReporteDiario(api, 1));
  const jobReporte2pm = new Cron("5 14 * * *", { timezone: "America/Caracas" }, () => enviarReporteDiario(api, 2));
  /* eslint-disable-next-line no-unused-vars */
  const jobReporte6pm = new Cron("5 18 * * *", { timezone: "America/Caracas" }, () => enviarReporteDiario(api, 3));

  // 6. Avisos de cierre de bloque
  new Cron("0 9 * * *",  { timezone: "America/Caracas" }, () => enviarAvisoCierre(api, 1));
  new Cron("0 14 * * *", { timezone: "America/Caracas" }, () => enviarAvisoCierre(api, 2));
  new Cron("0 18 * * *", { timezone: "America/Caracas" }, () => enviarAvisoCierre(api, 3));

  // 7. Alerta de nodos sin reporte a las 6:06 PM
  new Cron("6 18 * * *", { timezone: "America/Caracas" }, () => enviarAvisoNodosFaltantes(api));

  // 8. Resguardo histórico diario a las 11:00 PM
  const jobHistorico = new Cron("0 23 * * *", { timezone: "America/Caracas" }, async () => {
    await sheetsMutex.runExclusive(async () => {
      console.log("[INFO] Iniciando resguardo de historial diario a las 11:00 PM VET...");
      try {
        const doc = await obtenerHojaDeCalculo();
        await guardarHistoricoDiario(doc);
      } catch (err) {
        console.error("[ERROR] Fallo al guardar el historial diario:", err);
      }
    });
  });

  // ── Logs informativos sobre los próximos disparos ────────────────────────
  const fmtTime = { timeZone: "America/Caracas", hour: "2-digit", minute: "2-digit" };
  const fmtFull = { timeZone: "America/Caracas", weekday: "long", hour: "2-digit", minute: "2-digit" };

  console.log(`[INFO] Limpieza horaria activa. Siguiente corte a las ${jobCortes.nextRun().toLocaleTimeString("es-VE", fmtTime)} (VET).`);
  console.log(`[INFO] Reporte diario activo. Siguiente envío el ${jobReporte9am.nextRun().toLocaleDateString("es-VE", fmtFull)} (VET).`);
  console.log(`[INFO] Historial diario activo. Siguiente guardado el ${jobHistorico.nextRun().toLocaleDateString("es-VE", fmtFull)} (VET).`);
}
