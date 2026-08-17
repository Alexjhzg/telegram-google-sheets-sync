import { GoogleSpreadsheet, GoogleSpreadsheetWorksheet, GoogleSpreadsheetRow } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { config } from "../config/index.js";
import { Mutex } from "../utils/mutex.js";
import { HistorialAcumulado } from "../types/index.js";

// Lock global para secuenciar todas las operaciones asíncronas sobre Google Sheets
export const sheetsMutex = new Mutex();

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
} as const;

let docPromise: Promise<GoogleSpreadsheet> | null = null;

/**
 * Crea, autentica y carga el cliente de Google Sheets una sola vez,
 * reutilizando la conexión en las llamadas posteriores.
 */
export async function obtenerHojaDeCalculo(): Promise<GoogleSpreadsheet> {
  if (docPromise) {
    return docPromise;
  }

  docPromise = (async () => {
    console.log("[INFO] Conectando y autenticando con Google Sheets...");
    const auth = new JWT({
      email:  config.google.serviceAccountEmail,
      key:    config.google.privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const doc = new GoogleSpreadsheet(config.google.spreadsheetId, auth);
    await doc.loadInfo();
    console.log("[INFO] Conexión con Google Sheets establecida con éxito.");
    return doc;
  })();

  return docPromise;
}

/**
 * Asegura que las columnas de rastreo existen en la hoja.
 * Las añade automáticamente si no están presentes.
 */
export async function asegurarColumnas(hoja: GoogleSpreadsheetWorksheet): Promise<void> {
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
 * Normaliza cualquier texto removiendo tildes, diacríticos, mayúsculas y espacios extra.
 */
export function normalizarTexto(txt: string | undefined | null): string {
  return (txt || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Busca en la hoja la fila cuyo ID de mensaje coincida.
 */
export function buscarFilaPorMensaje(filas: GoogleSpreadsheetRow[], messageId: number | string): GoogleSpreadsheetRow | null {
  return filas.find(
    (fila) => String(fila.toObject()[COLUMNAS.ID_MENSAJE]) === String(messageId)
  ) ?? null;
}

/**
 * Busca en la hoja la fila fija que corresponde a un municipio+nodo.
 */
export function buscarFilaPorNodo(filas: GoogleSpreadsheetRow[], municipioOficial: string, nodo: number | string): GoogleSpreadsheetRow | null {
  const munBuscado = normalizarTexto(municipioOficial);
  const nodBuscado = parseInt(String(nodo), 10);

  return filas.find((fila) => {
    const munFila = normalizarTexto(fila.get(COLUMNAS.MUNICIPIO));
    const nodFila = parseInt(fila.get(COLUMNAS.NODO) || "0", 10);
    return munFila === munBuscado && nodFila === nodBuscado;
  }) ?? null;
}

/**
 * Resetea los datos de reporte de una fila fija (borra bloques, totales,
 * remitente, fecha, hora, ID de mensaje y estado), dejando fijos municipio y nodo.
 */
export async function resetearFila(fila: GoogleSpreadsheetRow): Promise<void> {
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
 */
export async function resetearFilasDeDiasAnteriores(doc: GoogleSpreadsheet): Promise<number> {
  const hoja = doc.sheetsByTitle["registros_telegram"];
  if (!hoja) return 0;
  const filas = await hoja.getRows();

  const opts: Intl.DateTimeFormatOptions = { timeZone: config.app.timezone, year: "numeric", month: "2-digit", day: "2-digit" };
  const hoyStr = new Date().toLocaleDateString("es-VE", opts);

  const fechasAnteriores = new Set<string>();
  for (const fila of filas) {
    const fechaFila = (fila.get(COLUMNAS.FECHA) || "").trim();
    if (fechaFila && fechaFila !== hoyStr) {
      fechasAnteriores.add(fechaFila);
    }
  }

  for (const fechaAnterior of fechasAnteriores) {
    console.log(`[INFO] Detectada fecha de día anterior (${fechaAnterior}) en la hoja principal. Ejecutando resguardo preventivo...`);
    await guardarHistoricoDiario(doc, fechaAnterior);
  }

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
 */
export async function guardarHistoricoDiario(doc: GoogleSpreadsheet, fechaEspecifica: string | null = null): Promise<void> {
  console.log("[INFO] Guardando histórico diario en la hoja 'registros_historicos_telegram'...");
  
  const hojaPrincipal = doc.sheetsByTitle["registros_telegram"];
  if (!hojaPrincipal) return;
  const filas = await hojaPrincipal.getRows();

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

  const filasHistoricas = await sheetHistorica.getRows();
  const yaExiste = filasHistoricas.some(f => (f.get(COLUMNAS.FECHA) || "").trim() === fechaReporte);
  if (yaExiste) {
    console.log(`[INFO] Los registros del día ${fechaReporte} ya están en el histórico. Omitiendo para evitar duplicados.`);
    return;
  }

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

  await sheetHistorica.addRows(filasDatos);
  console.log(`[INFO] Historial diario de la fecha ${fechaReporte} guardado con éxito. Se copiaron ${filasDatos.length} filas.`);
}

/**
 * Recorre el historial de filas para obtener los últimos valores acumulados del municipio/nodo.
 */
export function obtenerUltimosValores(
  filas: GoogleSpreadsheetRow[],
  municipio: string,
  nodo: number | string,
  fechaActual: string,
  filaExcluida: GoogleSpreadsheetRow | null = null
): HistorialAcumulado {
  let total = 0, b1 = 0, b2 = 0, b3 = 0;
  const munBuscado = normalizarTexto(municipio);
  const nodBuscado = parseInt(String(nodo), 10);

  for (let i = filas.length - 1; i >= 0; i--) {
    if (filaExcluida && filas[i].rowNumber === filaExcluida.rowNumber) continue;

    const obj      = filas[i].toObject();
    const munFila  = normalizarTexto(obj[COLUMNAS.MUNICIPIO]);
    const nodoFila = parseInt(obj[COLUMNAS.NODO], 10);
    const fechaFila = obj[COLUMNAS.FECHA] || "";

    if (munFila !== munBuscado || nodoFila !== nodBuscado) continue;
    if (fechaFila !== fechaActual) continue;

    if (!total) total = parseInt(obj[COLUMNAS.TOTAL_VERIFICADORES] || "0", 10);
    if (!b1)    b1    = parseInt(obj[COLUMNAS.BLOQUE_1] || "0", 10);
    if (!b2)    b2    = parseInt(obj[COLUMNAS.BLOQUE_2] || "0", 10);
    if (!b3)    b3    = parseInt(obj[COLUMNAS.BLOQUE_3] || "0", 10);

    if (total && b1 && b2 && b3) break;
  }

  return { total, b1, b2, b3 };
}
