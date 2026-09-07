import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function analizarTodosLosMeses() {
  await sheetsMutex.runExclusive(async () => {
    try {
      const doc = await obtenerHojaDeCalculo();
      const sheetHist = doc.sheetsByTitle["registros_historicos_telegram"];
      if (!sheetHist) return;

      const rows = await sheetHist.getRows();
      await sheetHist.loadCells({
        startRowIndex: 0,
        endRowIndex: rows.length + 1,
        startColumnIndex: 0,
        endColumnIndex: 12
      });

      console.log("=== ANÁLISIS DE FECHAS EN HISTÓRICO (DEL INICIO AL FINAL) ===\n");

      // Vamos a recorrer los bloques para detectar cualquier fecha que esté desordenada o fuera del mes cronológico del bloque
      let prevFecha = "";
      const anomalias: Array<{ filaMin: number; filaMax: number; count: number; valActual: string; fechaSugeridaCorrecta: string; contexto: string }> = [];

      // Recorremos las 4625 filas
      let i = 0;
      while (i < rows.length) {
        const cell = sheetHist.getCell(i + 1, 6);
        const val = cell.value;
        const fmt = String(cell.formattedValue || "").trim();
        const str = String(val ?? fmt);

        const startFila = i + 2;
        let count = 0;
        while (i < rows.length) {
          const c2 = sheetHist.getCell(i + 1, 6);
          const v2 = c2.value;
          const f2 = String(c2.formattedValue || "").trim();
          if (String(v2 ?? f2) === str && f2 === fmt) {
            count++;
            i++;
          } else {
            break;
          }
        }
        const endFila = startFila + count - 1;

        // Analizamos la fecha
        let fechaSugerida = "";
        let esAnomalia = false;

        // 1. Bloques de Junio (Filas 2 a 1313) donde aparecen 06/05, 06/06, 06/07, 06/08, 06/09, 06/10, 06/11, 06/12
        if (startFila <= 1313) {
          const match = /^06\/(\d{2})\/2026$/.exec(fmt);
          if (match) {
            const mesInvertido = match[1];
            if (mesInvertido !== "06") {
              fechaSugerida = `${mesInvertido}/06/2026`;
              esAnomalia = true;
            }
          }
        }

        // 2. Bloques de Julio (Filas 1314 a 2801) donde aparecen 07/01, 07/02, 07/03, 07/04, 07/05, 07/06, 07/08, 07/09, 07/10, 07/11, 07/12
        if (startFila >= 1314 && startFila <= 2801) {
          const match = /^07\/(\d{2})\/2026$/.exec(fmt);
          if (match) {
            const mesInvertido = match[1];
            if (mesInvertido !== "07") {
              fechaSugerida = `${mesInvertido}/07/2026`;
              esAnomalia = true;
            }
          }
        }

        // 3. Bloques de Agosto (Filas 2802 a 4258) donde aparece 08/09/2026
        if (startFila >= 2802 && startFila <= 4258) {
          if (fmt === "08/09/2026") {
            fechaSugerida = "09/08/2026";
            esAnomalia = true;
          }
        }

        if (esAnomalia) {
          anomalias.push({
            filaMin: startFila,
            filaMax: endFila,
            count,
            valActual: fmt,
            fechaSugeridaCorrecta: fechaSugerida,
            contexto: `Entre filas ${startFila} y ${endFila}`
          });
        }
      }

      console.log(`Se encontraron ${anomalias.length} bloques con fechas invertidas por formato de Google Sheets:\n`);
      anomalias.forEach(a => {
        console.log(`• Filas ${a.filaMin}..${a.filaMax} (${a.count} filas): Actual: "${a.valActual}" ➔ Debería ser: "${a.fechaSugeridaCorrecta}"`);
      });

    } catch (err: any) {
      console.error("Error al analizar todos los meses:", err);
    }
  });
}

analizarTodosLosMeses();
