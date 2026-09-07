import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function corregirHistoricoCompleto() {
  console.log("=========================================================");
  console.log(" CORRIGIENDO TODAS LAS FECHAS INVERTIDAS EN EL HISTÓRICO ");
  console.log("=========================================================\n");

  await sheetsMutex.runExclusive(async () => {
    try {
      const doc = await obtenerHojaDeCalculo();
      const sheetHist = doc.sheetsByTitle["registros_historicos_telegram"];
      if (!sheetHist) {
        console.error("No se encontró la pestaña 'registros_historicos_telegram'");
        return;
      }

      const rows = await sheetHist.getRows();
      console.log(`[1/2] Total de filas a inspeccionar y corregir: ${rows.length}`);

      await sheetHist.loadCells({
        startRowIndex: 0,
        endRowIndex: rows.length + 5,
        startColumnIndex: 6,
        endColumnIndex: 7
      });

      const conteoCorregidas: Record<string, number> = {};
      let totalCorregidas = 0;

      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 2;
        const cell = sheetHist.getCell(i + 1, 6);
        const fmt = String(cell.formattedValue || "").trim();

        let nuevaFecha = "";

        // 1. Bloques de JUNIO (Filas 2 a 1313)
        if (rowNum <= 1313) {
          const m = /^06\/(\d{2})\/2026$/.exec(fmt);
          if (m && m[1] !== "06") {
            nuevaFecha = `${m[1]}/06/2026`;
          }
        }

        // 2. Bloques de JULIO (Filas 1314 a 2801)
        else if (rowNum >= 1314 && rowNum <= 2801) {
          const m = /^07\/(\d{2})\/2026$/.exec(fmt);
          if (m && m[1] !== "07") {
            nuevaFecha = `${m[1]}/07/2026`;
          }
        }

        // 3. Bloques de AGOSTO (Filas 2802 a 4258)
        else if (rowNum >= 2802 && rowNum <= 4258) {
          if (fmt === "08/09/2026") {
            nuevaFecha = "09/08/2026";
          }
        }

        if (nuevaFecha) {
          const key = `'${fmt}' ➔ '${nuevaFecha}'`;
          conteoCorregidas[key] = (conteoCorregidas[key] || 0) + 1;
          cell.value = nuevaFecha;
          cell.numberFormat = { type: "TEXT", pattern: "@" };
          totalCorregidas++;
        } else if (cell.numberFormat?.type !== "TEXT") {
          // Aseguramos formato texto incluso si la fecha no estaba invertida
          cell.numberFormat = { type: "TEXT", pattern: "@" };
        }
      }

      console.log(`[2/2] Guardando ${totalCorregidas} celdas corregidas en Google Sheets...`);
      await sheetHist.saveUpdatedCells();

      console.log("\n=== RESUMEN DE CORRECCIONES APLICADAS EN HISTÓRICO ===");
      for (const [cambio, cant] of Object.entries(conteoCorregidas)) {
        console.log(`• ${cant} filas corregidas de ${cambio}`);
      }

      console.log(`\n✅ ¡ÉXITO! Total de filas corregidas: ${totalCorregidas}`);

    } catch (err: any) {
      console.error("❌ Error durante la corrección:", err.message || err);
    }
  });
}

corregirHistoricoCompleto();
