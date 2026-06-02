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

  let reseteadas = 0;
  for (const fila of filas) {
    const fechaFila = (fila.get(COLUMNAS.FECHA) || "").trim();
    // Si la fila tiene una fecha registrada y no es el día de hoy, se resetea.
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
 * Guarda todos los registros actuales de registros_telegram en la hoja registros_historicos_telegram,
 * agregando una fila de cabecera con la fecha actual de Venezuela para separar e identificar el día.
 *
 * @param {import("google-spreadsheet").GoogleSpreadsheet} doc
 */
export async function guardarHistoricoDiario(doc) {
  console.log("[INFO] Guardando histórico diario en la hoja 'registros_historicos_telegram'...");
  
  const hojaPrincipal = doc.sheetsByTitle["registros_telegram"];
  const filas = await hojaPrincipal.getRows();

  let sheetHistorica = doc.sheetsByTitle["registros_historicos_telegram"];
  if (!sheetHistorica) {
    console.log("[INFO] Creando la hoja 'registros_historicos_telegram' ya que no existía...");
    sheetHistorica = await doc.addSheet({
      title: "registros_historicos_telegram"
    });
  }

  // Asegurar cabeceras si la hoja está recién creada o vacía
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

  const opts = { timeZone: config.app.timezone, year: "numeric", month: "2-digit", day: "2-digit" };
  const hoyStr = new Date().toLocaleDateString("es-VE", opts);

  const opcionesDia = { timeZone: config.app.timezone, weekday: "long" };
  const diaSemanaRaw = new Intl.DateTimeFormat("es-VE", opcionesDia).format(new Date());
  const diaSemana = diaSemanaRaw.charAt(0).toUpperCase() + diaSemanaRaw.slice(1);

  const filaVacia = {
    [COLUMNAS.MUNICIPIO]: ""
  };

  const filaFecha = {
    [COLUMNAS.MUNICIPIO]: `--- HISTORIAL DEL DÍA: ${diaSemana}, ${hoyStr} ---`
  };

  const filasDatos = filas.map(f => {
    const obj = f.toObject();
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
  });

  // Guardar en bloque para mayor velocidad y menor uso de cuota de la API
  await sheetHistorica.addRows([filaVacia, filaFecha, ...filasDatos]);
  console.log(`[INFO] Historial diario guardado con éxito. Se copiaron ${filasDatos.length} filas.`);
}

/**
 * Filtra filas completamente vacías (que no tienen Municipio o Nodo) y ordena 
 * todas las filas activas en 'registros_telegram' por Municipio (alfabético) 
 * y luego por Nodo (numérico). Esto elimina cualquier celda en blanco dejada
 * por nodos eliminados y mantiene la hoja 100% pulida.
 *
 * @param {import("google-spreadsheet").GoogleSpreadsheet} doc
 */
export async function ordenarYLimpiarHojaPrincipal(doc) {
  console.log("[INFO] Iniciando limpieza de filas vacías y ordenamiento de registros_telegram...");
  try {
    const sheet = doc.sheetsByTitle["registros_telegram"];
    if (!sheet) {
      console.error("[ERROR] No se encontró la hoja 'registros_telegram' para ordenar.");
      return;
    }

    const filas = await sheet.getRows();
    
    // 1. Filtrar filas válidas (que tengan Municipio y Nodo válido) y extraer sus objetos de datos
    const filasValidas = [];
    for (const fila of filas) {
      const municipio = (fila.get(COLUMNAS.MUNICIPIO) || "").trim();
      const nodoStr = (fila.get(COLUMNAS.NODO) || "").trim();
      const nodo = parseInt(nodoStr, 10);
      
      // Conservar solo si tiene municipio y nodo válido (no vacío ni 0)
      if (municipio && nodoStr && !isNaN(nodo) && nodo > 0) {
        const obj = fila.toObject();
        filasValidas.push({
          [COLUMNAS.MUNICIPIO]:           municipio,
          [COLUMNAS.NODO]:                String(nodo),
          [COLUMNAS.TOTAL_VERIFICADORES]: obj[COLUMNAS.TOTAL_VERIFICADORES] || "0",
          [COLUMNAS.BLOQUE_1]:            obj[COLUMNAS.BLOQUE_1] || "0",
          [COLUMNAS.BLOQUE_2]:            obj[COLUMNAS.BLOQUE_2] || "0",
          [COLUMNAS.BLOQUE_3]:            obj[COLUMNAS.BLOQUE_3] || "0",
          [COLUMNAS.FECHA]:               obj[COLUMNAS.FECHA] || "",
          [COLUMNAS.HORA]:                obj[COLUMNAS.HORA] || "",
          [COLUMNAS.REMITENTE]:           obj[COLUMNAS.REMITENTE] || "",
          [COLUMNAS.ID_MENSAJE]:          obj[COLUMNAS.ID_MENSAJE] || "",
          [COLUMNAS.ID_CHAT]:             obj[COLUMNAS.ID_CHAT] || "",
          [COLUMNAS.ESTADO]:              obj[COLUMNAS.ESTADO] || "",
        });
      }
    }

    // 2. Ordenar las filas: primero por Municipio (alfabético) y luego por Nodo (numérico)
    filasValidas.sort((a, b) => {
      const compMun = a[COLUMNAS.MUNICIPIO].localeCompare(b[COLUMNAS.MUNICIPIO]);
      if (compMun !== 0) return compMun;
      return parseInt(a[COLUMNAS.NODO], 10) - parseInt(b[COLUMNAS.NODO], 10);
    });

    console.log(`[INFO] Re-escribiendo ${filasValidas.length} filas ordenadas en 'registros_telegram'...`);
    
    // 3. Limpiar la hoja por completo (elimina celdas y filas vacías intermedias)
    await sheet.clear();
    
    // 4. Escribir las cabeceras canónicas
    await sheet.setHeaderRow([
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

    // 5. Agregar las filas ordenadas y limpias en lote
    if (filasValidas.length > 0) {
      await sheet.addRows(filasValidas);
    }

    console.log("[INFO] Limpieza y ordenamiento de la hoja principal completado con éxito.");
  } catch (err) {
    console.error("[ERROR] Falló el ordenamiento y limpieza de la hoja principal:", err);
  }
}

/**
 * Inicializa la hoja principal con una fila fija por cada nodo del catálogo
 * 'verificadores_nodo'. Si una fila para ese nodo ya existe, no hace nada.
 * Esta función debe llamarse al arrancar el bot.
 *
 * @param {import("google-spreadsheet").GoogleSpreadsheet} doc
 */
export async function inicializarHojaConNodos(doc) {
  const hojaNodos = doc.sheetsByTitle["verificadores_nodo"];
  if (!hojaNodos) {
    console.error("[ERROR] No se encontró la hoja 'verificadores_nodo'. No se puede inicializar.");
    return;
  }

  const hoja = doc.sheetsByTitle["registros_telegram"];
  await asegurarColumnas(hoja);

  const filasNodos    = await hojaNodos.getRows();
  const filasActuales = await hoja.getRows();

  let insertados = 0;
  for (const nodoRow of filasNodos) {
    const municipio = (nodoRow.get("MUNICIPIO") || "").trim();
    const nodo      = parseInt(nodoRow.get("NODO") || "0", 10);
    if (!municipio || !nodo) continue;

    const existe = buscarFilaPorNodo(filasActuales, municipio, nodo);
    if (!existe) {
      await hoja.addRow({
        [COLUMNAS.MUNICIPIO]:           municipio,
        [COLUMNAS.NODO]:                nodo,
        [COLUMNAS.TOTAL_VERIFICADORES]: "0",
        [COLUMNAS.BLOQUE_1]:            "0",
        [COLUMNAS.BLOQUE_2]:            "0",
        [COLUMNAS.BLOQUE_3]:            "0",
        [COLUMNAS.FECHA]:               "",
        [COLUMNAS.HORA]:                "",
        [COLUMNAS.REMITENTE]:           "",
        [COLUMNAS.ID_MENSAJE]:          "",
        [COLUMNAS.ID_CHAT]:             "",
        [COLUMNAS.ESTADO]:              "",
      });
      insertados++;
      console.log(`[INFO] Fila fija creada: ${municipio} — Nodo ${nodo}`);
    }
  }

  console.log(
    insertados > 0
      ? `[INFO] Inicialización completada: ${insertados} fila(s) nueva(s) creada(s).`
      : "[INFO] Inicialización completada: todas las filas de nodos ya existían."
  );
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
