import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function chequearDetalleNodos() {
  await sheetsMutex.runExclusive(async () => {
    const doc = await obtenerHojaDeCalculo();
    const sheetHist = doc.sheetsByTitle["registros_historicos_telegram"];
    await sheetHist.loadHeaderRow();
    console.log("Header values:", sheetHist.headerValues);

    const rows = await sheetHist.getRows();
    const rows0309 = rows.filter(r => (r.get("Fecha") || "").trim() === "03/09/2026");

    const nodosDuda = ["16044", "16051", "16061", "16063"];

    for (const nod of nodosDuda) {
      const r = rows0309.find(row => String(row.get("Nodo")).trim() === nod);
      if (r) {
        console.log(`\n--- NODO ${nod} ---`);
        console.log("Raw row values:", r.toObject());
      } else {
        console.log(`\n--- NODO ${nod}: NO ENCONTRADO ---`);
      }
    }
  });
}

chequearDetalleNodos();
