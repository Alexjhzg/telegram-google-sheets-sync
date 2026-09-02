import { obtenerHojaDeCalculo, COLUMNAS, sheetsMutex } from "../src/services/sheets.js";
import { estandarizarFecha } from "../src/utils/dateUtils.js";

/**
 * Convierte todas las fechas de Google Sheets a números de serie de fecha verdaderos (Date Serials)
 * con el formato visual de celda 'dd/mm/yyyy'.
 * Esto garantiza compatibilidad 100% tanto en Google Sheets web como en Microsoft Excel descargado (.xlsx).
 */
async function aplicarFechasNativasExcel() {
  console.log("=== APLICANDO FORMATO NATIVO DE FECHA PARA EXCEL Y GOOGLE SHEETS ===");

  await sheetsMutex.runExclusive(async () => {
    try {
      const doc = await obtenerHojaDeCalculo();
      const hojaReporte = doc.sheetsByTitle["reporte_nodo"];
      const hojaHistorico = doc.sheetsByTitle["registros_historicos_telegram"];
      const hojaTelegram = doc.sheetsByTitle["registros_telegram"];

      if (!hojaReporte || !hojaHistorico) return;

      // 1. Convertir todas las fechas de 'registros_historicos_telegram' a seriales de Fecha nativos
      console.log("[1/3] Convertiendo fechas en 'registros_historicos_telegram' a Fecha nativa...");
      const filasHist = await hojaHistorico.getRows();
      const totalFilasHist = filasHist.length + 5;
      await hojaHistorico.loadCells(`G1:G${totalFilasHist}`);

      let convHist = 0;
      for (let i = 0; i < filasHist.length; i++) {
        const cell = hojaHistorico.getCell(i + 1, 6);
        const raw = String(cell.value || cell.formattedValue || "").trim();
        if (raw) {
          const std = estandarizarFecha(raw); // "DD/MM/YYYY"
          if (std) {
            const partes = std.split("/");
            const dia = parseInt(partes[0], 10);
            const mes = parseInt(partes[1], 10);
            const anio = parseInt(partes[2], 10);

            const d = Date.UTC(anio, mes - 1, dia);
            const excelEpoch = Date.UTC(1899, 11, 30);
            const serial = Math.round((d - excelEpoch) / 86400000);

            cell.value = serial;
            cell.numberFormat = { type: "DATE", pattern: "dd/mm/yyyy" };
            convHist++;
          }
        }
      }
      await hojaHistorico.saveUpdatedCells();
      console.log(`[INFO] Se convirtieron ${convHist} filas en 'registros_historicos_telegram' a fecha nativa.`);

      // 2. Convertir fechas en 'registros_telegram'
      if (hojaTelegram) {
        console.log("[2/3] Convertiendo fechas en 'registros_telegram'...");
        const filasTel = await hojaTelegram.getRows();
        const totalFilasTel = filasTel.length + 5;
        await hojaTelegram.loadCells(`G1:G${totalFilasTel}`);

        let convTel = 0;
        for (let i = 0; i < filasTel.length; i++) {
          const cell = hojaTelegram.getCell(i + 1, 6);
          const raw = String(cell.value || cell.formattedValue || "").trim();
          if (raw) {
            const std = estandarizarFecha(raw);
            if (std) {
              const partes = std.split("/");
              const dia = parseInt(partes[0], 10);
              const mes = parseInt(partes[1], 10);
              const anio = parseInt(partes[2], 10);

              const d = Date.UTC(anio, mes - 1, dia);
              const excelEpoch = Date.UTC(1899, 11, 30);
              const serial = Math.round((d - excelEpoch) / 86400000);

              cell.value = serial;
              cell.numberFormat = { type: "DATE", pattern: "dd/mm/yyyy" };
              convTel++;
            }
          }
        }
        await hojaTelegram.saveUpdatedCells();
        console.log(`[INFO] Se convirtieron ${convTel} filas en 'registros_telegram' a fecha nativa.`);
      }

      // 3. Ajustar I1 y las fórmulas de 'reporte_nodo'
      console.log("[3/3] Ajustando fórmulas y celda I1 en 'reporte_nodo'...");
      const cantFilasNodos = (await hojaReporte.getRows()).length;
      const totalFilasReporte = cantFilasNodos + 5;
      await hojaReporte.loadCells(`A1:K${totalFilasReporte}`);

      // I1 como Fecha Nativa (ej. 01/09/2026)
      const cellI1 = hojaReporte.getCellByA1("I1");
      const dSep1 = Date.UTC(2026, 8, 1); // 1-Sep-2026
      const serialSep1 = Math.round((dSep1 - Date.UTC(1899, 11, 30)) / 86400000);
      cellI1.value = serialSep1;
      cellI1.numberFormat = { type: "DATE", pattern: "dd/mm/yyyy" };

      // Fórmula limpia y 100% compatible con Excel en G2..Gn
      const formulaNativa = `=IF(ISBLANK($I$1), TODAY() - 1, $I$1)`;

      for (let r = 1; r <= cantFilasNodos; r++) {
        const cellG = hojaReporte.getCell(r, 6);
        cellG.formula = formulaNativa;
        cellG.numberFormat = { type: "DATE", pattern: "dd/mm/yyyy" };
      }

      await hojaReporte.saveUpdatedCells();
      console.log("[INFO] Fórmulas y formatos en 'reporte_nodo' aplicados exitosamente.");

      // Cargar y verificar
      await hojaReporte.loadCells(`A1:K${totalFilasReporte}`);
      const g2 = hojaReporte.getCellByA1("G2");
      const d2 = hojaReporte.getCellByA1("D2");

      console.log("\n=== VERIFICACIÓN FINAL ===");
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
      console.error("Error aplicando fechas nativas:", err);
    }
  });
}

aplicarFechasNativasExcel();
