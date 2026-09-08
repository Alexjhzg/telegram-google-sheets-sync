import { obtenerHojaDeCalculo, sheetsMutex, COLUMNAS } from "../src/services/sheets.js";
import { obtenerClienteDB, esDBActiva } from "../src/services/database.js";
import { estandarizarFecha } from "../src/utils/dateUtils.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function consolidarRangoSep() {
  console.log("==================================================");
  console.log(" CONSOLIDACIÓN Y LIMPIEZA DE HISTÓRICO (04 AL 06 SEP 2026)");
  console.log("==================================================\n");

  await sheetsMutex.runExclusive(async () => {
    try {
      const doc = await obtenerHojaDeCalculo();
      const sheetHistorica = doc.sheetsByTitle["registros_historicos_telegram"];
      if (!sheetHistorica) {
        throw new Error("No existe la hoja 'registros_historicos_telegram'");
      }

      if (!esDBActiva()) {
        throw new Error("La base de datos Supabase no está activa.");
      }

      const client = obtenerClienteDB();
      if (!client) {
        throw new Error("No se pudo obtener el cliente de Supabase DB.");
      }

      const fechas = [
        { std: "04/09/2026", iso: "2026-09-04" },
        { std: "05/09/2026", iso: "2026-09-05" },
        { std: "06/09/2026", iso: "2026-09-06" },
      ];

      for (const fObj of fechas) {
        const fechaStd = fObj.std;
        const fechaIso = fObj.iso;
        console.log(`\n--- PROCESANDO FECHA ${fechaStd} ---`);

        // 1. Obtener reportes desde Supabase DB
        const { data: reportesDB, error: dbErr } = await client
          .from("reportes_diarios")
          .select("*")
          .or(`fecha.eq.${fechaIso},fecha.eq.${fechaStd}`);

        if (dbErr) {
          console.error(`Error al consultar DB para ${fechaStd}:`, dbErr.message);
          continue;
        }

        const reportesDBMap = new Map<number, any>();
        (reportesDB || []).forEach((r: any) => {
          const nod = parseInt(String(r.nodo), 10);
          reportesDBMap.set(nod, r);
        });
        console.log(`[INFO] Encontrados ${reportesDBMap.size} reportes en Supabase DB para ${fechaStd}.`);

        // 2. Obtener filas de la hoja histórica
        let filas = await sheetHistorica.getRows();
        let filasFecha = filas.filter(f => {
          const rawF = (f.get(COLUMNAS.FECHA) || "").trim();
          return estandarizarFecha(rawF) === fechaStd || rawF === fechaStd;
        });

        console.log(`[INFO] Filas actuales en histórico para ${fechaStd}: ${filasFecha.length}`);

        // 3. Si hay duplicados (ej: 92 filas), eliminar las sobrantes conservando las primeras 46
        if (filasFecha.length > 46) {
          const sobrantes = filasFecha.slice(46);
          console.log(`[INFO] Detectadas ${filasFecha.length} filas (duplicadas). Eliminando ${sobrantes.length} filas sobrantes...`);
          for (let i = sobrantes.length - 1; i >= 0; i--) {
            await sobrantes[i].delete();
            await delay(1200); // Pausa de seguridad para evitar superar cuota API
          }
          console.log(`[EXITO] Duplicados eliminados para ${fechaStd}.`);

          // Recargar filas después del borrado
          filas = await sheetHistorica.getRows();
          filasFecha = filas.filter(f => {
            const rawF = (f.get(COLUMNAS.FECHA) || "").trim();
            return estandarizarFecha(rawF) === fechaStd || rawF === fechaStd;
          });
          console.log(`[INFO] Filas resultantes tras eliminación: ${filasFecha.length}`);
        }

        if (filasFecha.length === 0) {
          console.warn(`⚠️ No se encontraron filas para ${fechaStd}.`);
          continue;
        }

        // 4. Actualizar celdas en lote con datos de DB
        const minRowIndex = Math.min(...filasFecha.map(f => f.rowNumber - 1));
        const maxRowIndex = Math.max(...filasFecha.map(f => f.rowNumber - 1));

        console.log(`[INFO] Cargando celdas desde fila ${minRowIndex + 1} hasta ${maxRowIndex + 1}...`);
        await sheetHistorica.loadCells({
          startRowIndex: minRowIndex,
          endRowIndex: maxRowIndex + 1,
          startColumnIndex: 0,
          endColumnIndex: 12
        });

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
        for (const fila of filasFecha) {
          const rowIndex = fila.rowNumber - 1;
          const nod = parseInt(fila.get(COLUMNAS.NODO) || "0", 10);
          const repDB = reportesDBMap.get(nod);

          let total = 0, b1 = 0, b2 = 0, b3 = 0;
          let hora = "", remitente = "", msgId = "", chatId = "", estado = "";

          if (repDB) {
            total = Number(repDB.total_verificadores ?? 0);
            b1 = Number(repDB.bloque_1 ?? 0);
            b2 = Number(repDB.bloque_2 ?? 0);
            b3 = Number(repDB.bloque_3 ?? 0);
            hora = repDB.hora || "";
            remitente = repDB.remitente || "";
            msgId = repDB.telegram_message_id ? String(repDB.telegram_message_id) : "";
            chatId = repDB.telegram_chat_id ? String(repDB.telegram_chat_id) : "";
            estado = repDB.estado || "OK";
          }

          if (colIdx.tot >= 0) sheetHistorica.getCell(rowIndex, colIdx.tot).value = total;
          if (colIdx.b1 >= 0) sheetHistorica.getCell(rowIndex, colIdx.b1).value = b1;
          if (colIdx.b2 >= 0) sheetHistorica.getCell(rowIndex, colIdx.b2).value = b2;
          if (colIdx.b3 >= 0) sheetHistorica.getCell(rowIndex, colIdx.b3).value = b3;
          if (colIdx.fecha >= 0) sheetHistorica.getCell(rowIndex, colIdx.fecha).value = fechaStd;
          if (colIdx.hora >= 0) sheetHistorica.getCell(rowIndex, colIdx.hora).value = hora;
          if (colIdx.rem >= 0) sheetHistorica.getCell(rowIndex, colIdx.rem).value = remitente;
          if (colIdx.msgId >= 0) sheetHistorica.getCell(rowIndex, colIdx.msgId).value = msgId;
          if (colIdx.chatId >= 0) sheetHistorica.getCell(rowIndex, colIdx.chatId).value = chatId;
          if (colIdx.estado >= 0) sheetHistorica.getCell(rowIndex, colIdx.estado).value = estado;
          actualizados++;
        }

        console.log(`[INFO] Guardando celdas actualizadas para ${actualizados} nodos en 1 request batch...`);
        await sheetHistorica.saveUpdatedCells();
        console.log(`[ÉXITO] Fecha ${fechaStd} consolidada con éxito.`);

        // Pausa entre fechas
        await delay(2000);
      }

      console.log("\n==================================================");
      console.log(" ✅ CONSOLIDACIÓN DEL 04 AL 06 DE SEPTIEMBRE FINALIZADA");
      console.log("==================================================");

    } catch (err: any) {
      console.error("❌ Error durante la consolidación del rango:", err.message || err);
    }
  });
}

consolidarRangoSep();
