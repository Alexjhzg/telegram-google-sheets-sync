import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function probarSetI1() {
  await sheetsMutex.runExclusive(async () => {
    const doc = await obtenerHojaDeCalculo();
    const sheetReporte = doc.sheetsByTitle["reporte_nodo"];
    await sheetReporte.loadCells("I1:I1");
    const cellI1 = sheetReporte.getCellByA1("I1");
    cellI1.value = "03/09/2026";
    await sheetReporte.saveUpdatedCells();

    console.log("I1 actualizado a '03/09/2026'.");
  });
}

probarSetI1();
