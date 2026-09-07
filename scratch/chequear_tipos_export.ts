import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function chequearTiposEnSheet() {
  await sheetsMutex.runExclusive(async () => {
    const doc = await obtenerHojaDeCalculo();
    const sheetHist = doc.sheetsByTitle["registros_historicos_telegram"];
    const sheetReporte = doc.sheetsByTitle["reporte_nodo"];

    await sheetReporte.loadCells("A1:G5");
    const g2 = sheetReporte.getCellByA1("G2");
    console.log("reporte_nodo G2:");
    console.log(`  value: ${JSON.stringify(g2.value)} (type: ${typeof g2.value})`);
    console.log(`  formattedValue: ${JSON.stringify(g2.formattedValue)}`);
    console.log(`  formula: ${JSON.stringify(g2.formula)}`);

    const rowsHist = await sheetHist.getRows();
    const rows0309 = rowsHist.filter(r => (r.get("Fecha") || "").trim() === "03/09/2026");

    if (rows0309.length > 0) {
      const minRowIndex = Math.min(...rows0309.map(f => f.rowNumber - 1));
      await sheetHist.loadCells({
        startRowIndex: minRowIndex,
        endRowIndex: minRowIndex + 5,
        startColumnIndex: 0,
        endColumnIndex: 12
      });

      console.log("\nregistros_historicos_telegram (primeras 3 filas de 03/09/2026):");
      for (let r = minRowIndex; r < minRowIndex + 3; r++) {
        const nod = sheetHist.getCell(r, 1);
        const tot = sheetHist.getCell(r, 2);
        const fec = sheetHist.getCell(r, 6);
        console.log(`Fila ${r + 1}:`);
        console.log(`  Nodo (Col B): value=${JSON.stringify(nod.value)} (${typeof nod.value})`);
        console.log(`  Total (Col C): value=${JSON.stringify(tot.value)} (${typeof tot.value})`);
        console.log(`  Fecha (Col G): value=${JSON.stringify(fec.value)} (${typeof fec.value}), formattedValue=${JSON.stringify(fec.formattedValue)}, numberFormat=${JSON.stringify(fec.numberFormat)}`);
      }
    }
  });
}

chequearTiposEnSheet();
