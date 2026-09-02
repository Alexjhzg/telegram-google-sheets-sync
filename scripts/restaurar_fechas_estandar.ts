import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";
import { estandarizarFecha } from "../src/utils/dateUtils.js";

async function restaurarFechasEstandar() {
  console.log("=== RESTAURANDO FECHAS A FORMATO TEXTO ESTÁNDAR DD/MM/YYYY ===");

  await sheetsMutex.runExclusive(async () => {
    try {
      const doc = await obtenerHojaDeCalculo();
      const hojaReporte = doc.sheetsByTitle["reporte_nodo"];
      const hojaHistorico = doc.sheetsByTitle["registros_historicos_telegram"];
      const hojaTelegram = doc.sheetsByTitle["registros_telegram"];

      if (!hojaReporte || !hojaHistorico) return;

      // 1. Asegurar registros_historicos_telegram
      const filasHist = await hojaHistorico.getRows();
      const totalFilasHist = filasHist.length + 5;
      await hojaHistorico.loadCells(`G1:G${totalFilasHist}`);

      for (let i = 0; i < filasHist.length; i++) {
        const cell = hojaHistorico.getCell(i + 1, 6);
        const raw = String(cell.value || cell.formattedValue || "").trim();
        const std = estandarizarFecha(raw);
        if (std) {
          cell.value = std;
          cell.numberFormat = { type: "TEXT", pattern: "@" };
        }
      }
      await hojaHistorico.saveUpdatedCells();
      console.log("[INFO] registros_historicos_telegram actualizado a texto DD/MM/YYYY.");

      // 2. Registros telegram
      if (hojaTelegram) {
        const filasTel = await hojaTelegram.getRows();
        const totalFilasTel = filasTel.length + 5;
        await hojaTelegram.loadCells(`G1:G${totalFilasTel}`);

        for (let i = 0; i < filasTel.length; i++) {
          const cell = hojaTelegram.getCell(i + 1, 6);
          const raw = String(cell.value || cell.formattedValue || "").trim();
          const std = estandarizarFecha(raw);
          if (std) {
            cell.value = std;
            cell.numberFormat = { type: "TEXT", pattern: "@" };
          }
        }
        await hojaTelegram.saveUpdatedCells();
        console.log("[INFO] registros_telegram actualizado a texto DD/MM/YYYY.");
      }

      // 3. reporte_nodo
      const cantFilasNodos = (await hojaReporte.getRows()).length;
      const totalFilasReporte = cantFilasNodos + 5;
      await hojaReporte.loadCells(`A1:K${totalFilasReporte}`);

      const cellI1 = hojaReporte.getCellByA1("I1");
      cellI1.value = "01/09/2026";
      cellI1.numberFormat = { type: "TEXT", pattern: "@" };

      const formulaRobusta = `=IF(ISBLANK($I$1), TEXT(TODAY() - 1, "dd/mm/yyyy"), IF(ISTEXT($I$1), $I$1, TEXT($I$1, "dd/mm/yyyy")))`;

      for (let r = 1; r <= cantFilasNodos; r++) {
        const cellG = hojaReporte.getCell(r, 6);
        cellG.formula = formulaRobusta;
      }
      await hojaReporte.saveUpdatedCells();
      console.log("[INFO] reporte_nodo actualizado a fórmula texto compatible.");

      // Verificar
      await hojaReporte.loadCells(`A1:K${totalFilasReporte}`);
      const g2 = hojaReporte.getCellByA1("G2");
      const d2 = hojaReporte.getCellByA1("D2");

      console.log("\n=== VERIFICACIÓN DE REPORTE_NODO ===");
      console.log(`Celda I1: value=${cellI1.value}, formattedValue="${cellI1.formattedValue}"`);
      console.log(`Celda G2: value=${g2.value}, formattedValue="${g2.formattedValue}"`);
      console.log(`Celda D2 (SUMIFS): value=${d2.value}, formattedValue="${d2.formattedValue}"`);

      let sumaD = 0;
      for (let r = 1; r <= cantFilasNodos; r++) {
        const valD = parseFloat(String(hojaReporte.getCell(r, 3).value || 0));
        if (!isNaN(valD)) sumaD += valD;
      }
      console.log(`Suma total de verificadores en campo: ${sumaD}`);

    } catch (err: any) {
      console.error("Error al restaurar:", err);
    }
  });
}

restaurarFechasEstandar();
