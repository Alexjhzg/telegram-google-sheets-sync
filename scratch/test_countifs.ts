import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function probarFormula() {
  await sheetsMutex.runExclusive(async () => {
    const doc = await obtenerHojaDeCalculo();
    const sheetReporte = doc.sheetsByTitle["reporte_nodo"];
    const sheetHist = doc.sheetsByTitle["registros_historicos_telegram"];

    await sheetReporte.loadCells({ startRowIndex: 0, endRowIndex: 50, startColumnIndex: 0, endColumnIndex: 10 });
    await sheetHist.loadCells({ startRowIndex: 0, endRowIndex: 100, startColumnIndex: 0, endColumnIndex: 12 });

    for (let r = 1; r < 40; r++) {
      const mun = sheetReporte.getCell(r, 0).value;
      const nod = sheetReporte.getCell(r, 1).value;
      if (!mun || mun === "TOTAL") continue;

      const dCell = sheetReporte.getCell(r, 3); // Col D
      const fCell = sheetReporte.getCell(r, 5); // Col F (Reportó)

      if (fCell.formattedValue === "N") {
        console.log(`Fila ${r + 1}: Mun=${mun}, Nod=${nod} (type: ${typeof nod}), D_val=${dCell.value}, F_val=${fCell.value}, F_formatted=${fCell.formattedValue}, F_formula=${fCell.formula}`);
      }
    }

    // Encontrar en sheetHist dónde están los nodos en 03/09/2026
    for (let r = 1; r < 100; r++) {
      const nodVal = sheetHist.getCell(r, 1).value;
      const fechaVal = sheetHist.getCell(r, 6).value;
      if (fechaVal === "03/09/2026") {
        const jCell = sheetHist.getCell(r, 9); // Col J (ID Mensaje)
        const iCell = sheetHist.getCell(r, 8); // Col I (Remitente)
        const cCell = sheetHist.getCell(r, 2); // Col C (Total Verificadores)
        console.log(`Histórico Fila ${r + 1}: Nod=${nodVal} (${typeof nodVal}), Tot=${cCell.value} (${typeof cCell.value}), Rem=${iCell.value}, MsgID=${jCell.value} (type=${typeof jCell.value}, formatted=${JSON.stringify(jCell.formattedValue)})`);
      }
    }
  });
}

probarFormula();
