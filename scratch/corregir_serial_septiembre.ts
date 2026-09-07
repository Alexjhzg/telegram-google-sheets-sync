import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function corregirSerialSeptiembre() {
  await sheetsMutex.runExclusive(async () => {
    const doc = await obtenerHojaDeCalculo();
    const sheetHist = doc.sheetsByTitle["registros_historicos_telegram"];
    const rows = await sheetHist.getRows();

    await sheetHist.loadCells({
      startRowIndex: 0,
      endRowIndex: rows.length + 5,
      startColumnIndex: 6,
      endColumnIndex: 7
    });

    let corregidos = 0;
    for (let r = 1; r <= rows.length; r++) {
      const cell = sheetHist.getCell(r, 6);
      if (Number(cell.value) === 46090 || cell.formattedValue === "09/03/2026" || cell.formattedValue === "9/3/2026") {
        cell.value = 46268; // 03/09/2026 en serial de Excel
        cell.numberFormat = { type: "DATE", pattern: "dd/mm/yyyy" };
        corregidos++;
      }
    }

    await sheetHist.saveUpdatedCells();
    console.log(`✅ Corregidas ${corregidos} filas de Septiembre 3 para tener el serial exacto 46268 (03/09/2026).`);
  });
}

corregirSerialSeptiembre();
