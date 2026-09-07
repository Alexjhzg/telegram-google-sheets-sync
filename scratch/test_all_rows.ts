import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function testAllRowsWithNotEqual() {
  await sheetsMutex.runExclusive(async () => {
    const doc = await obtenerHojaDeCalculo();
    const sheetReporte = doc.sheetsByTitle["reporte_nodo"];
    await sheetReporte.loadCells("A1:G50");

    for (let r = 1; r < 45; r++) {
      const mun = sheetReporte.getCell(r, 0).value;
      const nod = sheetReporte.getCell(r, 1).value;
      if (!mun || mun === "TOTAL") continue;

      const numFila = r + 1;
      const cellF = sheetReporte.getCell(r, 5);
      cellF.formula = `=IF(D${numFila}>0, "S", IF(COUNTIFS(registros_historicos_telegram!B:B, B${numFila}, registros_historicos_telegram!G:G, G${numFila}, registros_historicos_telegram!J:J, "<>")>0, "S", "N"))`;
    }

    await sheetReporte.saveUpdatedCells();
    await sheetReporte.loadCells("A1:G50");

    console.log("\n=== RESULTADOS CON FÓRMULA '<>' EN COLUMNA F ===");
    for (let r = 1; r < 45; r++) {
      const mun = sheetReporte.getCell(r, 0).value;
      const nod = sheetReporte.getCell(r, 1).value;
      if (!mun) continue;

      const dCell = sheetReporte.getCell(r, 3);
      const fCell = sheetReporte.getCell(r, 5);
      if (fCell.formattedValue === "N" || String(nod) === "16044" || String(nod) === "16051" || String(nod) === "16061" || String(nod) === "16063") {
        console.log(`Fila ${r + 1}: ${mun} Nodo ${nod} -> Campo(D)=${dCell.formattedValue}, Reportó(F)=${fCell.formattedValue}`);
      }
    }
  });
}

testAllRowsWithNotEqual();
