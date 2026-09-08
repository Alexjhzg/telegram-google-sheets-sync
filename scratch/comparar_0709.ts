import { obtenerHojaDeCalculo, sheetsMutex, COLUMNAS } from "../src/services/sheets.js";
import { obtenerClienteDB, esDBActiva } from "../src/services/database.js";

async function comparar() {
  await sheetsMutex.runExclusive(async () => {
    const doc = await obtenerHojaDeCalculo();
    const sheetHist = doc.sheetsByTitle["registros_historicos_telegram"];
    if (!sheetHist) return;

    const filasHist = await sheetHist.getRows();
    const filas07 = filasHist.filter(f => f.get(COLUMNAS.FECHA) === "07/09/2026");

    let dbData: any[] = [];
    if (esDBActiva()) {
      const client = obtenerClienteDB();
      if (client) {
        const { data, error } = await client
          .from("reportes_diarios")
          .select("*")
          .or("fecha.eq.2026-09-07,fecha.eq.07/09/2026");
        if (data) dbData = data;
      }
    }

    const dbMap = new Map<number, any>();
    dbData.forEach(r => dbMap.set(parseInt(String(r.nodo), 10), r));

    console.log("=== DIFERENCIAS ENTRE DB Y HISTÓRICO GOOGLE SHEETS PARA 07/09/2026 ===");
    
    filas07.forEach(f => {
      const obj = f.toObject();
      const nodo = parseInt(obj[COLUMNAS.NODO], 10);
      const dbRow = dbMap.get(nodo);
      
      const totSheet = Number(obj[COLUMNAS.TOTAL_VERIFICADORES] || 0);
      const b1Sheet = Number(obj[COLUMNAS.BLOQUE_1] || 0);
      const b2Sheet = Number(obj[COLUMNAS.BLOQUE_2] || 0);
      const b3Sheet = Number(obj[COLUMNAS.BLOQUE_3] || 0);
      const remSheet = obj[COLUMNAS.REMITENTE] || "";
      const horaSheet = obj[COLUMNAS.HORA] || "";

      if (dbRow) {
        const totDB = Number(dbRow.total_verificadores || 0);
        const b1DB = Number(dbRow.bloque_1 || 0);
        const b2DB = Number(dbRow.bloque_2 || 0);
        const b3DB = Number(dbRow.bloque_3 || 0);
        const remDB = dbRow.remitente || "";
        const horaDB = dbRow.hora || "";

        if (totSheet !== totDB || b1Sheet !== b1DB || b2Sheet !== b2DB || b3Sheet !== b3DB || remSheet !== remDB) {
          console.log(`\n❌ NODO ${nodo} (${obj[COLUMNAS.MUNICIPIO]}): DISCREPANCIA DETECTADA`);
          console.log(`   SHEETS: Tot=${totSheet}, B1=${b1Sheet}, B2=${b2Sheet}, B3=${b3Sheet}, Rem="${remSheet}", Hora="${horaSheet}"`);
          console.log(`   SUPABASE DB: Tot=${totDB}, B1=${b1DB}, B2=${b2DB}, B3=${b3DB}, Rem="${remDB}", Hora="${horaDB}"`);
        }
      } else {
        if (totSheet > 0) {
          console.log(`\n⚠️ NODO ${nodo} en Sheets tiene datos pero no está en Supabase DB: Tot=${totSheet}`);
        }
      }
    });
  });
}

comparar();
