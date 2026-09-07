import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function verificarCorreccionSeptiembre() {
  await sheetsMutex.runExclusive(async () => {
    try {
      const doc = await obtenerHojaDeCalculo();
      const sheetHist = doc.sheetsByTitle["registros_historicos_telegram"];
      if (!sheetHist) return;

      const rows = await sheetHist.getRows();
      await sheetHist.loadCells({
        startRowIndex: 4400,
        endRowIndex: rows.length + 1,
        startColumnIndex: 0,
        endColumnIndex: 12
      });

      let cont04 = 0, cont05 = 0, cont06 = 0, cont07 = 0;

      for (let i = 4400; i < rows.length; i++) {
        const cell = sheetHist.getCell(i + 1, 6);
        const val = cell.value;
        const fmt = String(cell.formattedValue || "");

        if (val === 46121 || fmt === "09/04/2026") cont04++;
        if (val === 46151 || fmt === "09/05/2026") cont05++;
        if (val === 46182 || fmt === "09/06/2026") cont06++;
        if (val === 46213 || fmt === "09/07/2026") cont07++;
      }

      console.log("=== SIMULACIÓN DE CORRECCIÓN DE FECHAS DE SEPTIEMBRE EN HISTÓRICO ===");
      console.log(`- Registros del 04/09 (confundidos como 09/04 Abril 9): ${cont04} filas`);
      console.log(`- Registros del 05/09 (confundidos como 09/05 Mayo 9): ${cont05} filas`);
      console.log(`- Registros del 06/09 (confundidos como 09/06 Junio 9): ${cont06} filas`);
      console.log(`- Registros del 07/09 (confundidos como 09/07 Julio 9): ${cont07} filas`);

    } catch (err: any) {
      console.error("Error:", err);
    }
  });
}

verificarCorreccionSeptiembre();
