import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function corregirFechasInvertidasBatch() {
  await sheetsMutex.runExclusive(async () => {
    try {
      const doc = await obtenerHojaDeCalculo();
      const sheetHist = doc.sheetsByTitle["registros_historicos_telegram"];
      if (!sheetHist) return;

      console.log("[1/3] Cargando todas las celdas de la columna Fecha (Col G)...");
      const rows = await sheetHist.getRows();
      const totalRows = rows.length + 5;

      await sheetHist.loadCells({
        startRowIndex: 0,
        endRowIndex: totalRows,
        startColumnIndex: 6,
        endColumnIndex: 7
      });

      let modifi08 = 0;
      let modifi09 = 0;
      let yaOk = 0;

      for (let r = 1; r <= rows.length; r++) {
        const cell = sheetHist.getCell(r, 6);
        const raw = String(cell.value || cell.formattedValue || "").trim();

        // 1. Detectar 08/XX/2026 (donde XX va de 01 a 12) que corresponden a Agosto (XX/08/2026)
        const match08 = /^08\/(\d{2})\/(\d{4})$/.exec(raw);
        if (match08) {
          const dia = match08[1];
          const anio = match08[2];
          cell.value = `${dia}/08/${anio}`;
          cell.numberFormat = { type: "TEXT", pattern: "@" };
          modifi08++;
          continue;
        }

        // 2. Detectar 09/03/2026 que corresponde a 03/09/2026 (3 de Septiembre de 2026)
        const match09 = /^09\/03\/(\d{4})$/.exec(raw);
        if (match09) {
          const anio = match09[1];
          cell.value = `03/09/${anio}`;
          cell.numberFormat = { type: "TEXT", pattern: "@" };
          modifi09++;
          continue;
        }

        yaOk++;
      }

      console.log(`[2/3] Guardando celdas actualizadas en 1 sola llamada BATCH...`);
      await sheetHist.saveUpdatedCells();

      console.log(`\n=== RESUMEN DE CORRECCIÓN EN BATCH ===`);
      console.log(`- Celdas corregidas de Agosto (08/DD -> DD/08): ${modifi08}`);
      console.log(`- Celdas corregidas de Septiembre (09/03 -> 03/09): ${modifi09}`);
      console.log(`- Celdas que ya estaban correctas: ${yaOk}`);

    } catch (err: any) {
      console.error("Error en corregirFechasInvertidasBatch:", err.message || err);
    }
  });
}

corregirFechasInvertidasBatch();
