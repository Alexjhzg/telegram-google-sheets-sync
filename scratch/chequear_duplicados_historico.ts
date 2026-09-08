import { obtenerHojaDeCalculo, sheetsMutex, COLUMNAS } from "../src/services/sheets.js";
import { estandarizarFecha } from "../src/utils/dateUtils.js";

async function chequearFechasEstructura() {
  await sheetsMutex.runExclusive(async () => {
    const doc = await obtenerHojaDeCalculo();
    const sheetHist = doc.sheetsByTitle["registros_historicos_telegram"];
    if (!sheetHist) return;

    const filas = await sheetHist.getRows();
    console.log(`Total filas en histórico: ${filas.length}`);

    const conteoPorFecha: Record<string, number> = {};
    filas.forEach(f => {
      const rawF = (f.get(COLUMNAS.FECHA) || "").trim();
      const stdF = estandarizarFecha(rawF) || rawF || "(Sin Fecha)";
      conteoPorFecha[stdF] = (conteoPorFecha[stdF] || 0) + 1;
    });

    console.log("\n--- CONTEO DE FILAS POR FECHA EN HISTÓRICO ---");
    for (const [fecha, count] of Object.entries(conteoPorFecha)) {
      const dup = count > 46 ? " ⚠️ DUPLICADO (>46 filas)" : "";
      console.log(`Fecha: "${fecha}" -> ${count} filas${dup}`);
    }
  });
}

chequearFechasEstructura();
