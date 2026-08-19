import { GoogleSpreadsheet } from "google-spreadsheet";
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
  sheetsMutex,
} from "./sheets.js";

import {
  esDBActiva,
  guardarOActualizarReporteDB,
  validarMunicipioNodoDB,
  registrarAuditoriaDB,
  marcarReporteSincronizadoDB,
} from "./database.js";

import { DatosReporteProcesar, ResultadoProcesamiento, ValidacionResultado } from "../types/index.js";

/**
 * Resetea en Google Sheets el registro correspondiente a un ID de mensaje.
 */
export async function eliminarReporte(messageId: number | string): Promise<boolean> {
  return sheetsMutex.runExclusive(async () => {
    const doc  = await obtenerHojaDeCalculo();
    const hoja = doc.sheetsByTitle["registros_telegram"];
    if (!hoja) return false;
    const fila = buscarFilaPorMensaje(await hoja.getRows(), messageId);

    if (fila) {
      await resetearFila(fila);
      return true;
    }
    return false;
  });
}

/**
 * Lógica interna para marcar una fila en revisión sin adquirir el lock.
 */
async function _marcarFilaParaRevision(doc: GoogleSpreadsheet | null, messageId: number | string): Promise<void> {
  try {
    const documento = doc || await obtenerHojaDeCalculo();
    const hoja = documento.sheetsByTitle["registros_telegram"];
    if (!hoja) return;
    const filas = await hoja.getRows();
    const fila = buscarFilaPorMensaje(filas, messageId);
    if (fila) {
      const estadoActual = (fila.get(COLUMNAS.ESTADO) || "").toString();
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
 * Marca una fila en Google Sheets en estado de revisión si el reporte editado es inválido.
 */
export async function marcarFilaParaRevision(doc: GoogleSpreadsheet | null, messageId: number | string): Promise<void> {
  return sheetsMutex.runExclusive(async () => {
    await _marcarFilaParaRevision(doc, messageId);
  });
}

/**
 * Procesa la lógica de negocio de un reporte.
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
}: DatosReporteProcesar): Promise<ResultadoProcesamiento> {
  const { municipio, nodo, totalVerificadores, bloque1, bloque2, bloque3 } = reporte;

  let timestamp = creationTimestamp;
  let tiempoFinal = tiempo;

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

  const { horaStr, bloqueActivo, bloqueStr } = obtenerBloqueYHoraActivo(timestamp);
  console.log(`[INFO] Mensaje procesado a las ${horaStr} (Hora VE). Bloque Activo: ${bloqueStr}.`);

  const doc = await obtenerHojaDeCalculo();

  let validacion: ValidacionResultado;
  if (esDBActiva()) {
    try {
      validacion = await validarMunicipioNodoDB(municipio, nodo);
      if (!validacion.valido) {
        const valSheets = await validarMunicipioNodo(doc, municipio, nodo);
        if (valSheets.valido) {
          validacion = valSheets;
        }
      }
    } catch (e: any) {
      console.warn("[ADVERTENCIA] Falló validación en Base de Datos, utilizando fallback a Google Sheets:", e.message);
      validacion = await validarMunicipioNodo(doc, municipio, nodo);
    }
  } else {
    validacion = await validarMunicipioNodo(doc, municipio, nodo);
  }

  const { valido, limiteVerificadores, municipioOficial, razon } = validacion;
  if (!valido) {
    if (esEdicion) {
      await marcarFilaParaRevision(doc, messageId);
    }
    return {
      valido: false,
      razon,
      municipioOficial,
      municipioParseado: municipio,
      nodoParseado: nodo
    };
  }

  return sheetsMutex.runExclusive(async () => {
    const hoja = doc.sheetsByTitle["registros_telegram"];
    if (!hoja) throw new Error("No existe la hoja registros_telegram");
    await asegurarColumnas(hoja);

    const filas = await hoja.getRows();
    const filaExistente = buscarFilaPorNodo(filas, municipioOficial, nodo);

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

    const { b1Final, b2Final, b3Final } = calcularAcumulacion(bloqueActivo, reporte, historial);
    const totalFinal = b1Final + b2Final + b3Final;

    if (totalFinal > limiteVerificadores) {
      if (esEdicion) {
        await _marcarFilaParaRevision(doc, messageId);
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
      `\n│ 💾 VALORES RESULTANTES A GUARDAR:` +
      `\n│    • Final B1 (9am):     ${b1Final}` +
      `\n│    • Final B2 (2pm):     ${b2Final}` +
      `\n│    • Final B3 (6pm):     ${b3Final}` +
      `\n│    • Final Total:        ${totalFinal}` +
      `\n└────────────────────────────────────────────────────────┘\n`
    );

    const datosFinales = {
      municipioOficial,
      nodo,
      fecha,
      hora,
      b1Final,
      b2Final,
      b3Final,
      totalFinal,
      remitente,
      messageId,
      chatId,
    };

    if (esDBActiva()) {
      try {
        const reporteGuardado = await guardarOActualizarReporteDB(datosFinales);
        await registrarAuditoriaDB({
          chatId,
          messageId,
          remitente,
          accion: esEdicion ? "EDICION" : "CREACION",
          detalles: datosFinales,
          reporteId:       reporteGuardado?.id            ?? null,
          catalogoNodoId:  reporteGuardado?.catalogo_nodo_id ?? null,
        });
      } catch (errDb: any) {
        console.error("[ERROR] Falló guardado en Base de Datos:", errDb.message);
      }
    }

    const datosHoja = {
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
      filaExistente.assign(datosHoja);
      await filaExistente.save();
      console.log(`[INFO] Fila fija actualizada en Google Sheets (Municipio: ${municipioOficial}, Nodo: ${nodo}, Mensaje ID: ${messageId}).`);
    } else {
      await hoja.addRow(datosHoja);
      console.log(`[INFO] Fila nueva creada en Google Sheets como fallback (Mensaje ID: ${messageId}).`);
    }

    if (esDBActiva()) {
      await marcarReporteSincronizadoDB(nodo, fecha);
    }

    return {
      valido: true,
      municipioOficial,
      totalFinal,
      b1Final,
      b2Final,
      b3Final
    };
  });
}
