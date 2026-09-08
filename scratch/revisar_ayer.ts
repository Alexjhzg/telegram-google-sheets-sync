import { obtenerHojaDeCalculo, sheetsMutex, COLUMNAS } from "../src/services/sheets.js";
import { obtenerClienteDB, esDBActiva } from "../src/services/database.js";

async function analizar() {
  await sheetsMutex.runExclusive(async () => {
    const doc = await obtenerHojaDeCalculo();
    
    // 1. Google Sheets - registros_historicos_telegram
    const sheetHist = doc.sheetsByTitle["registros_historicos_telegram"];
    if (sheetHist) {
      const rows = await sheetHist.getRows();
      console.log(`Total filas en histórico: ${rows.length}`);
      
      const rows07 = rows.filter(r => r.get(COLUMNAS.FECHA) === "07/09/2026");
      console.log(`Filas con fecha 07/09/2026 en histórico: ${rows07.length}`);
      
      rows07.forEach((r, idx) => {
        const obj = r.toObject();
        console.log(`[HIST 07/09 ${idx+1}] Nod: ${obj[COLUMNAS.NODO]} | Mun: ${obj[COLUMNAS.MUNICIPIO]} | Tot: ${obj[COLUMNAS.TOTAL_VERIFICADORES]} | B1: ${obj[COLUMNAS.BLOQUE_1]} | B2: ${obj[COLUMNAS.BLOQUE_2]} | B3: ${obj[COLUMNAS.BLOQUE_3]} | Rem: ${obj[COLUMNAS.REMITENTE]} | Hora: ${obj[COLUMNAS.HORA]}`);
      });

      const rows08 = rows.filter(r => r.get(COLUMNAS.FECHA) === "08/09/2026");
      console.log(`Filas con fecha 08/09/2026 en histórico: ${rows08.length}`);
    }

    // 2. Supabase DB
    if (esDBActiva()) {
      const client = obtenerClienteDB();
      if (client) {
        const { data, error } = await client
          .from("reportes_diarios")
          .select("*")
          .or("fecha.eq.2026-09-07,fecha.eq.07/09/2026");
        
        if (error) console.error("Error DB:", error);
        else {
          console.log(`Total registros en Supabase DB para 2026-09-07: ${data?.length}`);
          data?.forEach((r: any) => {
            console.log(`[DB 07/09] Nod: ${r.nodo} | Tot: ${r.total_verificadores} | B1: ${r.bloque_1} | B2: ${r.bloque_2} | B3: ${r.bloque_3} | Rem: ${r.remitente} | Hora: ${r.hora}`);
          });
        }
      }
    }
  });
}

analizar();
