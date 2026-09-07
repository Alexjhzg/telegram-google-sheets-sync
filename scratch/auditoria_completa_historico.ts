import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function auditoriaCompletaHistorico() {
  await sheetsMutex.runExclusive(async () => {
    try {
      const doc = await obtenerHojaDeCalculo();
      const sheetHist = doc.sheetsByTitle["registros_historicos_telegram"];
      if (!sheetHist) return;

      const rows = await sheetHist.getRows();
      console.log(`Total de filas en registros_historicos_telegram: ${rows.length}`);

      await sheetHist.loadCells({
        startRowIndex: 0,
        endRowIndex: rows.length + 1,
        startColumnIndex: 0,
        endColumnIndex: 12
      });

      await sheetHist.loadHeaderRow();

      // Agrupamos por fecha (o rango de filas consecutivas con la misma fecha)
      const bloques: Array<{ minRow: number; maxRow: number; count: number; fechaStr: string; rawVal: any; formattedVal: string }> = [];

      let currentBlock: any = null;

      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 2;
        const cell = sheetHist.getCell(i + 1, 6);
        const rawVal = cell.value;
        const formattedVal = String(cell.formattedValue || "");
        const fechaStr = String(rawVal ?? formattedVal);

        if (!currentBlock || currentBlock.fechaStr !== fechaStr || currentBlock.formattedVal !== formattedVal) {
          if (currentBlock) bloques.push(currentBlock);
          currentBlock = { minRow: rowNum, maxRow: rowNum, count: 1, fechaStr, rawVal, formattedVal };
        } else {
          currentBlock.maxRow = rowNum;
          currentBlock.count++;
        }
      }
      if (currentBlock) bloques.push(currentBlock);

      console.log("\n=======================================================");
      console.log(" AUDITORÍA COMPLETA DE TODAS LAS FECHAS EN HISTÓRICO");
      console.log("=======================================================\n");

      bloques.forEach((b, idx) => {
        console.log(`Bloque ${idx + 1} | Filas ${b.minRow}..${b.maxRow} (${b.count} filas) | Raw: ${JSON.stringify(b.rawVal)} | Formatted: "${b.formattedVal}"`);
      });

    } catch (err: any) {
      console.error("Error en auditoría:", err);
    }
  });
}

auditoriaCompletaHistorico();
