"use strict";

import {
  obtenerHojaDeCalculo,
  asegurarColumnas,
  buscarFilaPorNodo,
  COLUMNAS,
  sheetsMutex,
} from "./sheets.js";
import { obtenerClienteDB, esDBActiva } from "./database.js";

/**
 * Sincroniza un reporte específico hacia Google Sheets.
 * Esta función se ejecuta de forma asíncrona (background) para no bloquear la respuesta en Telegram.
 *
 * @param {object} datosReporte
 */
export async function sincronizarReporteAGoogleSheets(datosReporte) {
  return sheetsMutex.runExclusive(async () => {
    try {
      console.log(`[SYNC] Sincronizando reporte de Nodo ${datosReporte.nodo} (${datosReporte.fecha}) a Google Sheets...`);
      
      const doc = await obtenerHojaDeCalculo();
      const hoja = doc.sheetsByTitle["registros_telegram"];
      await asegurarColumnas(hoja);

      const filas = await hoja.getRows();
      const filaExistente = buscarFilaPorNodo(filas, datosReporte.municipioOficial, datosReporte.nodo);

      const datosHoja = {
        [COLUMNAS.MUNICIPIO]:           datosReporte.municipioOficial,
        [COLUMNAS.NODO]:                datosReporte.nodo,
        [COLUMNAS.TOTAL_VERIFICADORES]: datosReporte.totalFinal,
        [COLUMNAS.BLOQUE_1]:            datosReporte.b1Final,
        [COLUMNAS.BLOQUE_2]:            datosReporte.b2Final,
        [COLUMNAS.BLOQUE_3]:            datosReporte.b3Final,
        [COLUMNAS.FECHA]:               datosReporte.fecha,
        [COLUMNAS.HORA]:                datosReporte.hora,
        [COLUMNAS.REMITENTE]:           datosReporte.remitente,
        [COLUMNAS.ID_MENSAJE]:          String(datosReporte.messageId),
        [COLUMNAS.ID_CHAT]:             String(datosReporte.chatId),
        [COLUMNAS.ESTADO]:              "OK",
      };

      if (filaExistente) {
        filaExistente.assign(datosHoja);
        await filaExistente.save();
        console.log(`[SYNC] Fila fija en Google Sheets actualizada exitosamente (Nodo: ${datosReporte.nodo}).`);
      } else {
        await hoja.addRow(datosHoja);
        console.log(`[SYNC] Fila nueva en Google Sheets agregada exitosamente (Nodo: ${datosReporte.nodo}).`);
      }

      // Marcar como sincronizado en la Base de Datos si está activa
      if (esDBActiva()) {
        const client = obtenerClienteDB();
        if (client) {
          await client
            .from("reportes_diarios")
            .update({ sincronizado_sheets: true })
            .eq("nodo", parseInt(datosReporte.nodo, 10))
            .eq("fecha", datosReporte.fecha);
        }
      }
    } catch (error) {
      console.error(`[SYNC ERROR] No se pudo sincronizar el reporte a Google Sheets (Nodo: ${datosReporte.nodo}):`, error.message);
    }
  });
}
