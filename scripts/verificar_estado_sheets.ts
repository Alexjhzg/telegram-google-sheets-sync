import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function verificarEstadoSheets() {
  console.log("=== VERIFICANDO ESTADO ACTUAL EN GOOGLE SHEETS ===");

  await sheetsMutex.runExclusive(async () => {
    try {
      const doc = await obtenerHojaDeCalculo();
      const hojaReporte = doc.sheetsByTitle["reporte_nodo"];
      if (!hojaReporte) return;

      await hojaReporte.loadCells("A1:K5");

      const i1 = hojaReporte.getCellByA1("I1");
      const g2 = hojaReporte.getCellByA1("G2");
      const d2 = hojaReporte.getCellByA1("D2");

      console.log(`I1: value=${JSON.stringify(i1.value)}, formattedValue=${JSON.stringify(i1.formattedValue)}, numberFormat=${JSON.stringify(i1.numberFormat)}`);
      console.log(`G2: value=${JSON.stringify(g2.value)}, formattedValue=${JSON.stringify(g2.formattedValue)}, formula=${JSON.stringify(g2.formula)}, numberFormat=${JSON.stringify(g2.numberFormat)}`);
      console.log(`D2 (SUMIFS): value=${JSON.stringify(d2.value)}, formattedValue=${JSON.stringify(d2.formattedValue)}`);

    } catch (err: any) {
      console.error("Error al verificar estado:", err);
    }
  });
}

verificarEstadoSheets();
