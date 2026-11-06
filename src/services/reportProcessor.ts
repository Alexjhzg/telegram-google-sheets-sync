import { GoogleSpreadsheet } from "google-spreadsheet";
import { config } from "../config/index.js";
import { convertirTimestamp, obtenerBloqueYHoraActivo } from "../utils/parser.js";
import { validarMunicipioNodo } from "./validation.js";
import { calcularAcumulacion } from "../utils/accumulation.js";
import { ejecutarConReintento } from "../utils/retry.js";
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
 * Aplica reintentos automáticos y previene excepciones no controladas.
 */
export async function eliminarReporte(messageId: number | string): Promise<boolean> {
  return sheetsMutex.runExclusive(async () => {
    try {
      const doc  = await obtenerHojaDeCalculo();
      const hoja = doc.sheetsByTitle["registros_telegram"];
      if (!hoja) return false;

      const filas = await ejecutarConReintento(
        () => hoja.getRows(),
        { contexto: `Lectura de filas para eliminar (Mensaje ID: ${messageId})`, maxIntentos: 3, retrasoBaseMs: 300 }
      );
      const fila = buscarFilaPorMensaje(filas, messageId);

      if (fila) {
        await ejecutarConReintento(
          () => resetearFila(fila),
          { contexto: `Resetear fila (Mensaje ID: ${messageId})`, maxIntentos: 3, retrasoBaseMs: 300 }
        );
        return true;
      }
      return false;
    } catch (error: any) {
      console.error(`[ERROR] No se pudo eliminar/resetear el reporte en Google Sheets (Mensaje ID: ${messageId}):`, error?.message ?? error);
      return false;
    }
  });
}

/**
 * Lógica interna para marcar una fila en revisión sin adquirir el lock.
 * Aplica reintentos en fila.save() para tolerancia a 503.
 */
