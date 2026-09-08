import { obtenerHojaDeCalculo, sheetsMutex, COLUMNAS } from "../src/services/sheets.js";
import { obtenerClienteDB, esDBActiva } from "../src/services/database.js";

async function auditoriaCompletaAyer() {
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

    console.log(`=== AUDITORÍA COMPLETA 07/09/2026 (Filas Histórico: ${filas07.length}, DB: ${dbData.length}) ===`);

    let discrepanciasCount = 0;
    filas07.forEach(f => {
      const obj = f.toObject();
      const nodo = parseInt(obj[COLUMNAS.NODO], 10);
      const dbRow = dbMap.get(nodo);

      const totS = obj[COLUMNAS.TOTAL_VERIFICADORES] || "0";
      const b1S = obj[COLUMNAS.BLOQUE_1] || "0";
      const b2S = obj[COLUMNAS.BLOQUE_2] || "0";
      const b3S = obj[COLUMNAS.BLOQUE_3] || "0";
      const remS = obj[COLUMNAS.REMITENTE] || "";
      const horaS = obj[COLUMNAS.HORA] || "";
      const msgIdS = obj[COLUMNAS.ID_MENSAJE] || "";
      const chatIdS = obj[COLUMNAS.ID_CHAT] || "";
      const estadoS = obj[COLUMNAS.ESTADO] || "";

      if (dbRow) {
        const totD = String(dbRow.total_verificadores ?? 0);
        const b1D = String(dbRow.bloque_1 ?? 0);
        const b2D = String(dbRow.bloque_2 ?? 0);
        const b3D = String(dbRow.bloque_3 ?? 0);
        const remD = dbRow.remitente || "";
        const horaD = dbRow.hora || "";
        const msgIdD = dbRow.telegram_message_id ? String(dbRow.telegram_message_id) : "";
        const chatIdD = dbRow.telegram_chat_id ? String(dbRow.telegram_chat_id) : "";
        const estadoD = dbRow.estado || "OK";

        const tieneDiff = (
          totS !== totD ||
          b1S !== b1D ||
          b2S !== b2D ||
          b3S !== b3D ||
          remS !== remD ||
          horaS !== horaD ||
          msgIdS !== msgIdD ||
          chatIdS !== chatIdD ||
          estadoS !== estadoD
        );

        if (tieneDiff) {
          discrepanciasCount++;
          console.log(`\n[NODO ${nodo} - ${obj[COLUMNAS.MUNICIPIO]}]`);
          console.log(`  SHEETS: Tot=${totS} (B1=${b1S}, B2=${b2S}, B3=${b3S}) | Rem="${remS}" | Hora="${horaS}" | MsgID="${msgIdS}" | ChatID="${chatIdS}" | Estado="${estadoS}"`);
          console.log(`  DB:     Tot=${totD} (B1=${b1D}, B2=${b2D}, B3=${b3D}) | Rem="${remD}" | Hora="${horaD}" | MsgID="${msgIdD}" | ChatID="${chatIdD}" | Estado="${estadoD}"`);
        }
      } else {
        if (totS !== "0") {
          discrepanciasCount++;
          console.log(`\n[NODO ${nodo} - ${obj[COLUMNAS.MUNICIPIO]}] en Sheets tiene Tot=${totS} pero no está en DB.`);
        }
      }
    });

    console.log(`\nTotal de nodos con discrepancias: ${discrepanciasCount}`);
  });
}

auditoriaCompletaAyer();
