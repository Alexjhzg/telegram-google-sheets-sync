"use strict";

import { config } from "../config/index.js";
import { parsearReporte, convertirTimestamp } from "../utils/parser.js";
import {
  obtenerHojaDeCalculo,
  asegurarColumnas,
  buscarFilaPorMensaje,
  obtenerUltimosValores,
  COLUMNAS,
} from "../services/sheets.js";

// Regex que detecta si un mensaje contiene una solicitud de eliminación manual
const REGEX_ELIMINAR = /\b(?:eliminar|borrar|eliminado|borrado)\b/i;

/**
 * Obtiene el nombre del remitente de forma legible.
 *
 * Caso especial: cuando un admin publica de forma anónima en un grupo,
 * Telegram usa el bot "GroupAnonymousBot" (ID 1087968824) como remitente.
 * En ese caso intentamos usar la firma del autor (author_signature) o
 * el título del chat como identificador alternativo.
 *
 * @param {import("grammy").Context} ctx
 * @returns {string}
 */
function obtenerNombreRemitente(ctx) {
  const from = ctx.from;

  // Admin anónimo de grupo (GroupAnonymousBot)
  if (from?.id === 1087968824) {
    const mensajeObj = ctx.message || ctx.editedMessage;
    // author_signature: nombre que pone el admin cuando publica anónimamente
    if (mensajeObj?.author_signature) return mensajeObj.author_signature;
    // Fallback: título del grupo con etiqueta
    const titulo = ctx.chat?.title;
    return titulo ? `Admin de ${titulo}` : "Admin Anónimo";
  }

  return (
    [from?.first_name, from?.last_name].filter(Boolean).join(" ") ||
    from?.username ||
    "Desconocido"
  );
}


/**
 * Intenta agregar una reacción al mensaje, sin lanzar error si el chat
 * no permite reacciones (REACTION_INVALID u otros).
 * @param {import("grammy").Context} ctx
 * @param {string} emoji
 */
async function reaccionar(ctx, emoji) {
  try {
    await ctx.react(emoji);
  } catch {
    // Las reacciones son opcionales — si el grupo las tiene restringidas, se ignora.
  }
}

/**
 * Maneja la solicitud de eliminación de un registro desde Telegram.
 * El usuario edita su mensaje a "eliminar" para borrar la fila de Sheets.
 *
 * @param {import("grammy").Context} ctx
 * @param {number} messageId
 */
async function manejarEliminacion(ctx, messageId) {
  console.log(`[INFO] Solicitud de eliminación detectada — Mensaje ID: ${messageId}`);
  try {
    const doc  = await obtenerHojaDeCalculo();
    const hoja = doc.sheetsByIndex[0];
    const fila = buscarFilaPorMensaje(await hoja.getRows(), messageId);

    if (fila) {
      await fila.delete();
      console.log(`[INFO] Fila eliminada de Google Sheets (Mensaje ID: ${messageId}).`);
      await reaccionar(ctx, "🗑️");
    } else {
      console.warn(`[ADVERTENCIA] No se encontró fila con Mensaje ID: ${messageId} para eliminar.`);
    }
  } catch (error) {
    console.error("[ERROR] No se pudo eliminar el registro de Google Sheets:", error);
  }
}

/**
 * Maneja la inserción o actualización de un reporte en Google Sheets,
 * preservando los valores históricos no-cero cuando el reporte actual trae 0.
 *
 * @param {import("grammy").Context} ctx
 * @param {object} reporte - Datos parseados del mensaje.
 * @param {{ fecha: string, hora: string }} tiempo
 * @param {string} remitente
 * @param {number} messageId
 */
