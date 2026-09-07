import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function testFormulaVariants() {
  await sheetsMutex.runExclusive(async () => {
    const doc = await obtenerHojaDeCalculo();
    const sheetReporte = doc.sheetsByTitle["reporte_nodo"];
    await sheetReporte.loadCells("A7:J7");

    // CARIPE 16044 is on row 7 (index 6)
    // Cell F7 is (6, 5)
    const cellF7 = sheetReporte.getCell(6, 5);
    console.log("Current formula F7:", cellF7.formula);
    console.log("Current formatted value F7:", cellF7.formattedValue);

    // Test changing formula to use "<>" instead of "?*"
    cellF7.formula = `=IF(D7>0, "S", IF(COUNTIFS(registros_historicos_telegram!B:B, B7, registros_historicos_telegram!G:G, G7, registros_historicos_telegram!J:J, "<>")>0, "S", "N"))`;
    await sheetReporte.saveUpdatedCells();

    // Reload cells to see Google Sheets calculated value
    await sheetReporte.loadCells("F7");
    console.log("New formula F7:", cellF7.formula);
    console.log("New calculated formatted value F7:", cellF7.formattedValue);
  });
}

testFormulaVariants();
