"use strict";

import { config } from "../config/index.js";
import { parsearReporte, convertirTimestamp, obtenerBloqueYHoraActivo } from "../utils/parser.js";
import { obtenerNombreRemitente, reaccionar } from "../utils/telegram.js";
import { validarMunicipioNodo } from "../services/validation.js";
import { calcularAcumulacion } from "../utils/accumulation.js";
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
    } else {
      console.warn(`[ADVERTENCIA] No se encontró fila con Mensaje ID: ${messageId} para eliminar.`);
    }
  } catch (error) {
    console.error("[ERROR] No se pudo eliminar el registro de Google Sheets:", error);
  }
}

/**
 * Marca una fila en Google Sheets en estado de revisión si el reporte editado es inválido.
 * @param {object} [doc] - Instancia de GoogleSpreadsheet ya cargada (opcional).
 * @param {number|string} messageId
 */
async function marcarFilaParaRevision(doc, messageId) {
  try {
    const documento = doc || await obtenerHojaDeCalculo();
    const hoja = documento.sheetsByIndex[0];
    const filas = await hoja.getRows();
    const fila = buscarFilaPorMensaje(filas, messageId);
    if (fila) {
      const estadoActual = fila.get(COLUMNAS.ESTADO) || "";
      if (!estadoActual.startsWith("Revisión desde:")) {
        const ahoraIso = new Date().toISOString();
        fila.set(COLUMNAS.ESTADO, `Revisión desde: ${ahoraIso}`);
        await fila.save();
        console.log(`[INFO] Fila marcada para revisión (Mensaje ID: ${messageId}).`);
      }
    }
  } catch (error) {
    console.error("[ERROR] No se pudo marcar la fila para revisión:", error);
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

  const mensajeObj = ctx.message || ctx.editedMessage;
  const esEdicion = !!ctx.editedMessage;
  const creationTimestamp = mensajeObj?.date || Math.floor(Date.now() / 1000);
  const editTimestamp = mensajeObj?.edit_date || creationTimestamp;

  let timestamp = creationTimestamp;
  let tiempoFinal = tiempo;

  if (esEdicion) {
    const diffMins = (editTimestamp - creationTimestamp) / 60;
    const holgura = config.app.reportEditGracePeriodMins;

    if (diffMins > holgura) {
      console.log(`[INFO] Reporte editado después de la holgura (${Math.round(diffMins)} min > ${holgura} min). Usando fecha de edición para el bloque.`);
      timestamp = editTimestamp;
      tiempoFinal = convertirTimestamp(timestamp);
    } else {
      console.log(`[INFO] Reporte editado dentro de la holgura (${Math.round(diffMins)} min <= ${holgura} min). Usando fecha de creación original.`);
    }
  }

  const { fecha, hora } = tiempoFinal;

  // 1. Obtener la hora y bloque activo en hora de Venezuela
  const { horaStr, bloqueActivo, bloqueStr } = obtenerBloqueYHoraActivo(timestamp);
  console.log(`[INFO] Mensaje procesado a las ${horaStr} (Hora VE). Bloque Activo: ${bloqueStr}.`);

  const doc = await obtenerHojaDeCalculo();

  // 2. Validar Municipio y Nodo contra catálogo oficial (verificadores_nodo)
  const { valido, limiteVerificadores, municipioOficial } = await validarMunicipioNodo(doc, municipio, nodo);
  if (!valido) {
    console.warn(
      `\n┌── ⚠️ VALIDACIÓN FALLIDA ───────────────────────────────┐` +
      `\n│ Municipio y/o Nodo inválidos. El reporte no existe en  │` +
      `\n│ la base de datos oficial.                              │` +
      `\n│    • Municipio parsed:   ${municipio}` +
      `\n│    • Nodo parsed:        ${nodo}` +
      `\n└────────────────────────────────────────────────────────┘\n`
    );
    if (esEdicion) {
      await marcarFilaParaRevision(doc, messageId);
    }
    await reaccionar(ctx, "👎");
    return;
  }

  // 3. Cargar hoja principal e historial del mismo día
  const hoja = doc.sheetsByIndex[0];
  await asegurarColumnas(hoja);

  const filas = await hoja.getRows();

  // Buscar si ya existe un reporte para esta combinación de municipio+nodo hoy
  const filaExistente = filas.find(fila => {
    const mun = (fila.get(COLUMNAS.MUNICIPIO) || "").trim().toLowerCase();
    const nod = parseInt(fila.get(COLUMNAS.NODO) || "0", 10);
    const fec = (fila.get(COLUMNAS.FECHA) || "").trim();
    return mun === municipioOficial.toLowerCase() && nod === nodo && fec === fecha;
  }) || null;

  // Si ya existe una fila para hoy, el historial son sus valores actuales
  const historial = filaExistente ? {
    b1: parseInt(filaExistente.get(COLUMNAS.BLOQUE_1) || "0", 10),
    b2: parseInt(filaExistente.get(COLUMNAS.BLOQUE_2) || "0", 10),
    b3: parseInt(filaExistente.get(COLUMNAS.BLOQUE_3) || "0", 10),
    total: parseInt(filaExistente.get(COLUMNAS.TOTAL_VERIFICADORES) || "0", 10)
  } : { b1: 0, b2: 0, b3: 0, total: 0 };

  // 4. Calcular la acumulación de verificadores por bloque e histórico del mismo día
  const { b1Final, b2Final, b3Final } = calcularAcumulacion(bloqueActivo, reporte, historial);

  const totalFinal = Math.max(totalVerificadores || 0, b1Final, b2Final, b3Final);

  // 6. Validar capacidad máxima de verificadores permitida
  if (totalFinal > limiteVerificadores) {
    console.warn(
      `\n┌── ⚠️ VALIDACIÓN FALLIDA ───────────────────────────────┐` +
      `\n│ Exceso de verificadores en nodo.                      │` +
      `\n│    • Municipio:          ${municipioOficial}` +
      `\n│    • Nodo:               ${nodo}` +
      `\n│    • Reportados:         ${totalFinal}` +
      `\n│    • Límite Permitido:   ${limiteVerificadores}` +
      `\n└────────────────────────────────────────────────────────┘\n`
    );
    if (esEdicion) {
      await marcarFilaParaRevision(doc, messageId);
    }
    await reaccionar(ctx, "👎");
    return;
  }

  console.log(
    `\n┌── 📊 LOG DE DATOS & LÓGICA DE GUARDADO ────────────────┐` +
    `\n│ 📥 DATOS PARSEADOS DESDE EL MENSAJE:` +
    `\n│    • Municipio:          ${municipioOficial}` +
    `\n│    • Nodo:               ${nodo}` +
    `\n│    • Total Verif. Msg:   ${totalVerificadores}` +
    `\n│    • B1 (9am) Msg:       ${bloque1}` +
    `\n│    • B2 (2pm) Msg:       ${bloque2}` +
    `\n│    • B3 (6pm) Msg:       ${bloque3}` +
    `\n│` +
    `\n│ 🕒 ANÁLISIS DE TIEMPO & BLOQUES:` +
    `\n│    • Hora Recibido (VE): ${horaStr}` +
    `\n│    • Bloque Activo:      ${bloqueStr.toUpperCase()}` +
    `\n│    • Valor Reportado:    ${bloque1 || bloque2 || bloque3 || totalVerificadores || 0}` +
    `\n│` +
    `\n│ 📜 VALORES PREVIOS EN BASE DE DATOS (HISTORIAL):` +
    `\n│    • Prev B1 (9am):      ${historial.b1}` +
    `\n│    • Prev B2 (2pm):      ${historial.b2}` +
    `\n│    • Prev B3 (6pm):      ${historial.b3}` +
    `\n│    • Prev Total:         ${historial.total}` +
    `\n│` +
    `\n│ 💾 VALORES RESULTANTES A GUARDAR EN SHEET:` +
    `\n│    • Final B1 (9am):     ${b1Final}` +
    `\n│    • Final B2 (2pm):     ${b2Final}` +
    `\n│    • Final B3 (6pm):     ${b3Final}` +
    `\n│    • Final Total:        ${totalFinal}` +
    `\n└────────────────────────────────────────────────────────┘\n`
  );

  const datos = {
    [COLUMNAS.MUNICIPIO]:           municipioOficial,
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
    [COLUMNAS.ESTADO]:              "OK",
  };

  if (filaExistente) {
    filaExistente.assign(datos);
    await filaExistente.save();
    console.log(`[INFO] Fila actualizada (Mensaje ID: ${messageId}).`);
  } else {
    await hoja.addRow(datos);
    console.log(`[INFO] Nueva fila insertada (Mensaje ID: ${messageId}).`);
  }

  await reaccionar(ctx, "👍");
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
    if (!texto.toLowerCase().includes(config.app.reportKeyword.toLowerCase())) {
      if (esEdicion) {
        await marcarFilaParaRevision(null, messageId);
      }
      return;
    }

    // ── 3. Parsear datos del reporte ────────────────────────────
    const reporte = parsearReporte(texto);
    if (!reporte) {
      console.warn("[ADVERTENCIA] Palabra clave encontrada pero no se pudo parsear el reporte.");
      if (esEdicion) {
        await marcarFilaParaRevision(null, messageId);
      }
      await reaccionar(ctx, "👎");
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
