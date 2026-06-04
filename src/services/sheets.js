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

  for (const col of [COLUMNAS.ID_MENSAJE, COLUMNAS.ID_CHAT, COLUMNAS.ESTADO]) {
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
 * Busca en la hoja la fila fija que corresponde a un municipio+nodo.
 * No filtra por fecha — la fila es permanente.
 * @param {import("google-spreadsheet").GoogleSpreadsheetRow[]} filas
 * @param {string} municipioOficial
 * @param {number} nodo
 * @returns {import("google-spreadsheet").GoogleSpreadsheetRow | null}
 */
export function buscarFilaPorNodo(filas, municipioOficial, nodo) {
  return filas.find((fila) => {
    const mun = (fila.get(COLUMNAS.MUNICIPIO) || "").trim().toLowerCase();
    const nod = parseInt(fila.get(COLUMNAS.NODO) || "0", 10);
    return mun === municipioOficial.trim().toLowerCase() && nod === nodo;
  }) ?? null;
}

/**
 * Resetea los datos de reporte de una fila fija (borra bloques, totales,
 * remitente, fecha, hora, ID de mensaje y estado), dejando fijos municipio y nodo.
 * @param {import("google-spreadsheet").GoogleSpreadsheetRow} fila
 */
export async function resetearFila(fila) {
  fila.set(COLUMNAS.TOTAL_VERIFICADORES, "0");
  fila.set(COLUMNAS.BLOQUE_1,            "0");
  fila.set(COLUMNAS.BLOQUE_2,            "0");
  fila.set(COLUMNAS.BLOQUE_3,            "0");
  fila.set(COLUMNAS.FECHA,               "");
  fila.set(COLUMNAS.HORA,                "");
  fila.set(COLUMNAS.REMITENTE,           "");
  fila.set(COLUMNAS.ID_MENSAJE,          "");
  fila.set(COLUMNAS.ID_CHAT,             "");
  fila.set(COLUMNAS.ESTADO,              "");
  await fila.save();
}

/**
 * Resetea todas las filas que tengan una fecha distinta al día de hoy en la zona horaria configurada.
 * De esta manera, solo quedan en la hoja principal los reportes del día actual.
 *
 * @param {import("google-spreadsheet").GoogleSpreadsheet} doc
 * @returns {Promise<number>} Número de filas reseteadas.
 */
export async function resetearFilasDeDiasAnteriores(doc) {
  const hoja = doc.sheetsByTitle["registros_telegram"];
  const filas = await hoja.getRows();

  const opts = { timeZone: config.app.timezone, year: "numeric", month: "2-digit", day: "2-digit" };
  const hoyStr = new Date().toLocaleDateString("es-VE", opts);

  // 1. Identificar si hay fechas de días anteriores en la hoja principal
  const fechasAnteriores = new Set();
  for (const fila of filas) {
    const fechaFila = (fila.get(COLUMNAS.FECHA) || "").trim();
    if (fechaFila && fechaFila !== hoyStr) {
      fechasAnteriores.add(fechaFila);
    }
  }

  // 2. Para cada fecha anterior detectada, resguardarla preventivamente en el histórico antes de borrarla
  for (const fechaAnterior of fechasAnteriores) {
    console.log(`[INFO] Detectada fecha de día anterior (${fechaAnterior}) en la hoja principal. Ejecutando resguardo preventivo...`);
    await guardarHistoricoDiario(doc, fechaAnterior);
  }

  // 3. Resetear únicamente las filas que pertenecen a esos días anteriores
  let reseteadas = 0;
  for (const fila of filas) {
    const fechaFila = (fila.get(COLUMNAS.FECHA) || "").trim();
    if (fechaFila && fechaFila !== hoyStr) {
      const municipio = fila.get(COLUMNAS.MUNICIPIO);
      const nodo = fila.get(COLUMNAS.NODO);
      console.log(`[INFO] Reseteando fila del día anterior (${fechaFila}) para ${municipio} (Nodo ${nodo})`);
      await resetearFila(fila);
      reseteadas++;
    }
  }

  if (reseteadas > 0) {
    console.log(`[INFO] Reseteo de registros de días anteriores completado: ${reseteadas} fila(s) reseteada(s).`);
  } else {
    console.log("[INFO] Reseteo de registros de días anteriores completado: no había filas de días anteriores.");
  }
  return reseteadas;
}

/**
 * Guarda todos los registros correspondientes a una fecha específica en la hoja registros_historicos_telegram.
 * Si no se especifica una fecha, busca la primera fecha disponible en las filas (usado para el cron de la noche).
 *
 * @param {import("google-spreadsheet").GoogleSpreadsheet} doc
 * @param {string|null} fechaEspecifica - Fecha a respaldar (ej: "03/06/2026")
 */
export async function guardarHistoricoDiario(doc, fechaEspecifica = null) {
  console.log("[INFO] Guardando histórico diario en la hoja 'registros_historicos_telegram'...");
  
  const hojaPrincipal = doc.sheetsByTitle["registros_telegram"];
  const filas = await hojaPrincipal.getRows();

  // 1. Identificar la fecha real de los reportes a respaldar
  let fechaReporte = fechaEspecifica;
  if (!fechaReporte) {
    for (const fila of filas) {
      const fVal = (fila.get(COLUMNAS.FECHA) || "").trim();
      if (fVal) {
        fechaReporte = fVal;
        break;
      }
    }
  }

  // Si no hay ninguna fecha que respaldar, salimos
  if (!fechaReporte) {
    console.log("[INFO] No se encontraron reportes con fecha para respaldar. Omitiendo histórico.");
    return;
  }

  let sheetHistorica = doc.sheetsByTitle["registros_historicos_telegram"];
  if (!sheetHistorica) {
    console.log("[INFO] Creando la hoja 'registros_historicos_telegram' ya que no existía...");
    sheetHistorica = await doc.addSheet({
      title: "registros_historicos_telegram"
    });
  }

  // Asegurar cabeceras
  try {
    await sheetHistorica.loadHeaderRow();
  } catch (err) {
    console.log("[INFO] Inicializando cabeceras en 'registros_historicos_telegram'...");
    await sheetHistorica.setHeaderRow([
      COLUMNAS.MUNICIPIO,
      COLUMNAS.NODO,
      COLUMNAS.TOTAL_VERIFICADORES,
      COLUMNAS.BLOQUE_1,
      COLUMNAS.BLOQUE_2,
      COLUMNAS.BLOQUE_3,
      COLUMNAS.FECHA,
      COLUMNAS.HORA,
      COLUMNAS.REMITENTE,
      COLUMNAS.ID_MENSAJE,
      COLUMNAS.ID_CHAT,
      COLUMNAS.ESTADO
    ]);
  }

  // 2. Verificar si el histórico de esa fecha ya existe para evitar duplicados
  const filasHistoricas = await sheetHistorica.getRows();
  const yaExiste = filasHistoricas.some(f => (f.get(COLUMNAS.FECHA) || "").trim() === fechaReporte);
  if (yaExiste) {
    console.log(`[INFO] Los registros del día ${fechaReporte} ya están en el histórico. Omitiendo para evitar duplicados.`);
    return;
  }

  // 3. Mapear los datos. Si la fila es del día a respaldar, copiamos sus datos reales.
  // Si es de otra fecha (por ejemplo, ya reportaron hoy) o está vacía, la guardamos con 0 para este histórico.
  const filasDatos = filas.map(f => {
    const obj = f.toObject();
    const esDeFechaResguardo = (obj[COLUMNAS.FECHA] || "").trim() === fechaReporte;

    if (esDeFechaResguardo) {
      return {
        [COLUMNAS.MUNICIPIO]: obj[COLUMNAS.MUNICIPIO] || "",
        [COLUMNAS.NODO]: obj[COLUMNAS.NODO] || "",
        [COLUMNAS.TOTAL_VERIFICADORES]: obj[COLUMNAS.TOTAL_VERIFICADORES] || "",
        [COLUMNAS.BLOQUE_1]: obj[COLUMNAS.BLOQUE_1] || "",
        [COLUMNAS.BLOQUE_2]: obj[COLUMNAS.BLOQUE_2] || "",
        [COLUMNAS.BLOQUE_3]: obj[COLUMNAS.BLOQUE_3] || "",
        [COLUMNAS.FECHA]: obj[COLUMNAS.FECHA] || "",
        [COLUMNAS.HORA]: obj[COLUMNAS.HORA] || "",
        [COLUMNAS.REMITENTE]: obj[COLUMNAS.REMITENTE] || "",
        [COLUMNAS.ID_MENSAJE]: obj[COLUMNAS.ID_MENSAJE] || "",
        [COLUMNAS.ID_CHAT]: obj[COLUMNAS.ID_CHAT] || "",
        [COLUMNAS.ESTADO]: obj[COLUMNAS.ESTADO] || ""
      };
    } else {
      return {
        [COLUMNAS.MUNICIPIO]: obj[COLUMNAS.MUNICIPIO] || "",
        [COLUMNAS.NODO]: obj[COLUMNAS.NODO] || "",
        [COLUMNAS.TOTAL_VERIFICADORES]: "0",
        [COLUMNAS.BLOQUE_1]: "0",
        [COLUMNAS.BLOQUE_2]: "0",
        [COLUMNAS.BLOQUE_3]: "0",
        [COLUMNAS.FECHA]: fechaReporte,
        [COLUMNAS.HORA]: "",
        [COLUMNAS.REMITENTE]: "",
        [COLUMNAS.ID_MENSAJE]: "",
        [COLUMNAS.ID_CHAT]: "",
        [COLUMNAS.ESTADO]: ""
      };
    }
  });

  // Guardar en bloque plano justo debajo
  await sheetHistorica.addRows(filasDatos);
  console.log(`[INFO] Historial diario de la fecha ${fechaReporte} guardado con éxito. Se copiaron ${filasDatos.length} filas.`);
}

// inicializarHojaConNodos y ordenarYLimpiarHojaPrincipal han sido movidas
// a src/services/sheets.business.js para cumplir el principio de
// responsabilidad única (SRP). Importar desde allí cuando se necesiten.

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

