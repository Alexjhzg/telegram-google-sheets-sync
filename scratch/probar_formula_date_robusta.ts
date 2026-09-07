import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function probarFormulaDateRobusta() {
  await sheetsMutex.runExclusive(async () => {
    const doc = await obtenerHojaDeCalculo();
    const sheetReporte = doc.sheetsByTitle["reporte_nodo"];
    await sheetReporte.loadCells({ startRowIndex: 0, endRowIndex: 10, startColumnIndex: 0, endColumnIndex: 10 });

    const cellG2 = sheetReporte.getCellByA1("G2");
    cellG2.formula = `=IF(ISBLANK($I$1), TODAY() - 1, IF(ISNUMBER($I$1), $I$1, DATE(RIGHT($I$1,4), MID($I$1,4,2), LEFT($I$1,2))))`;
    cellG2.numberFormat = { type: "DATE", pattern: "dd/mm/yyyy" };

    await sheetReporte.saveUpdatedCells();
    await sheetReporte.loadCells({ startRowIndex: 0, endRowIndex: 10, startColumnIndex: 0, endColumnIndex: 10 });

    console.log("G2 value:", cellG2.value, "formattedValue:", cellG2.formattedValue);
  });
}

probarFormulaDateRobusta();
