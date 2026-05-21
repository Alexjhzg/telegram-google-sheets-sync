"use strict";

import { Cron } from "croner";
import { config } from "../config/index.js";
import { obtenerHojaDeCalculo, COLUMNAS } from "../services/sheets.js";

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
    await api.setMessageReaction(chatId, messageId, []);
    return true;
  } catch (error) {
    const desc = (error.description || "").toLowerCase();

    // Si el mensaje fue borrado o no existe, Telegram devuelve MESSAGE_ID_INVALID o message not found
    if (
      desc.includes("message_id_invalid") ||
      desc.includes("message to react not found") ||
      desc.includes("message not found")
    ) {
      return false;
    }

    // REACTION_EMPTY significa que el mensaje SÍ existe, pero intentamos limpiar una reacción
    // que no estaba puesta. Lo tratamos como éxito silencioso para no llenar los logs de advertencias.
    if (desc.includes("reaction_empty")) {
      return true;
    }

    // Otro tipo de error (permisos, rate-limit…): asumir que el mensaje existe
    // para no borrar datos válidos por error.
    console.warn(`[ADVERTENCIA] No se pudo verificar Mensaje ID ${messageId} en Chat ${chatId}: ${error.message}`);
    return true;
  }
}

/**
 * Recorre todas las filas de Google Sheets que tengan un ID de mensaje
 * registrado y elimina aquellas cuyo mensaje ya no exista en Telegram.
 *
 * @param {import("grammy").Api} api - API de Telegram para verificar mensajes.
 */
export async function ejecutarLimpieza(api) {
  console.log("[INFO] Iniciando limpieza de mensajes eliminados en Telegram...");
  try {
    const doc   = await obtenerHojaDeCalculo();
    const hoja  = doc.sheetsByIndex[0];
    const filas = await hoja.getRows();

    let eliminados = 0;

    // Iteramos en orden inverso (de abajo hacia arriba) para evitar que el desfase de
    // índices en Google Sheets afecte a las filas restantes al eliminar registros en bucle.
    for (let i = filas.length - 1; i >= 0; i--) {
      const fila       = filas[i];
      const obj        = fila.toObject();
      const messageId  = parseInt(obj[COLUMNAS.ID_MENSAJE], 10);
      const chatId     = parseInt(obj[COLUMNAS.ID_CHAT], 10);

      // Saltar filas que aún no tienen los campos de rastreo
      if (isNaN(messageId) || isNaN(chatId)) continue;

      const existe = await mensajeExiste(api, chatId, messageId);

      if (!existe) {
        console.log(`[INFO] Mensaje eliminado en Telegram (Chat: ${chatId}, ID: ${messageId}). Borrando fila...`);
        await fila.delete();
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

/**
 * Programa la limpieza del bot de forma declarativa utilizando Croner.
 *
 * @param {import("grammy").Api} api
 */
export function programarLimpieza(api) {
  const run = () => ejecutarLimpieza(api);

  // 1. Limpieza inicial al arrancar el bot (después de 10s para no bloquear el inicio)
  setTimeout(run, config.app.cleanupInitialDelayMs);

  // 2. Limpieza periódica continua (cada 5 minutos)
  new Cron("*/5 * * * *", { timezone: "America/Caracas" }, run);

  // 3. Limpieza de precisión exactamente en las horas de corte (9am, 2pm y 6pm de Venezuela)
  const jobCortes = new Cron("0 9,14,18 * * *", { timezone: "America/Caracas" }, run);

  // Loguear de forma legible cuándo será el próximo corte real
  const proximaFecha = jobCortes.nextRun();
  const proximoCorteStr = proximaFecha.toLocaleTimeString("es-VE", {
    timeZone: "America/Caracas",
    hour: "2-digit",
    minute: "2-digit",
  });
  console.log(`[INFO] Limpieza horaria activa. Siguiente corte a las ${proximoCorteStr} (hora de Venezuela).`);
}
