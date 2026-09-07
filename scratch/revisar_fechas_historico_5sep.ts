import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function informeCompletoFechas() {
  await sheetsMutex.runExclusive(async () => {
    try {
      const doc = await obtenerHojaDeCalculo();

      // Pestaña Histórico
      const sheetHist = doc.sheetsByTitle["registros_historicos_telegram"];
      if (sheetHist) {
        const rowsHist = await sheetHist.getRows();
        await sheetHist.loadCells({
          startRowIndex: 4400,
          endRowIndex: rowsHist.length + 1,
          startColumnIndex: 0,
          endColumnIndex: 12
        });

        await sheetHist.loadHeaderRow();
        const headers = sheetHist.headerValues;
        const colFechaIdx = headers.indexOf("Fecha");

        console.log("=== INFORME DETALLADO DE HISTÓRICO (FILAS 4401 A " + (rowsHist.length + 1) + ") ===");

        const bloques: Record<string, { total: number; minFila: number; maxFila: number; rawSample: any; formattedSample: string; fechaReal: string }> = {};

        for (let i = 4400; i < rowsHist.length; i++) {
          const rowNum = i + 2;
          const row = rowsHist[i];
          const cell = sheetHist.getCell(i + 1, colFechaIdx >= 0 ? colFechaIdx : 6);
          const val = cell.value;
          const fmt = cell.formattedValue || "";

          let fechaRealIdentificada = "DESCONOCIDA";
          // Mapeo por seriales o formatted strings
          if (val === 46269 || fmt === "04/09/2026") fechaRealIdentificada = "04/09/2026 (4 de Septiembre)";
          else if (val === 46121 || fmt === "09/04/2026") fechaRealIdentificada = "04/09/2026 (4 de Septiembre - Invertido a Abril 9 por Google Sheets)";
          else if (val === 46270 || fmt === "05/09/2026") fechaRealIdentificada = "05/09/2026 (5 de Septiembre)";
          else if (val === 46151 || fmt === "09/05/2026") fechaRealIdentificada = "05/09/2026 (5 de Septiembre - Invertido a Mayo 9 por Google Sheets)";
          else if (val === 46271 || fmt === "06/09/2026") fechaRealIdentificada = "06/09/2026 (6 de Septiembre)";
          else if (val === 46182 || fmt === "09/06/2026") fechaRealIdentificada = "06/09/2026 (6 de Septiembre - Invertido a Junio 9 por Google Sheets)";
          else if (val === 46272 || fmt === "07/09/2026") fechaRealIdentificada = "07/09/2026 (7 de Septiembre)";
          else if (val === 46213 || fmt === "09/07/2026") fechaRealIdentificada = "07/09/2026 (7 de Septiembre - Invertido a Julio 9 por Google Sheets)";
          else fechaRealIdentificada = `Otro: raw=${val}, fmt=${fmt}`;

          const key = `Raw: ${val} | Formatted: "${fmt}" | Interpreted: ${fechaRealIdentificada}`;

          if (!bloques[key]) {
            bloques[key] = { total: 0, minFila: rowNum, maxFila: rowNum, rawSample: val, formattedSample: fmt, fechaReal: fechaRealIdentificada };
          }
          bloques[key].total++;
          bloques[key].maxFila = rowNum;
        }

        for (const [key, data] of Object.entries(bloques)) {
          console.log(`\n• Bloque (Filas ${data.minFila}..${data.maxFila}) -> ${data.total} filas`);
          console.log(`  Categoría: ${key}`);
        }
      }

      // Pestaña Diaria (registros_telegram)
      const sheetDiario = doc.sheetsByTitle["registros_telegram"];
      if (sheetDiario) {
        const rowsDiario = await sheetDiario.getRows();
        await sheetDiario.loadCells({
          startRowIndex: 0,
          endRowIndex: rowsDiario.length + 1,
          startColumnIndex: 0,
          endColumnIndex: 12
        });

        console.log("\n=== INFORME DETALLADO DE HOJA DIARIA ('registros_telegram') ===");
        const resumenDiario: Record<string, number> = {};

        for (let i = 0; i < rowsDiario.length; i++) {
          const row = rowsDiario[i];
          const cell = sheetDiario.getCell(i + 1, 6);
          const key = `value=${JSON.stringify(cell.value)} (${typeof cell.value}), formattedValue=${JSON.stringify(cell.formattedValue)}`;
          resumenDiario[key] = (resumenDiario[key] || 0) + 1;
        }

        for (const [k, cant] of Object.entries(resumenDiario)) {
          console.log(`• ${cant} filas -> ${k}`);
        }
      }

    } catch (err: any) {
      console.error("Error:", err);
    }
  });
}

informeCompletoFechas();
