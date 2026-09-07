import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function corregirFechasHistoricoDefinitivo() {
  await sheetsMutex.runExclusive(async () => {
    try {
      const doc = await obtenerHojaDeCalculo();
      const sheetHist = doc.sheetsByTitle["registros_historicos_telegram"];
      if (!sheetHist) return;

      const rows = await sheetHist.getRows();
      const totalRows = rows.length + 5;

      console.log(`[1/3] Cargando celdas de Fecha de ${rows.length} filas...`);
      await sheetHist.loadCells({
        startRowIndex: 0,
        endRowIndex: totalRows,
        startColumnIndex: 6,
        endColumnIndex: 7
      });

      let corregidosInvertidos = 0;
      let formatoAjustado = 0;

      // Mapeo de seriales invertidos de Febrero-Diciembre (08/02..08/12) a verdaderos seriales de Agosto (02/08..12/08)
      // Excel epoch serials:
      // 01/08/2026 = 46235
      // 02/08/2026 = 46236
      // 03/08/2026 = 46237
      // 04/08/2026 = 46238
      // 05/08/2026 = 46239
      // 06/08/2026 = 46240
      // 07/08/2026 = 46241
      // 08/08/2026 = 46242
      // 09/08/2026 = 46243
      // 10/08/2026 = 46244
      // 11/08/2026 = 46245
      // 12/08/2026 = 46246

      const mapInvertidosAgosto: Record<number, number> = {
        46061: 46236, // 08/02/2026 -> 02/08/2026
        46089: 46237, // 08/03/2026 -> 03/08/2026
        46120: 46238, // 08/04/2026 -> 04/08/2026
        46150: 46239, // 08/05/2026 -> 05/08/2026
        46181: 46240, // 08/06/2026 -> 06/08/2026
        46211: 46241, // 08/07/2026 -> 07/08/2026
        46303: 46244, // 08/10/2026 -> 10/08/2026
        46334: 46245, // 08/11/2026 -> 11/08/2026
        46364: 46246, // 08/12/2026 -> 12/08/2026
      };

      for (let r = 1; r <= rows.length; r++) {
        const cell = sheetHist.getCell(r, 6);
        const val = Number(cell.value);

        if (!isNaN(val) && mapInvertidosAgosto[val]) {
          cell.value = mapInvertidosAgosto[val];
          corregidosInvertidos++;
        }

        // Asegurar que TODAS las celdas de fecha tengan el formato visual dd/mm/yyyy
        cell.numberFormat = { type: "DATE", pattern: "dd/mm/yyyy" };
        formatoAjustado++;
      }

      console.log(`[2/3] Guardando celdas corregidas en BATCH...`);
      await sheetHist.saveUpdatedCells();

      console.log(`\n=== RESUMEN DE CORRECCIÓN FINAL ===`);
      console.log(`- Fechas de Agosto desinvertidas (08/M -> D/08): ${corregidosInvertidos}`);
      console.log(`- Formato visual de celda ajustado a 'dd/mm/yyyy': ${formatoAjustado}`);

    } catch (err: any) {
      console.error("Error al corregir histórico:", err.message || err);
    }
  });
}

corregirFechasHistoricoDefinitivo();
