"use strict";

import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { config } from "../config/index.js";

// Nombres canónicos de las columnas en la hoja de cálculo
export const COLUMNAS = {
  MUNICIPIO:          "Municipio",
  NODO:               "Nodo",
  TOTAL_VERIFICADORES:"Total Verificadores",
  BLOQUE_1:           "Bloque 1 (9am)",
  BLOQUE_2:           "Bloque 2 (2pm)",
  BLOQUE_3:           "Bloque 3 (6pm)",
  FECHA:              "Fecha",
  HORA:               "Hora",
  REMITENTE:          "Remitente",
  ID_MENSAJE:         "ID Mensaje",
  ID_CHAT:            "ID Chat",
  ESTADO:             "Estado",
};

/**
 * Crea y autentica el cliente de Google Sheets.
 * @returns {Promise<GoogleSpreadsheet>}
 */
export async function obtenerHojaDeCalculo() {
  const auth = new JWT({
    email:  config.google.serviceAccountEmail,
    key:    config.google.privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const doc = new GoogleSpreadsheet(config.google.spreadsheetId, auth);
  await doc.loadInfo();
  return doc;
}

/**
 * Asegura que las columnas de rastreo existen en la hoja.
 * Las añade automáticamente si no están presentes.
 * @param {import("google-spreadsheet").GoogleSpreadsheetWorksheet} hoja
 */
export async function asegurarColumnas(hoja) {
  // Cargar las cabeceras explícitamente si aún no están en memoria
  await hoja.loadHeaderRow();

  const cabeceras = [...hoja.headerValues];
  let modificado  = false;

  for (const col of [COLUMNAS.ID_MENSAJE, COLUMNAS.ID_CHAT]) {
    if (!cabeceras.includes(col)) {
      console.log(`[INFO] Columna '${col}' no encontrada. Añadiéndola...`);
      cabeceras.push(col);
      modificado = true;
    }
  }

  if (modificado) await hoja.setHeaderRow(cabeceras);
}

/**
 * Busca en la hoja la fila cuyo ID de mensaje coincida.
 * @param {import("google-spreadsheet").GoogleSpreadsheetRow[]} filas
 * @param {number|string} messageId
 * @returns {import("google-spreadsheet").GoogleSpreadsheetRow | null}
 */
export function buscarFilaPorMensaje(filas, messageId) {
  return filas.find(
    (fila) => String(fila.toObject()[COLUMNAS.ID_MENSAJE]) === String(messageId)
  ) ?? null;
}

/**
 * Recorre el historial de filas (más reciente primero) para obtener los
 * últimos valores no-cero del municipio/nodo indicado, excluyendo la fila
 * que se está editando actualmente.
 *
 * @param {import("google-spreadsheet").GoogleSpreadsheetRow[]} filas
 * @param {string} municipio
 * @param {number} nodo
 * @param {import("google-spreadsheet").GoogleSpreadsheetRow | null} filaExcluida
 * @returns {{ total: number, b1: number, b2: number, b3: number }}
 */
export function obtenerUltimosValores(filas, municipio, nodo, fechaActual, filaExcluida = null) {
  let total = 0, b1 = 0, b2 = 0, b3 = 0;

  for (let i = filas.length - 1; i >= 0; i--) {
    if (filaExcluida && filas[i].rowNumber === filaExcluida.rowNumber) continue;

    const obj     = filas[i].toObject();
    const munFila = (obj[COLUMNAS.MUNICIPIO] || "").trim().toLowerCase();
    const nodoFila = parseInt(obj[COLUMNAS.NODO], 10);
    const fechaFila = obj[COLUMNAS.FECHA] || "";

    if (munFila !== municipio.trim().toLowerCase() || nodoFila !== nodo) continue;
    if (fechaFila !== fechaActual) continue; // ¡Solo del mismo día!

    if (!total) total = parseInt(obj[COLUMNAS.TOTAL_VERIFICADORES] || "0", 10);
    if (!b1)    b1    = parseInt(obj[COLUMNAS.BLOQUE_1] || "0", 10);
    if (!b2)    b2    = parseInt(obj[COLUMNAS.BLOQUE_2] || "0", 10);
    if (!b3)    b3    = parseInt(obj[COLUMNAS.BLOQUE_3] || "0", 10);

    if (total && b1 && b2 && b3) break;
  }

  return { total, b1, b2, b3 };
}
