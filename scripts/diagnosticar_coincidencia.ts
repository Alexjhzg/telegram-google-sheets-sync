import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function diagnosticarCoincidencia() {
  console.log("=== DIAGNOSTICANDO TIPOS DE DATOS EN FECHA (reporte_nodo VS registros_historicos_telegram) ===");

  await sheetsMutex.runExclusive(async () => {
    try {
      const doc = await obtenerHojaDeCalculo();

      const hojaReporte = doc.sheetsByTitle["reporte_nodo"];
      const hojaHistorico = doc.sheetsByTitle["registros_historicos_telegram"];

      if (!hojaReporte || !hojaHistorico) {
        console.error("No se encontraron las hojas necesarias");
        return;
      }

      await hojaReporte.loadCells("A1:I5");
      await hojaHistorico.loadCells("A1:L5");

      console.log("\n--- DETALLE DE 'reporte_nodo' ---");
      const i1 = hojaReporte.getCellByA1("I1");
      console.log(`I1 (Fecha Deseada): value=${JSON.stringify(i1.value)} (typeof ${typeof i1.value}), formattedValue=${JSON.stringify(i1.formattedValue)}, formula=${JSON.stringify(i1.formula)}`);

      const g2 = hojaReporte.getCellByA1("G2");
      console.log(`G2 (Fecha calculada en reporte_nodo): value=${JSON.stringify(g2.value)} (typeof ${typeof g2.value}), formattedValue=${JSON.stringify(g2.formattedValue)}, formula=${JSON.stringify(g2.formula)}`);

      const d2 = hojaReporte.getCellByA1("D2");
      console.log(`D2 (Fórmula SUMIFS): value=${JSON.stringify(d2.value)}, formattedValue=${JSON.stringify(d2.formattedValue)}, formula=${JSON.stringify(d2.formula)}`);

      console.log("\n--- DETALLE DE LAS PRIMERAS FILAS DE 'registros_historicos_telegram' ---");
      for (let r = 1; r <= 3; r++) {
        const mun = hojaHistorico.getCell(r, 0); // Col A
        const nod = hojaHistorico.getCell(r, 1); // Col B
        const tot = hojaHistorico.getCell(r, 2); // Col C
        const fec = hojaHistorico.getCell(r, 6); // Col G (Fecha)

        console.log(`Fila ${r + 1}: Municipio=${JSON.stringify(mun.value)}, Nodo=${JSON.stringify(nod.value)}, Total=${JSON.stringify(tot.value)}, Fecha: value=${JSON.stringify(fec.value)} (typeof ${typeof fec.value}), formattedValue=${JSON.stringify(fec.formattedValue)}`);
      }

    } catch (err: any) {
      console.error("Error en diagnóstico:", err);
    }
  });
}

diagnosticarCoincidencia();
