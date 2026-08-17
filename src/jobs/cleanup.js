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
import { sincronizarCatalogoDesdeSheets } from "../services/catalogService.js";


/**
 * Verifica de manera segura si un mensaje existe.
 * NOTA: La API de Telegram NO permite a los bots editar ni consultar directamente
 * el estado de mensajes enviados por usuarios en grupos. Para evitar falsos positivos
 * que borren datos válidos de Google Sheets, asumimos que los mensajes válidos existen
 * a menos que el usuario edite explícitamente su mensaje a "eliminar" o esté en estado de revisión expirada.
 *
 * @param {import("grammy").Api} api - API de Telegram.
 * @param {number} chatId
 * @param {number} messageId
 * @returns {Promise<boolean>}
 */
async function mensajeExiste(api, chatId, messageId) {
  // Para evitar que errores de API borren datos aprobados en Google Sheets,
  // asumimos por defecto que el mensaje existe. La eliminación manual está garantizada
  // por el handler de mensajes editados en message.js (REGEX_ELIMINAR).
  return true;
}

/**
 * Verifica si la hora actual en la zona horaria configurada (America/Caracas)
 * se encuentra dentro del horario laboral activo (07:00 AM a 06:30 PM).
 *
 * @returns {boolean} `true` si se encuentra en horario laboral, `false` en caso contrario.
 */
export function esHorarioLaboral() {
  const tz = config.app.timezone || "America/Caracas";
  const now = new Date();

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  let hour = 0;
  let minute = 0;
  for (const part of parts) {
    if (part.type === "hour") hour = parseInt(part.value, 10);
    if (part.type === "minute") minute = parseInt(part.value, 10);
  }
  if (hour === 24) hour = 0;

  const currentMinutes = hour * 60 + minute;
  const startMinutes = (config.app.workStartHour ?? 7) * 60;
  const endMinutes = (config.app.workEndHour ?? 18) * 60 + (config.app.workEndMinute ?? 30);

  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

/**
 * Recorre las filas de Google Sheets que tengan un ID de mensaje registrado
 * y resetea aquellas cuyo mensaje ya no exista en Telegram o lleven más de
 * 5 minutos en estado de revisión.
 *
 * @param {import("grammy").Api} api - API de Telegram para verificar mensajes.
 * @param {number} limiteFilas - Límite de filas más recientes a analizar.
 * @param {boolean} force - Si es `true`, omite la verificación de horario laboral.
 */
export async function ejecutarLimpieza(api, limiteFilas = 15, force = false) {
  if (!force && !esHorarioLaboral()) {
    console.log("[INFO] Limpieza periódica en pausa (fuera del horario laboral 07:00 - 18:30 VET).");
    return;
  }

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
  // 1. Limpieza inicial al arrancar el bot (forzada para garantizar consistencia al encender)
  setTimeout(() => ejecutarLimpieza(api, 60, true), config.app.cleanupInitialDelayMs);

  // 2. Limpieza periódica continua (cada 5 minutos, respetando horario laboral)
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

  // 5. Reportes consolidados de porcentajes por cortes
  const jobReporte9am = new Cron("5 9 * * *",  { timezone: "America/Caracas" }, () => enviarReporteDiario(api, 1));
  const jobReporte2pm = new Cron("5 14 * * *", { timezone: "America/Caracas" }, () => enviarReporteDiario(api, 2));
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

  // 9. Sincronización periódica del catálogo de nodos (Sheets -> SQL) cada 15 minutos
  new Cron("*/15 * * * *", { timezone: "America/Caracas" }, async () => {
    if (esHorarioLaboral()) {
      await sincronizarCatalogoDesdeSheets();
    }
  });

  // ── Logs informativos sobre los próximos disparos ────────────────────────
  const fmtTime = { timeZone: "America/Caracas", hour: "2-digit", minute: "2-digit" };
  const fmtFull = { timeZone: "America/Caracas", weekday: "long", hour: "2-digit", minute: "2-digit" };

  console.log(`[INFO] Limpieza horaria activa. Siguiente corte a las ${jobCortes.nextRun().toLocaleTimeString("es-VE", fmtTime)} (VET).`);
  console.log(`[INFO] Reportes diarios a Gerencia activos (9:05am, 2:05pm, 6:05pm VET). Siguiente envío el ${jobReporte9am.nextRun().toLocaleDateString("es-VE", fmtFull)} (VET).`);
  console.log(`[INFO] Historial diario activo. Siguiente guardado el ${jobHistorico.nextRun().toLocaleDateString("es-VE", fmtFull)} (VET).`);
}
