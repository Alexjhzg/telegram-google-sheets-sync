import { obtenerHojaDeCalculo, sheetsMutex, COLUMNAS } from "../src/services/sheets.js";
import { obtenerClienteDB, esDBActiva } from "../src/services/database.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function consolidarHistorico0709Batch() {
  console.log("==================================================");
  console.log(" CONSOLIDACIÓN BATCH DE HISTÓRICO PARA 07/09/2026");
  console.log("==================================================\n");

  await sheetsMutex.runExclusive(async () => {
    try {
      const doc = await obtenerHojaDeCalculo();
      const sheetHistorica = doc.sheetsByTitle["registros_historicos_telegram"];
      if (!sheetHistorica) {
        throw new Error("No existe la hoja 'registros_historicos_telegram'");
      }

      // 1. Obtener reportes completos desde Supabase DB para 2026-09-07
      const reportesDBMap = new Map<number, any>();
      if (esDBActiva()) {
        const client = obtenerClienteDB();
        if (client) {
          console.log("[INFO] Obteniendo reportes del 2026-09-07 desde Supabase DB...");
          const { data, error } = await client
            .from("reportes_diarios")
            .select("*")
            .or("fecha.eq.2026-09-07,fecha.eq.07/09/2026");

          if (error) {
            console.error("Error al consultar DB:", error.message);
          } else if (data) {
            console.log(`[INFO] Se encontraron ${data.length} reportes en DB para el 07/09/2026.`);
            data.forEach((r: any) => {
              const nod = parseInt(String(r.nodo), 10);
              reportesDBMap.set(nod, r);
            });
          }
        }
      } else {
        console.warn("⚠️ Base de datos no activa. No se pudieron cargar los reportes de Supabase.");
        return;
      }

      // 2. Obtener filas del histórico en Google Sheets para '07/09/2026'
      const filas = await sheetHistorica.getRows();
      console.log(`[INFO] Total de filas actuales en 'registros_historicos_telegram': ${filas.length}`);

      const filas0709 = filas.filter(f => (f.get(COLUMNAS.FECHA) || "").trim() === "07/09/2026");
      console.log(`[INFO] Filas encontradas con fecha '07/09/2026': ${filas0709.length}`);

      if (filas0709.length === 0) {
        console.warn("⚠️ No se encontraron filas para '07/09/2026' en la hoja histórica.");
        return;
      }

      // 3. Cargar celdas del bloque '07/09/2026' en lote
      const minRowIndex = Math.min(...filas0709.map(f => f.rowNumber - 1));
      const maxRowIndex = Math.max(...filas0709.map(f => f.rowNumber - 1));

      console.log(`[INFO] Cargando celdas desde fila ${minRowIndex + 1} hasta ${maxRowIndex + 1}...`);
      await sheetHistorica.loadCells({
        startRowIndex: minRowIndex,
        endRowIndex: maxRowIndex + 1,
        startColumnIndex: 0,
        endColumnIndex: 12
      });

      // Mapeo de cabeceras a índices de columna
      await sheetHistorica.loadHeaderRow();
      const headers = sheetHistorica.headerValues;
      const colIdx = {
        tot: headers.indexOf(COLUMNAS.TOTAL_VERIFICADORES),
        b1: headers.indexOf(COLUMNAS.BLOQUE_1),
        b2: headers.indexOf(COLUMNAS.BLOQUE_2),
        b3: headers.indexOf(COLUMNAS.BLOQUE_3),
        fecha: headers.indexOf(COLUMNAS.FECHA),
        hora: headers.indexOf(COLUMNAS.HORA),
        rem: headers.indexOf(COLUMNAS.REMITENTE),
        msgId: headers.indexOf(COLUMNAS.ID_MENSAJE),
        chatId: headers.indexOf(COLUMNAS.ID_CHAT),
        estado: headers.indexOf(COLUMNAS.ESTADO),
      };

      let actualizados = 0;
      for (const fila of filas0709) {
        const rowIndex = fila.rowNumber - 1;
        const nod = parseInt(fila.get(COLUMNAS.NODO) || "0", 10);
        const repDB = reportesDBMap.get(nod);

        if (repDB) {
          const total = Number(repDB.total_verificadores ?? 0);
          const b1 = Number(repDB.bloque_1 ?? 0);
          const b2 = Number(repDB.bloque_2 ?? 0);
          const b3 = Number(repDB.bloque_3 ?? 0);
          const hora = repDB.hora || "";
          const remitente = repDB.remitente || "";
          const msgId = repDB.telegram_message_id ? String(repDB.telegram_message_id) : "";
          const chatId = repDB.telegram_chat_id ? String(repDB.telegram_chat_id) : "";
          const estado = repDB.estado || "OK";

          if (colIdx.tot >= 0) sheetHistorica.getCell(rowIndex, colIdx.tot).value = total;
          if (colIdx.b1 >= 0) sheetHistorica.getCell(rowIndex, colIdx.b1).value = b1;
          if (colIdx.b2 >= 0) sheetHistorica.getCell(rowIndex, colIdx.b2).value = b2;
          if (colIdx.b3 >= 0) sheetHistorica.getCell(rowIndex, colIdx.b3).value = b3;
          if (colIdx.fecha >= 0) sheetHistorica.getCell(rowIndex, colIdx.fecha).value = "07/09/2026";
          if (colIdx.hora >= 0) sheetHistorica.getCell(rowIndex, colIdx.hora).value = hora;
          if (colIdx.rem >= 0) sheetHistorica.getCell(rowIndex, colIdx.rem).value = remitente;
          if (colIdx.msgId >= 0) sheetHistorica.getCell(rowIndex, colIdx.msgId).value = msgId;
          if (colIdx.chatId >= 0) sheetHistorica.getCell(rowIndex, colIdx.chatId).value = chatId;
          if (colIdx.estado >= 0) sheetHistorica.getCell(rowIndex, colIdx.estado).value = estado;
          actualizados++;
        }
      }

      console.log(`[INFO] Guardando celdas actualizadas para ${actualizados} nodos en 1 sólo request batch...`);
      await sheetHistorica.saveUpdatedCells();
      console.log("[ÉXITO] Bloque '07/09/2026' consolidado y guardado en lote con éxito.");

    } catch (err: any) {
      console.error("❌ Error durante la consolidación batch:", err.message || err);
    }
  });
}

consolidarHistorico0709Batch();