async function guardarReporte(ctx, reporte, tiempo, remitente, messageId) {
  const { municipio, nodo, totalVerificadores, bloque1, bloque2, bloque3 } = reporte;
  const { fecha, hora } = tiempo;

  const doc  = await obtenerHojaDeCalculo();
  const hoja = doc.sheetsByIndex[0];
  await asegurarColumnas(hoja);

  const filas        = await hoja.getRows();
  const filaExistente = buscarFilaPorMensaje(filas, messageId);
  const historial    = obtenerUltimosValores(filas, municipio, nodo, filaExistente);

  // Preservar valores históricos si el nuevo reporte trae 0
  const totalFinal = totalVerificadores || historial.total;
  const b1Final    = bloque1 || historial.b1;
  const b2Final    = bloque2 || historial.b2;
  const b3Final    = bloque3 || historial.b3;

  if (totalFinal !== totalVerificadores) console.log(`[INFO] Preservando Total Verificadores anterior: ${historial.total}`);
  if (b1Final    !== bloque1)            console.log(`[INFO] Preservando Bloque 1 (9am) anterior: ${historial.b1}`);
  if (b2Final    !== bloque2)            console.log(`[INFO] Preservando Bloque 2 (2pm) anterior: ${historial.b2}`);
  if (b3Final    !== bloque3)            console.log(`[INFO] Preservando Bloque 3 (6pm) anterior: ${historial.b3}`);

  const datos = {
    [COLUMNAS.MUNICIPIO]:           municipio.trim(),
    [COLUMNAS.NODO]:                nodo,
    [COLUMNAS.TOTAL_VERIFICADORES]: totalFinal,
    [COLUMNAS.BLOQUE_1]:            b1Final,
    [COLUMNAS.BLOQUE_2]:            b2Final,
    [COLUMNAS.BLOQUE_3]:            b3Final,
    [COLUMNAS.FECHA]:               fecha,
    [COLUMNAS.HORA]:                hora,
    [COLUMNAS.REMITENTE]:           remitente,
    [COLUMNAS.ID_MENSAJE]:          String(messageId),
    [COLUMNAS.ID_CHAT]:             String(ctx.chat.id),
  };

  if (filaExistente) {
    filaExistente.assign(datos);
    await filaExistente.save();
    console.log(`[INFO] Fila actualizada (Mensaje ID: ${messageId}).`);
  } else {
    await hoja.addRow(datos);
    console.log(`[INFO] Nueva fila insertada (Mensaje ID: ${messageId}).`);
  }

  await reaccionar(ctx, "✅");
}

/**
 * Registra el handler principal de mensajes (nuevos y editados) en el bot.
 * @param {import("grammy").Bot} bot
 */
export function registrarHandlers(bot) {
  bot.on(["message:text", "edited_message:text"], async (ctx) => {
    const mensajeObj = ctx.message || ctx.editedMessage;
    if (!mensajeObj) return;

    const texto      = mensajeObj.text;
    const messageId  = mensajeObj.message_id;
    const esEdicion  = !!ctx.editedMessage;
    const remitente  = obtenerNombreRemitente(ctx);

    console.log(
      `\n=== ${esEdicion ? "MENSAJE EDITADO" : "NUEVO MENSAJE"} ===` +
      `\nDe: ${remitente} (@${ctx.from?.username ?? "sin_usuario"} | ID: ${ctx.from?.id})` +
      `\nChat: ${ctx.chat.id} | Mensaje ID: ${messageId}` +
      `\n${texto}` +
      `\n=============================\n`
    );

    // ── 1. Verificar si es una solicitud de eliminación manual ──
    if (REGEX_ELIMINAR.test(texto)) {
      await manejarEliminacion(ctx, messageId);
      return;
    }

    // ── 2. Filtrar por palabra clave de reporte ─────────────────
    if (!texto.toLowerCase().includes(config.app.reportKeyword.toLowerCase())) return;

    // ── 3. Parsear datos del reporte ────────────────────────────
    const reporte = parsearReporte(texto);
    if (!reporte) {
      console.warn("[ADVERTENCIA] Palabra clave encontrada pero no se pudo parsear el reporte.");
      return;
    }

    const tiempo = convertirTimestamp(mensajeObj.date);
    console.log("[INFO] Reporte parseado:", { ...reporte, ...tiempo, remitente });

    // ── 4. Persistir en Google Sheets ───────────────────────────
    try {
      await guardarReporte(ctx, reporte, tiempo, remitente, messageId);
    } catch (error) {
      console.error("[ERROR] Falló la persistencia en Google Sheets:", error);
      throw error; // Propagado al bot.catch() global
    }
  });
}
