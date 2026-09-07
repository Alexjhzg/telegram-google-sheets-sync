import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function diagnosticarReporteNodo() {
  console.log("=== INSPECCIONANDO PESTAÑA 'reporte_nodo' Y 'registros_historicos_telegram' ===");

  await sheetsMutex.runExclusive(async () => {
    try {
      const doc = await obtenerHojaDeCalculo();
      const hojaReporte = doc.sheetsByTitle["reporte_nodo"];
      const hojaHistorico = doc.sheetsByTitle["registros_historicos_telegram"];

      if (!hojaReporte) {
        console.error("No se encontró la hoja 'reporte_nodo'");
        return;
      }
      if (!hojaHistorico) {
        console.error("No se encontró la hoja 'registros_historicos_telegram'");
        return;
      }

      await hojaReporte.loadCells();
      const rowCount = hojaReporte.rowCount;
      console.log(`Pestana 'reporte_nodo' tiene ${rowCount} filas.`);

      const i1 = hojaReporte.getCellByA1("I1");
      const g2 = hojaReporte.getCellByA1("G2");
      console.log(`I1 (Fecha Deseada en UI): value=${JSON.stringify(i1.value)}, formattedValue=${JSON.stringify(i1.formattedValue)}`);
      console.log(`G2 (Fecha evaluada): value=${JSON.stringify(g2.value)}, formattedValue=${JSON.stringify(g2.formattedValue)}`);

      const fechaEvaluada = g2.formattedValue || String(g2.value);

      console.log("\n--- CONTENIDO DE 'reporte_nodo' ---");
      const reportesNodoData: any[] = [];
      for (let r = 1; r < rowCount; r++) {
        const munCell = hojaReporte.getCell(r, 0); // Col A
        if (!munCell.value) break; // Fin de filas
        const mun = String(munCell.value);
        if (mun === "TOTAL") {
          console.log(`[TOTAL] Col C (Verif): ${hojaReporte.getCell(r, 2).formattedValue}, Col D (Campo): ${hojaReporte.getCell(r, 3).formattedValue}, Col E (Sin campo): ${hojaReporte.getCell(r, 4).formattedValue}, Col F (Faltantes 'N'): ${hojaReporte.getCell(r, 5).formattedValue}`);
          continue;
        }
        const nod = String(hojaReporte.getCell(r, 1).value);
        const verifNodo = hojaReporte.getCell(r, 2).formattedValue;
        const verifCampo = hojaReporte.getCell(r, 3).formattedValue; // Col D
        const verifSinCampo = hojaReporte.getCell(r, 4).formattedValue; // Col E
        const reporto = hojaReporte.getCell(r, 5).formattedValue; // Col F
        const fecha = hojaReporte.getCell(r, 6).formattedValue; // Col G

        reportesNodoData.push({ row: r + 1, mun, nod, verifNodo, verifCampo, verifSinCampo, reporto, fecha });
      }

      console.table(reportesNodoData.filter(d => d.reporto === "N" || Number(d.verifCampo) === 0));

      const sinReportarNodo = reportesNodoData.filter(d => d.reporto === "N");
      console.log(`\nTotal de nodos marcados como 'N' (Sin reportar) en 'reporte_nodo': ${sinReportarNodo.length}`);
      sinReportarNodo.forEach(d => {
        console.log(`  -> Fila ${d.row}: ${d.mun} - Nodo ${d.nod} (Campo: ${d.verifCampo}, Reportó: ${d.reporto})`);
      });

      // Ahora revisamos 'registros_historicos_telegram' para esa fecha evaluada
      console.log(`\n--- INSPECCIONANDO 'registros_historicos_telegram' PARA FECHA "${fechaEvaluada}" ---`);
      const rowsHist = await hojaHistorico.getRows();
      console.log(`Total de filas en histórico: ${rowsHist.length}`);

      const rowsFechaEvaluada = rowsHist.filter(r => {
        const f = (r.get("Fecha") || "").trim();
        return f === fechaEvaluada || f === fechaEvaluada.replace(/^0/, "");
      });

      console.log(`Filas encontradas en histórico para "${fechaEvaluada}": ${rowsFechaEvaluada.length}`);
      rowsFechaEvaluada.forEach(r => {
        const obj = r.toObject();
        console.log(`  Mun: "${obj.Municipio}" | Nod: ${obj.Nodo} (tipo: ${typeof obj.Nodo}) | Tot: "${obj["Total Verificadores"]}" (tipo: ${typeof obj["Total Verificadores"]}) | Fecha: "${obj.Fecha}" | Rem: "${obj.Remitente}" | MsgID: "${obj["ID Mensaje"]}"`);
      });

      // Buscar si el nodo 16061 y otros nodos están en el histórico para esa fecha
      console.log("\n--- BUSCANDO COMPARACIÓN NODO A NODO EN HISTÓRICO ---");
      for (const item of reportesNodoData) {
        const histMatch = rowsFechaEvaluada.find(r => String(r.get("Nodo")).trim() === String(item.nod).trim());
        if (!histMatch) {
          console.log(`⚠️ Nodo ${item.nod} (${item.mun}) NO EXISTE en filas de histórico para fecha ${fechaEvaluada}! (en reporte_nodo dice reporto=${item.reporto})`);
        } else {
          const totHist = histMatch.get("Total Verificadores");
          const msgHist = histMatch.get("ID Mensaje");
          const nodHist = histMatch.get("Nodo");
          const munHist = histMatch.get("Municipio");
          if (item.reporto === "N") {
            console.log(`❓ Nodo ${item.nod} (${item.mun}): En reporte_nodo reporto='N', pero en histórico: Tot=${totHist}, MsgID=${msgHist}, MunHist="${munHist}", NodHist="${nodHist}"`);
          }
        }
      }

    } catch (err: any) {
      console.error("Error al diagnosticar:", err);
    }
  });
}

diagnosticarReporteNodo();
