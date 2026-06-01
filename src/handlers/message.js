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
  buscarFilaPorNodo,
  resetearFila,
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
    const hoja = doc.sheetsByTitle["registros_telegram"];
    const fila = buscarFilaPorMensaje(await hoja.getRows(), messageId);

    if (fila) {
      await resetearFila(fila);
      console.log(`[INFO] Fila reseteada a cero en Google Sheets (Mensaje ID: ${messageId}).`);
    } else {
      console.warn(`[ADVERTENCIA] No se encontró fila con Mensaje ID: ${messageId} para resetear.`);
    }

    // Intentar eliminar también el mensaje en Telegram para mantener limpio el grupo
    try {
      await ctx.deleteMessage();
      console.log(`[INFO] Mensaje de Telegram ID ${messageId} eliminado exitosamente.`);
    } catch (err) {
      console.warn(`[ADVERTENCIA] No se pudo borrar el mensaje de Telegram ID ${messageId}: ${err.message}`);
    }
  } catch (error) {
    console.error("[ERROR] No se pudo resetear el registro de Google Sheets:", error);
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
    const hoja = documento.sheetsByTitle["registros_telegram"];
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

    try {
      await ctx.reply(
        `⚠️ *Reporte Rechazado*\n\n` +
        `El municipio *${municipio}* y/o el nodo *${nodo}* no existen en el catálogo oficial de verificadores.\n\n` +
        `_Por favor, verifique y corrija los datos del reporte._`,
        {
          parse_mode: "Markdown",
          reply_parameters: { message_id: messageId }
        }
      );
    } catch (err) {
      console.error("[ERROR] No se pudo enviar el mensaje de rechazo (municipio/nodo inválido):", err.message);
    }
    return;
  }

  // 3. Cargar hoja principal y buscar la fila fija del nodo
  const hoja = doc.sheetsByTitle["registros_telegram"];
  await asegurarColumnas(hoja);

  const filas = await hoja.getRows();

  // Buscar la fila FIJA correspondiente a municipio+nodo (sin importar la fecha)
  const filaExistente = buscarFilaPorNodo(filas, municipioOficial, nodo);

  // El historial solo es válido si la fila fija corresponde al mismo día.
  // Si tiene datos de un día anterior, se tratan como cero para no acumular entre días.
  const fechaFila = filaExistente ? (filaExistente.get(COLUMNAS.FECHA) || "").trim() : "";
  const filaEsDeHoy = fechaFila === fecha;

  const historial = (filaExistente && filaEsDeHoy) ? {
    b1:    parseInt(filaExistente.get(COLUMNAS.BLOQUE_1)            || "0", 10),
    b2:    parseInt(filaExistente.get(COLUMNAS.BLOQUE_2)            || "0", 10),
    b3:    parseInt(filaExistente.get(COLUMNAS.BLOQUE_3)            || "0", 10),
    total: parseInt(filaExistente.get(COLUMNAS.TOTAL_VERIFICADORES) || "0", 10),
  } : { b1: 0, b2: 0, b3: 0, total: 0 };

  if (filaExistente && !filaEsDeHoy) {
    console.log(`[INFO] La fila fija del nodo ${nodo} tiene datos del día anterior (${fechaFila}). Historial reseteado a cero para hoy.`);
  }

  // 4. Calcular la acumulación de verificadores por bloque e histórico del mismo día
  const { b1Final, b2Final, b3Final } = calcularAcumulacion(bloqueActivo, reporte, historial);

  const totalFinal = b1Final + b2Final + b3Final;

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

    try {
      await ctx.reply(
        `⚠️ *Reporte Rechazado*\n\n` +
        `El nodo *${nodo}* de *${municipioOficial}* ha superado el límite oficial de verificadores.\n\n` +
        `• *Límite oficial permitido:* \`${limiteVerificadores}\`\n` +
        `• *Total que se intentó registrar:* \`${totalFinal}\` (Acumulado hoy: B1: \`${b1Final}\` | B2: \`${b2Final}\` | B3: \`${b3Final}\`)\n\n` +
        `_Por favor, rectifique la cantidad de verificadores en el reporte._`,
        {
          parse_mode: "Markdown",
          reply_parameters: { message_id: messageId }
        }
      );
    } catch (err) {
      console.error("[ERROR] No se pudo enviar el mensaje de rechazo (exceso de verificadores):", err.message);
    }
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
    console.log(`[INFO] Fila fija actualizada (Municipio: ${municipioOficial}, Nodo: ${nodo}, Mensaje ID: ${messageId}).`);
  } else {
    // Fallback: si por alguna razón no existe la fila fija (p.ej. nodo nuevo), la creamos
    await hoja.addRow(datos);
    console.log(`[INFO] Fila nueva creada como fallback (Mensaje ID: ${messageId}).`);
  }

  await reaccionar(ctx, "👍");
}

/**
 * Registra el handler principal de mensajes (nuevos y editados) en el bot.
 * @param {import("grammy").Bot} bot
 */
export function registrarHandlers(bot) {
  // Comando /reportes y /lista para consultar reportes activos de hoy
  bot.command(["reportes", "lista"], async (ctx) => {
    try {
      const remitente = obtenerNombreRemitente(ctx);
      console.log(`[INFO] Comando /reportes ejecutado por ${remitente} (Chat: ${ctx.chat.id})`);

      const doc = await obtenerHojaDeCalculo();
      const hoja = doc.sheetsByTitle["registros_telegram"];
      const filas = await hoja.getRows();

      const opts = { timeZone: config.app.timezone, year: "numeric", month: "2-digit", day: "2-digit" };
      const hoyStr = new Date().toLocaleDateString("es-VE", opts);

      const reportesHoy = filas.filter((fila) => {
        const fec = (fila.get(COLUMNAS.FECHA) || "").trim();
        return fec === hoyStr;
      });

      if (reportesHoy.length === 0) {
        await ctx.reply(`📊 *Reportes registrados para hoy (${hoyStr}):*\n\nNo hay reportes registrados aún.`, { parse_mode: "Markdown" });
        return;
      }

      let respuesta = `📊 *Reportes activos de hoy (${hoyStr}):*\n\n`;
      for (const fila of reportesHoy) {
        const mun = fila.get(COLUMNAS.MUNICIPIO);
        const nod = fila.get(COLUMNAS.NODO);
        const b1 = fila.get(COLUMNAS.BLOQUE_1) || "0";
        const b2 = fila.get(COLUMNAS.BLOQUE_2) || "0";
        const b3 = fila.get(COLUMNAS.BLOQUE_3) || "0";
        const total = fila.get(COLUMNAS.TOTAL_VERIFICADORES) || "0";
        respuesta += `• *${mun}* (Nodo ${nod}): 9am: \`${b1}\` | 2pm: \`${b2}\` | 6pm: \`${b3}\` | Total: \`${total}\`\n`;
      }

      await ctx.reply(respuesta, { parse_mode: "Markdown" });
    } catch (error) {
      console.error("[ERROR] Falló al ejecutar el comando /reportes:", error);
      await ctx.reply("❌ Ocurrió un error al consultar los reportes en Google Sheets.");
    }
  });

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
