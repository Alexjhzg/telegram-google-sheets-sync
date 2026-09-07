import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function corregirFechasSeptiembreBatch() {
  console.log("=================================================");
  console.log(" CORRIGIENDO FECHAS DE SEPTIEMBRE EN GOOGLE SHEETS ");
  console.log("=================================================\n");

  await sheetsMutex.runExclusive(async () => {
    try {
      const doc = await obtenerHojaDeCalculo();
      console.log("[1/3] Conexión establecida con Google Sheets.");

      // 1. Corregir registros_historicos_telegram
      const sheetHist = doc.sheetsByTitle["registros_historicos_telegram"];
      if (sheetHist) {
        console.log("\nProcesando pestaña 'registros_historicos_telegram'...");
        const rowsHist = await sheetHist.getRows();
        const totalRowsHist = rowsHist.length + 5;

        await sheetHist.loadCells({
          startRowIndex: 0,
          endRowIndex: totalRowsHist,
          startColumnIndex: 6,
          endColumnIndex: 7
        });

        let corregidas04 = 0;
        let corregidas05 = 0;
        let corregidas06 = 0;
        let corregidas07 = 0;
        let estandarizadas = 0;

        for (let i = 0; i < rowsHist.length; i++) {
          const cell = sheetHist.getCell(i + 1, 6);
          const val = cell.value;
          const fmt = String(cell.formattedValue || "").trim();

          // 04 de Septiembre
          if (val === 46121 || fmt === "09/04/2026") {
            cell.value = "04/09/2026";
            cell.numberFormat = { type: "TEXT", pattern: "@" };
            corregidas04++;
          } else if (val === 46269 || fmt === "04/09/2026") {
            cell.value = "04/09/2026";
            cell.numberFormat = { type: "TEXT", pattern: "@" };
            estandarizadas++;
          }
          // 05 de Septiembre
          else if (val === 46151 || fmt === "09/05/2026") {
            cell.value = "05/09/2026";
            cell.numberFormat = { type: "TEXT", pattern: "@" };
            corregidas05++;
          } else if (val === 46270 || fmt === "05/09/2026") {
            cell.value = "05/09/2026";
            cell.numberFormat = { type: "TEXT", pattern: "@" };
            estandarizadas++;
          }
          // 06 de Septiembre
          else if (val === 46182 || fmt === "09/06/2026") {
            cell.value = "06/09/2026";
            cell.numberFormat = { type: "TEXT", pattern: "@" };
            corregidas06++;
          } else if (val === 46271 || fmt === "06/09/2026") {
            cell.value = "06/09/2026";
            cell.numberFormat = { type: "TEXT", pattern: "@" };
            estandarizadas++;
          }
          // 07 de Septiembre
          else if (val === 46213 || fmt === "09/07/2026") {
            cell.value = "07/09/2026";
            cell.numberFormat = { type: "TEXT", pattern: "@" };
            corregidas07++;
          } else if (val === 46272 || fmt === "07/09/2026") {
            cell.value = "07/09/2026";
            cell.numberFormat = { type: "TEXT", pattern: "@" };
            estandarizadas++;
          }
        }

        console.log(`[INFO] Guardando celdas actualizadas en 'registros_historicos_telegram'...`);
        await sheetHist.saveUpdatedCells();
        console.log(`✅ Resultado en 'registros_historicos_telegram':`);
        console.log(`   - 04/09/2026 corregidas (de 09/04): ${corregidas04}`);
        console.log(`   - 05/09/2026 corregidas (de 09/05): ${corregidas05}`);
        console.log(`   - 06/09/2026 corregidas (de 09/06): ${corregidas06}`);
        console.log(`   - 07/09/2026 corregidas (de 09/07): ${corregidas07}`);
        console.log(`   - Fechas estandarizadas a texto @:  ${estandarizadas}`);
      }

      // 2. Corregir registros_telegram (pestaña diaria)
      const sheetDiario = doc.sheetsByTitle["registros_telegram"];
      if (sheetDiario) {
        console.log("\nProcesando pestaña diaria 'registros_telegram'...");
        const rowsDiario = await sheetDiario.getRows();
        const totalRowsDiario = rowsDiario.length + 5;

        await sheetDiario.loadCells({
          startRowIndex: 0,
          endRowIndex: totalRowsDiario,
          startColumnIndex: 6,
          endColumnIndex: 7
        });

        let corregidasDiarias = 0;
        for (let i = 0; i < rowsDiario.length; i++) {
          const cell = sheetDiario.getCell(i + 1, 6);
          const val = cell.value;
          const fmt = String(cell.formattedValue || "").trim();

          if (val === 46272 || val === 46213 || fmt === "09/07/2026" || fmt === "07/09/2026") {
            cell.value = "07/09/2026";
            cell.numberFormat = { type: "TEXT", pattern: "@" };
            corregidasDiarias++;
          }
        }

        console.log(`[INFO] Guardando celdas en 'registros_telegram'...`);
        await sheetDiario.saveUpdatedCells();
        console.log(`✅ Resultado en 'registros_telegram': ${corregidasDiarias} celdas del 07/09 estandarizadas a texto '07/09/2026'.`);
      }

      console.log("\n🎉 CONSOLIDADACIÓN Y CORRECCIÓN COMPLETADA CON ÉXITO.");

    } catch (err: any) {
      console.error("❌ Error al corregir fechas:", err.message || err);
      process.exit(1);
    }
  });
}

corregirFechasSeptiembreBatch();
