import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";
import { estandarizarFecha } from "../src/utils/dateUtils.js";

async function estandarizarTodoHistoricoATexto() {
  console.log("=============================================================");
  console.log(" ESTANDARIZANDO ABSOLUTAMENTE TODAS LAS CELDAS DE HISTÓRICO ");
  console.log("=============================================================\n");

  await sheetsMutex.runExclusive(async () => {
    try {
      const doc = await obtenerHojaDeCalculo();
      const sheetHist = doc.sheetsByTitle["registros_historicos_telegram"];
      if (!sheetHist) return;

      const rows = await sheetHist.getRows();
      console.log(`Cargando ${rows.length} filas de 'registros_historicos_telegram'...`);

      await sheetHist.loadCells({
        startRowIndex: 0,
        endRowIndex: rows.length + 5,
        startColumnIndex: 6,
        endColumnIndex: 7
      });

      let convertidas = 0;

      for (let i = 0; i < rows.length; i++) {
        const cell = sheetHist.getCell(i + 1, 6);
        const val = cell.value;

        // Si es número (serial de Excel/Google Sheets)
        if (typeof val === "number") {
          const std = estandarizarFecha(val);
          if (std) {
            cell.value = std;
            cell.numberFormat = { type: "TEXT", pattern: "@" };
            convertidas++;
          }
        } else if (cell.numberFormat?.type !== "TEXT") {
          cell.numberFormat = { type: "TEXT", pattern: "@" };
        }
      }

      console.log(`Guardando ${convertidas} celdas convertidas de número a texto...`);
      await sheetHist.saveUpdatedCells();
      console.log(`✅ ¡ÉXITO! Estandarizadas ${convertidas} celdas a texto DD/MM/YYYY.`);

    } catch (err: any) {
      console.error("Error al estandarizar:", err);
    }
  });
}

estandarizarTodoHistoricoATexto();
