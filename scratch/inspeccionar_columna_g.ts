import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function inspeccionarColumnaG() {
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

    const resumen: Record<string, number> = {};

    for (let r = 1; r <= rows.length; r++) {
      const cell = sheetHist.getCell(r, 6);
      const k = `value=${JSON.stringify(cell.value)} (${typeof cell.value}), formattedValue=${JSON.stringify(cell.formattedValue)}`;
      resumen[k] = (resumen[k] || 0) + 1;
    }

    console.log("=== RESUMEN DE CELDAS EN COLUMNA G (FECHA) DE HISTÓRICO ===");
    for (const [k, cant] of Object.entries(resumen)) {
      console.log(`${k} -> ${cant} filas`);
    }
  });
}

inspeccionarColumnaG();