async function _marcarFilaParaRevision(doc: GoogleSpreadsheet | null, messageId: number | string): Promise<void> {
  try {
    const documento = doc || await obtenerHojaDeCalculo();
    const hoja = documento.sheetsByTitle["registros_telegram"];
    if (!hoja) return;
    const filas = await ejecutarConReintento(
      () => hoja.getRows(),
      { contexto: `Lectura de filas para revisión (Mensaje ID: ${messageId})`, maxIntentos: 3, retrasoBaseMs: 300 }
    );
    const fila = buscarFilaPorMensaje(filas, messageId);
    if (fila) {
      const estadoActual = (fila.get(COLUMNAS.ESTADO) || "").toString();
      if (!estadoActual.startsWith("Revisión desde:")) {
        const ahoraIso = new Date().toISOString();
        fila.set(COLUMNAS.ESTADO, `Revisión desde: ${ahoraIso}`);
        await ejecutarConReintento(
          () => fila.save(),
          { contexto: `Marcar fila para revisión (Mensaje ID: ${messageId})`, maxIntentos: 3, retrasoBaseMs: 300 }
        );
        console.log(`[INFO] Fila marcada para revisión (Mensaje ID: ${messageId}).`);
      }
    }
  } catch (error: any) {
    console.error("[ERROR] No se pudo marcar la fila para revisión:", error?.message ?? error);
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
 * Procesa la lógica de negocio de un reporte con tolerancia a fallos 503 en Google Sheets.
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
  try {
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

    let doc: GoogleSpreadsheet;
    try {
      doc = await obtenerHojaDeCalculo();
    } catch (docErr: any) {
      console.error("[ERROR] Falló al obtener la hoja de cálculo:", docErr?.message ?? docErr);
      if (!esDBActiva()) {
        return {
          valido: false,
          razon: "ERROR_CONEXION_SHEETS",
          municipioOficial: municipio,
          municipioParseado: municipio,
          nodoParseado: nodo,
          sincronizadoSheets: false,
          persistidoDB: false,
        };
      }
      doc = null as any;
    }

    if (bloqueActivo === 0) {
      console.warn(`[ADVERTENCIA] Reporte rechazado: hora ${horaStr} VET fuera de jornada laboral.`);
      if (esEdicion && doc) {
        await marcarFilaParaRevision(doc, messageId);
      }
      return {
        valido: false,
        razon: "FUERA_DE_HORARIO",
        municipioOficial: municipio,
        municipioParseado: municipio,
        nodoParseado: nodo,
      };
    }

    let validacion: ValidacionResultado;
    if (esDBActiva()) {
      try {
        validacion = await validarMunicipioNodoDB(municipio, nodo);
        if (!validacion.valido && doc) {
          const valSheets = await validarMunicipioNodo(doc, municipio, nodo);
          if (valSheets.valido) {
            validacion = valSheets;
          }
        }
      } catch (e: any) {
        console.warn("[ADVERTENCIA] Falló validación en Base de Datos, utilizando fallback a Google Sheets:", e.message);
        if (doc) {
          validacion = await validarMunicipioNodo(doc, municipio, nodo);
        } else {
          return {
            valido: false,
            razon: "ERROR_CONEXION_SHEETS",
            municipioOficial: municipio,
            municipioParseado: municipio,
            nodoParseado: nodo,
          };
        }
      }
    } else {
      if (!doc) {
        return {
          valido: false,
          razon: "ERROR_CONEXION_SHEETS",
          municipioOficial: municipio,
          municipioParseado: municipio,
          nodoParseado: nodo,
        };
      }
      validacion = await validarMunicipioNodo(doc, municipio, nodo);
    }

    const { valido, limiteVerificadores, municipioOficial, razon } = validacion;
    if (!valido) {
      if (esEdicion && doc) {
        await marcarFilaParaRevision(doc, messageId);
      }
      return {
        valido: false,
        razon,
        municipioOficial,
        municipioParseado: municipio,
        nodoParseado: nodo,
      };
    }

    return await sheetsMutex.runExclusive(async () => {
      const documentoActual = doc || await obtenerHojaDeCalculo();
      const hoja = documentoActual.sheetsByTitle["registros_telegram"];
      if (!hoja) throw new Error("No existe la hoja registros_telegram");

      const filas = await ejecutarConReintento(
        () => hoja.getRows(),
        { contexto: "Lectura de filas en registros_telegram", maxIntentos: 3, retrasoBaseMs: 300 }
      );
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
          await _marcarFilaParaRevision(documentoActual, messageId);
        }
        return {
          valido: false,
          razon: "EXCESO_VERIFICADORES",
          municipioOficial,
          limiteVerificadores,
          totalFinal,
          b1Final,
          b2Final,
          b3Final,
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

      // 1. Persistencia en Base de Datos Relacional (si está activa)
      let persistidoDB = false;
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
          persistidoDB = true;
        } catch (errDb: any) {
          console.error("[ERROR] Falló guardado en Base de Datos:", errDb.message);
          persistidoDB = false;
        }
      }

      // 2. Persistencia en Google Sheets con reintentos protegidos
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

      let sincronizadoSheets = false;
      try {
        await asegurarColumnas(hoja);

        await ejecutarConReintento(
          async () => {
            if (filaExistente) {
              filaExistente.assign(datosHoja);
              await filaExistente.save();
              console.log(`[INFO] Fila fija actualizada en Google Sheets (Municipio: ${municipioOficial}, Nodo: ${nodo}, Mensaje ID: ${messageId}).`);
            } else {
              await hoja.addRow(datosHoja);
              console.log(`[INFO] Fila nueva creada en Google Sheets como fallback (Mensaje ID: ${messageId}).`);
            }
          },
          {
            contexto: `Escritura en Google Sheets (Nodo ${nodo})`,
            maxIntentos: 3,
            retrasoBaseMs: 400,
          }
        );
        sincronizadoSheets = true;

        if (esDBActiva() && persistidoDB) {
          await marcarReporteSincronizadoDB(nodo, fecha);
        }
      } catch (errorSheets: any) {
        console.error(`[ERROR] Persistencia en Google Sheets falló tras agotar reintentos (Nodo ${nodo}):`, errorSheets?.message ?? errorSheets);

        // Degradación graciosa si la BD relacional está activa y resguardó el reporte
        if (esDBActiva() && persistidoDB) {
          console.warn(`[DEGRADACIÓN GRACIOSA] Reporte de Nodo ${nodo} resguardado en Base de Datos (sincronizado_sheets = false). Continuando con éxito.`);
          return {
            valido: true,
            sincronizadoSheets: false,
            persistidoDB: true,
            municipioOficial,
            totalFinal,
            b1Final,
            b2Final,
            b3Final,
          };
        }

        // Si la BD no está activa o falló, Google Sheets era el único almacenamiento
        return {
          valido: false,
          sincronizadoSheets: false,
          persistidoDB: false,
          razon: "ERROR_CONEXION_SHEETS",
          municipioOficial,
          municipioParseado: municipio,
          nodoParseado: nodo,
        };
      }

      return {
        valido: true,
        sincronizadoSheets: true,
        persistidoDB: esDBActiva() ? persistidoDB : undefined,
        municipioOficial,
        totalFinal,
        b1Final,
        b2Final,
        b3Final,
      };
    });
  } catch (errorCritico: any) {
    console.error("[ERROR] Error crítico no controlado en procesarYGuardarReporte:", errorCritico?.message ?? errorCritico);
    return {
      valido: false,
      sincronizadoSheets: false,
      persistidoDB: false,
      razon: "ERROR_CONEXION_SHEETS",
    };
  }
}
