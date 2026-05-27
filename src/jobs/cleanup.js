import { Cron } from "croner";
import { config } from "../config/index.js";
import { obtenerHojaDeCalculo, COLUMNAS, buscarFilaPorMensaje, resetearFila, resetearFilasDeDiasAnteriores } from "../services/sheets.js";

/**
 * Verifica si un mensaje de Telegram sigue existiendo intentando
 * llamar a setMessageReaction con una lista vacía (operación no destructiva).
 *
 * @param {import("grammy").Api} api - API de Telegram.
 * @param {number} chatId
 * @param {number} messageId
 * @returns {Promise<boolean>} `true` si el mensaje existe, `false` si fue borrado.
 */
async function mensajeExiste(api, chatId, messageId) {
  try {
    // Intentamos editar el markup del mensaje con una lista vacía.
    // Como el mensaje fue enviado por un usuario (y no por el bot), si el mensaje existe
    // esta llamada FALLARÁ inmediatamente con el error "message can't be edited" (o "message is not modified").
    // Si el mensaje NO existe (fue borrado), fallará con "message to edit not found".
    // Esto nos permite verificar la existencia de forma 100% silenciosa sin alterar reacciones ni animaciones.
    await api.editMessageReplyMarkup(chatId, messageId, { reply_markup: { inline_keyboard: [] } });
    return true; // Si por alguna razón tiene éxito, el mensaje existe.
  } catch (error) {
    const desc = (error.description || "").toLowerCase();

    // Si el mensaje fue borrado o no existe en el servidor
    if (
      desc.includes("message to edit not found") ||
      desc.includes("message_id_invalid") ||
      desc.includes("message not found")
    ) {
      return false;
    }

    // Si el mensaje SÍ existe pero no tenemos permisos de edición (comportamiento esperado)
    if (
      desc.includes("message can't be edited") ||
      desc.includes("message is not modified")
    ) {
      return true;
    }

    // Otro tipo de error (permisos, rate-limit…): asumir que el mensaje existe para no borrar datos válidos por error.
    console.warn(`[ADVERTENCIA] No se pudo verificar Mensaje ID ${messageId} en Chat ${chatId}: ${error.message}`);
    return true;
  }
}

/**
 * Recorre todas las filas de Google Sheets que tengan un ID de mensaje
 * registrado y elimina aquellas cuyo mensaje ya no exista en Telegram.
 *
 * @param {import("grammy").Api} api - API de Telegram para verificar mensajes.
 * @param {number} limiteFilas - Límite de filas más recientes a analizar para evitar sobrecarga.
 */
export async function ejecutarLimpieza(api, limiteFilas = 15) {
  console.log(`[INFO] Iniciando limpieza de mensajes eliminados en Telegram (límite: ${limiteFilas} filas)...`);
  try {
    const doc   = await obtenerHojaDeCalculo();
    const hoja  = doc.sheetsByIndex[0];
    const filas = await hoja.getRows();

    let eliminados = 0;
    let analizados = 0;
    const MAX_FILAS_ANALIZAR = limiteFilas;

    // Iteramos en orden inverso (de abajo hacia arriba) para evitar que el desfase de
    // índices en Google Sheets afecte a las filas restantes al eliminar registros en bucle.
    for (let i = filas.length - 1; i >= 0; i--) {
      const fila       = filas[i];
      const obj        = fila.toObject();
      const messageId  = parseInt(obj[COLUMNAS.ID_MENSAJE], 10);
      const chatId     = parseInt(obj[COLUMNAS.ID_CHAT], 10);

      // Saltar filas que aún no tienen los campos de rastreo
      if (isNaN(messageId) || isNaN(chatId)) continue;

      analizados++;
      if (analizados > MAX_FILAS_ANALIZAR) {
        console.log(`[INFO] Se alcanzó el límite de seguridad de ${MAX_FILAS_ANALIZAR} filas analizadas. Finalizando escaneo.`);
        break;
      }

      // Verificar si la fila está en revisión y ha superado el tiempo de gracia de 5 minutos
      const estado = obj[COLUMNAS.ESTADO] || "";
      let debeBorrarsePorRevision = false;

      if (estado.startsWith("Revisión desde:")) {
        const timestampStr = estado.replace("Revisión desde:", "").trim();
        const timestampRevision = new Date(timestampStr).getTime();
        if (!isNaN(timestampRevision)) {
          const ahora = Date.now();
          const transcurridoMins = (ahora - timestampRevision) / 1000 / 60;
          if (transcurridoMins >= 5) {
            console.log(`[INFO] Fila en REVISIÓN superó el tiempo de gracia de 5 min (${Math.round(transcurridoMins)} min). Se procederá a borrar.`);
            debeBorrarsePorRevision = true;
          }
        }
      }

      const existe = debeBorrarsePorRevision ? false : await mensajeExiste(api, chatId, messageId);

      if (!existe || debeBorrarsePorRevision) {
        if (!existe && !debeBorrarsePorRevision) {
          console.log(`[INFO] Mensaje eliminado en Telegram (Chat: ${chatId}, ID: ${messageId}). Reseteando fila...`);
        } else if (debeBorrarsePorRevision) {
          console.log(`[INFO] Reporte inválido superó tiempo de revisión (Mensaje ID: ${messageId}). Reseteando fila...`);
        }
        await resetearFila(fila);
        eliminados++;
      }

      // Respetar los límites de velocidad de la API de Telegram
      await new Promise((r) => setTimeout(r, config.app.cleanupRequestDelayMs));
    }

    console.log(
      eliminados > 0
        ? `[INFO] Limpieza finalizada: ${eliminados} fila(s) eliminada(s).`
        : "[INFO] Limpieza finalizada: no se detectaron mensajes borrados."
    );
  } catch (error) {
    console.error("[ERROR] Falló la ejecución de la limpieza:", error);
  }
}

export function programarLimpieza(api) {
  // 1. Limpieza inicial al arrancar el bot (últimas 40 filas)
  setTimeout(() => ejecutarLimpieza(api, 40), config.app.cleanupInitialDelayMs);

  // 2. Limpieza periódica continua (cada 5 minutos, verifica las últimas 40 filas)
  new Cron("*/5 * * * *", { timezone: "America/Caracas" }, () => ejecutarLimpieza(api, 40));

  // 3. Limpieza de precisión exactamente en las horas de corte (9am, 2pm y 6pm de Venezuela, verifica 50 filas)
  const jobCortes = new Cron("0 9,14,18 * * *", { timezone: "America/Caracas" }, () => ejecutarLimpieza(api, 50));

  // 4. Limpieza diaria a la medianoche (00:00) para vaciar/resetear los reportes del día anterior
  new Cron("0 0 * * *", { timezone: "America/Caracas" }, async () => {
    console.log("[INFO] Iniciando reseteo diario de medianoche para registros del día anterior...");
    try {
      const doc = await obtenerHojaDeCalculo();
      await resetearFilasDeDiasAnteriores(doc);
    } catch (err) {
      console.error("[ERROR] Fallo en el reseteo diario de medianoche:", err);
    }
  });

  // Loguear de forma legible cuándo será el próximo corte real
  const proximaFecha = jobCortes.nextRun();
  const proximoCorteStr = proximaFecha.toLocaleTimeString("es-VE", {
    timeZone: "America/Caracas",
    hour: "2-digit",
    minute: "2-digit",
  });
  console.log(`[INFO] Limpieza horaria activa. Siguiente corte a las ${proximoCorteStr} (hora de Venezuela).`);
}
