import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function analizarFechasHistorico() {
  await sheetsMutex.runExclusive(async () => {
    const doc = await obtenerHojaDeCalculo();
    const sheetHist = doc.sheetsByTitle["registros_historicos_telegram"];
    const rows = await sheetHist.getRows();

    console.log(`Total de filas en registros_historicos_telegram: ${rows.length}`);

    const conteoFormatos: Record<string, number> = {};
    const ejemplosFormatos: Record<string, any[]> = {};

    await sheetHist.loadCells({ startRowIndex: 0, endRowIndex: 100, startColumnIndex: 6, endColumnIndex: 7 });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const val = row.get("Fecha");
      const key = `${JSON.stringify(val)} (typeof ${typeof val})`;

      conteoFormatos[key] = (conteoFormatos[key] || 0) + 1;
      if (!ejemplosFormatos[key]) ejemplosFormatos[key] = [];
      if (ejemplosFormatos[key].length < 3) {
        ejemplosFormatos[key].push({ row: i + 2, val, mun: row.get("Municipio"), nod: row.get("Nodo") });
      }
    }

    console.log("\n=== DIVERSIDAD DE FORMATOS DE FECHA EN 'registros_historicos_telegram' ===");
    for (const [formato, cantidad] of Object.entries(conteoFormatos)) {
      console.log(`\nFormato: ${formato} -> Cantidad: ${cantidad} filas`);
      console.log(" Ejemplos:", ejemplosFormatos[formato]);
    }
  });
}

analizarFechasHistorico();
