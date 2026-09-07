import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function probarFechaNativaG2() {
  await sheetsMutex.runExclusive(async () => {
    const doc = await obtenerHojaDeCalculo();
    const sheetReporte = doc.sheetsByTitle["reporte_nodo"];
    await sheetReporte.loadCells({ startRowIndex: 0, endRowIndex: 50, startColumnIndex: 0, endColumnIndex: 10 });

    const cellG2 = sheetReporte.getCellByA1("G2");
    console.log("Fórmula anterior G2:", cellG2.formula);

    cellG2.formula = `=IF(ISBLANK($I$1), TODAY() - 1, IF(ISNUMBER($I$1), $I$1, DATEVALUE($I$1)))`;
    cellG2.numberFormat = { type: "DATE", pattern: "dd/mm/yyyy" };

    for (let r = 2; r < 47; r++) {
      const cellG = sheetReporte.getCell(r, 6);
      cellG.formula = `=G2`;
      cellG.numberFormat = { type: "DATE", pattern: "dd/mm/yyyy" };
    }

    await sheetReporte.saveUpdatedCells();
    await sheetReporte.loadCells({ startRowIndex: 0, endRowIndex: 50, startColumnIndex: 0, endColumnIndex: 10 });

    console.log("Nueva G2 value:", cellG2.value, "formattedValue:", cellG2.formattedValue);

    const d2 = sheetReporte.getCellByA1("D2");
    const d7 = sheetReporte.getCellByA1("D7");
    const f7 = sheetReporte.getCellByA1("F7");
    console.log(`D2: ${d2.value}, D7: ${d7.value}, F7: ${f7.formattedValue}`);
  });
}

probarFechaNativaG2();
