"use strict";

import { config } from "../config/index.js";
import { convertirTimestamp, obtenerBloqueYHoraActivo } from "../utils/parser.js";
import { validarMunicipioNodo } from "./validation.js";
import { calcularAcumulacion } from "../utils/accumulation.js";
import {
  obtenerHojaDeCalculo,
  asegurarColumnas,
  buscarFilaPorMensaje,
  buscarFilaPorNodo,
  resetearFila,
  COLUMNAS,
} from "./sheets.js";

/**
 * Resetea en Google Sheets el registro correspondiente a un ID de mensaje.
 *
 * @param {number|string} messageId - ID del mensaje a buscar y eliminar.
 * @returns {Promise<boolean>} True si se encontró y reseteó la fila, false en caso contrario.
 */
export async function eliminarReporte(messageId) {
  const doc  = await obtenerHojaDeCalculo();
  const hoja = doc.sheetsByTitle["registros_telegram"];
  const fila = buscarFilaPorMensaje(await hoja.getRows(), messageId);

  if (fila) {
    await resetearFila(fila);
    return true;
  }
  return false;
}

/**
 * Marca una fila en Google Sheets en estado de revisión si el reporte editado es inválido.
 *
 * @param {object} [doc] - Instancia de GoogleSpreadsheet ya cargada (opcional).
 * @param {number|string} messageId - ID del mensaje.
 */
export async function marcarFilaParaRevision(doc, messageId) {
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
 * Procesa la lógica de negocio de un reporte:
 * 1. Calcula las horas y holguras del mensaje (creación vs edición).
 * 2. Valida municipio y nodo contra la base de datos oficial.
 * 3. Carga el historial del mismo día en la hoja principal.
 * 4. Calcula la acumulación por bloques y valida el límite oficial.
 * 5. Guarda o actualiza el registro en la hoja de cálculo.
 *
 * @param {object} params
 * @param {object} params.reporte - Datos parseados del reporte.
 * @param {{ fecha: string, hora: string }} params.tiempo - Fecha/hora del mensaje.
 * @param {string} params.remitente - Nombre del remitente.
 * @param {number} params.messageId - ID de mensaje.
 * @param {number} params.chatId - ID del chat de Telegram.
 * @param {number|null} params.creationTimestamp - Timestamp de creación.
 * @param {number|null} params.editTimestamp - Timestamp de edición (si aplica).
 * @param {boolean} params.esEdicion - Indica si es una edición.
 * @returns {Promise<object>} Resultado estructurado del procesamiento.
 */
export async function procesarYGuardarReporte({
  reporte,
  tiempo,
  remitente,
  messageId,
  chatId,
  creationTimestamp,
  editTimestamp,
  esEdicion,
}) {
  const { municipio, nodo, totalVerificadores, bloque1, bloque2, bloque3 } = reporte;

  let timestamp = creationTimestamp;
  let tiempoFinal = tiempo;

  // Evaluar holgura para la clasificación por bloques de mensajes editados
  if (esEdicion && editTimestamp) {
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

  // 2. Validar Municipio y Nodo contra catálogo oficial
  const { valido, limiteVerificadores, municipioOficial, razon } = await validarMunicipioNodo(doc, municipio, nodo);
  if (!valido) {
    if (esEdicion) {
      await marcarFilaParaRevision(doc, messageId);
    }
    return {
      valido: false,
      razon, // "MUNICIPIO_INCORRECTO" o "NODO_INCORRECTO"
      municipioOficial,
      municipioParseado: municipio,
      nodoParseado: nodo
    };
  }

  // 3. Cargar hoja principal y buscar la fila fija del nodo
  const hoja = doc.sheetsByTitle["registros_telegram"];
  await asegurarColumnas(hoja);

  const filas = await hoja.getRows();
  const filaExistente = buscarFilaPorNodo(filas, municipioOficial, nodo);

  // El historial solo es válido si la fila fija corresponde al mismo día.
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

  // 4. Calcular la acumulación de verificadores
  const { b1Final, b2Final, b3Final } = calcularAcumulacion(bloqueActivo, reporte, historial);
  const totalFinal = b1Final + b2Final + b3Final;

  // 5. Validar capacidad máxima
  if (totalFinal > limiteVerificadores) {
    if (esEdicion) {
      await marcarFilaParaRevision(doc, messageId);
    }
    return {
      valido: false,
      razon: "EXCESO_VERIFICADORES",
      municipioOficial,
      limiteVerificadores,
      totalFinal,
      b1Final,
      b2Final,
      b3Final
    };
  }

  // Log estético del proceso
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
    [COLUMNAS.ID_CHAT]:             String(chatId),
    [COLUMNAS.ESTADO]:              "OK",
  };

  if (filaExistente) {
    filaExistente.assign(datos);
    await filaExistente.save();
    console.log(`[INFO] Fila fija actualizada (Municipio: ${municipioOficial}, Nodo: ${nodo}, Mensaje ID: ${messageId}).`);
  } else {
    await hoja.addRow(datos);
    console.log(`[INFO] Fila nueva creada como fallback (Mensaje ID: ${messageId}).`);
  }

  return {
    valido: true,
    municipioOficial,
    totalFinal,
    b1Final,
    b2Final,
    b3Final
  };
}
