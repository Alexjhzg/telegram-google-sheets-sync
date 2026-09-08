import { obtenerHojaDeCalculo, sheetsMutex, COLUMNAS } from "../src/services/sheets.js";
import { obtenerClienteDB, esDBActiva } from "../src/services/database.js";
import { estandarizarFecha } from "../src/utils/dateUtils.js";

async function analizarRango() {
  await sheetsMutex.runExclusive(async () => {
    const doc = await obtenerHojaDeCalculo();
    const sheetHist = doc.sheetsByTitle["registros_historicos_telegram"];
    if (!sheetHist) return;

    const filas = await sheetHist.getRows();
    console.log(`Total filas en histórico: ${filas.length}`);

    const fechasAnalizar = ["04/09/2026", "05/09/2026", "06/09/2026"];

    for (const fechaTarget of fechasAnalizar) {
      console.log(`\n==================================================`);
      console.log(` ANÁLISIS PARA ${fechaTarget}`);
      console.log(`==================================================`);

      // Filas en Google Sheets
      const filasTarget = filas.filter(f => {
        const rawF = (f.get(COLUMNAS.FECHA) || "").trim();
        return estandarizarFecha(rawF) === fechaTarget || rawF === fechaTarget;
      });

      console.log(`Google Sheets: ${filasTarget.length} filas asociadas a ${fechaTarget}`);
      
      const conDatosSheets = filasTarget.filter(f => {
        const obj = f.toObject();
        return Number(obj[COLUMNAS.TOTAL_VERIFICADORES] || 0) > 0 || (obj[COLUMNAS.ID_MENSAJE] || "") !== "";
      });
      console.log(`Sheets con datos (>0 o MsgID): ${conDatosSheets.length}`);

      // Filas en Supabase DB
      let dbData: any[] = [];
      if (esDBActiva()) {
        const client = obtenerClienteDB();
        if (client) {
          const partes = fechaTarget.split("/");
          const fechaIso = `${partes[2]}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}`;
          const { data, error } = await client
            .from("reportes_diarios")
            .select("*")
            .or(`fecha.eq.${fechaIso},fecha.eq.${fechaTarget}`);
          if (data) dbData = data;
        }
      }
      console.log(`Supabase DB: ${dbData.length} registros para ${fechaTarget}`);

      const dbMap = new Map<number, any>();
      dbData.forEach(r => dbMap.set(parseInt(String(r.nodo), 10), r));

      // Comparar celdas/discrepancias
      let discrepancias = 0;
      // Mapear nodos únicos en Sheets
      const nodosSheetsMap = new Map<number, any[]>();
      filasTarget.forEach(f => {
        const nod = parseInt(f.get(COLUMNAS.NODO) || "0", 10);
        if (!nodosSheetsMap.has(nod)) nodosSheetsMap.set(nod, []);
        nodosSheetsMap.get(nod)!.push(f);
      });

      console.log(`Nodos únicos en Sheets: ${nodosSheetsMap.size}`);

      for (const [nod, fList] of nodosSheetsMap.entries()) {
        const dbRow = dbMap.get(nod);
        const f = fList[0]; // primera fila
        const obj = f.toObject();
        
        const totS = Number(obj[COLUMNAS.TOTAL_VERIFICADORES] || 0);
        const b1S = Number(obj[COLUMNAS.BLOQUE_1] || 0);
        const b2S = Number(obj[COLUMNAS.BLOQUE_2] || 0);
        const b3S = Number(obj[COLUMNAS.BLOQUE_3] || 0);
        const remS = obj[COLUMNAS.REMITENTE] || "";

        if (dbRow) {
          const totD = Number(dbRow.total_verificadores || 0);
          const b1D = Number(dbRow.bloque_1 || 0);
          const b2D = Number(dbRow.bloque_2 || 0);
          const b3D = Number(dbRow.bloque_3 || 0);
          const remD = dbRow.remitente || "";

          if (totS !== totD || b1S !== b1D || b2S !== b2D || b3S !== b3D || remS !== remD) {
            discrepancias++;
            console.log(`  ❌ NODO ${nod} (${obj[COLUMNAS.MUNICIPIO]}): SHEETS (Tot=${totS}, B1=${b1S}, B2=${b2S}, B3=${b3S}, Rem="${remS}") vs DB (Tot=${totD}, B1=${b1D}, B2=${b2D}, B3=${b3D}, Rem="${remD}")`);
          }
        } else {
          if (totS > 0) {
            discrepancias++;
            console.log(`  ⚠️ NODO ${nod} en Sheets (Tot=${totS}) sin registro en DB`);
          }
        }
      }
      console.log(`Total discrepancias en fecha ${fechaTarget}: ${discrepancias}`);
    }
  });
}

analizarRango();
