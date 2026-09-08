import { obtenerHojaDeCalculo, sheetsMutex, COLUMNAS } from "../src/services/sheets.js";
import { obtenerClienteDB, esDBActiva } from "../src/services/database.js";

async function listarTodos() {
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
        const { data } = await client
          .from("reportes_diarios")
          .select("*")
          .or("fecha.eq.2026-09-07,fecha.eq.07/09/2026");
        if (data) dbData = data;
      }
    }

    const dbMap = new Map<number, any>();
    dbData.forEach(r => dbMap.set(parseInt(String(r.nodo), 10), r));

    console.log("NODO | MUNICIPIO | SHEETS (Tot,B1,B2,B3,Rem) | DB (Tot,B1,B2,B3,Rem)");
    console.log("-".repeat(80));

    filas07.forEach(f => {
      const obj = f.toObject();
      const nodo = parseInt(obj[COLUMNAS.NODO], 10);
      const dbRow = dbMap.get(nodo);

      const sTot = obj[COLUMNAS.TOTAL_VERIFICADORES] || "0";
      const sB1 = obj[COLUMNAS.BLOQUE_1] || "0";
      const sB2 = obj[COLUMNAS.BLOQUE_2] || "0";
      const sB3 = obj[COLUMNAS.BLOQUE_3] || "0";
      const sRem = obj[COLUMNAS.REMITENTE] || "";

      let dStr = "SIN REGISTRO EN DB";
      if (dbRow) {
        dStr = `Tot=${dbRow.total_verificadores}, B1=${dbRow.bloque_1}, B2=${dbRow.bloque_2}, B3=${dbRow.bloque_3}, Rem=${dbRow.remitente}`;
      }

      const sStr = `Tot=${sTot}, B1=${sB1}, B2=${sB2}, B3=${sB3}, Rem=${sRem}`;
      const diff = (dbRow && (String(dbRow.total_verificadores) !== sTot || String(dbRow.bloque_3) !== sB3 || dbRow.remitente !== sRem)) ? " ❌ DIFF" : "";
      console.log(`${nodo} | ${obj[COLUMNAS.MUNICIPIO]} | ${sStr} | ${dStr}${diff}`);
    });
  });
}

listarTodos();
