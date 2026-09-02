import { obtenerHojaDeCalculo, COLUMNAS, sheetsMutex } from "../src/services/sheets.js";
import { estandarizarFecha } from "../src/utils/dateUtils.js";

/**
 * Script ejecutable para recorrer la pestaña 'registros_historicos_telegram'
 * (y opcionalmente 'registros_telegram') en Google Sheets y estandarizar todas las fechas al formato DD/MM/YYYY.
 */
async function estandarizarFechasHistoricas() {
  console.log("=== INICIANDO ESTANDARIZACIÓN DE FECHAS EN GOOGLE SHEETS ===");

  await sheetsMutex.runExclusive(async () => {
    try {
      const doc = await obtenerHojaDeCalculo();
      console.log("[1/3] Conexión establecida exitosamente con Google Sheets.");

      const pestañasAnalizar = ["registros_historicos_telegram", "registros_telegram"];

      for (const nombrePestaña of pestañasAnalizar) {
        const hoja = doc.sheetsByTitle[nombrePestaña];
        if (!hoja) {
          console.warn(`[OMITIDO] La pestaña '${nombrePestaña}' no existe en el documento.`);
          continue;
        }

        console.log(`\n[2/3] Procesando pestaña '${nombrePestaña}'...`);
        const filas = await hoja.getRows();
        console.log(`[INFO] Se encontraron ${filas.length} filas en '${nombrePestaña}'.`);

        let actualizadas = 0;
        let yaEstandar = 0;
        let sinFecha = 0;
        let errores = 0;

        for (let i = 0; i < filas.length; i++) {
          const fila = filas[i];
          const fechaOriginal = (fila.get(COLUMNAS.FECHA) || "").toString().trim();

          if (!fechaOriginal) {
            sinFecha++;
            continue;
          }

          const fechaNormalizada = estandarizarFecha(fechaOriginal);

          if (!fechaNormalizada) {
            console.warn(`[ADVERTENCIA] Fila ${i + 2}: No se pudo interpretar la fecha '${fechaOriginal}'.`);
            errores++;
            continue;
          }

          if (fechaOriginal !== fechaNormalizada) {
            console.log(`[ACTUALIZANDO] Fila ${i + 2}: '${fechaOriginal}' ➔ '${fechaNormalizada}'`);
            fila.set(COLUMNAS.FECHA, fechaNormalizada);
            await fila.save();
            actualizadas++;
          } else {
            yaEstandar++;
          }
        }

        console.log(`\n[RESUMEN '${nombrePestaña}']`);
        console.log(`- Filas actualizadas a DD/MM/YYYY: ${actualizadas}`);
        console.log(`- Filas que ya eran estándar:     ${yaEstandar}`);
        console.log(`- Filas vacías/sin fecha:         ${sinFecha}`);
        if (errores > 0) console.log(`- Fechas no reconocidas:          ${errores}`);
      }

      // Estandarizar la celda I1 de la pestaña 'reporte_nodo' si contiene un valor de fecha
      const hojaReporteNodo = doc.sheetsByTitle["reporte_nodo"];
      if (hojaReporteNodo) {
        console.log(`\n[3/3] Revisando celda I1 (Fecha Deseada) en 'reporte_nodo'...`);
        await hojaReporteNodo.loadCells("I1:I1");
        const cellI1 = hojaReporteNodo.getCellByA1("I1");
        const rawI1 = String(cellI1.formattedValue || cellI1.value || "").trim();

        if (rawI1) {
          const fechaEstandarI1 = estandarizarFecha(rawI1);
          if (fechaEstandarI1 && (cellI1.value !== fechaEstandarI1 || cellI1.formattedValue !== fechaEstandarI1)) {
            console.log(`[ACTUALIZANDO] Celda I1 en 'reporte_nodo': '${rawI1}' ➔ '${fechaEstandarI1}'`);
            cellI1.value = fechaEstandarI1;
            cellI1.numberFormat = { type: "TEXT", pattern: "@" };
            await hojaReporteNodo.saveUpdatedCells();
          } else {
            console.log(`[INFO] Celda I1 en 'reporte_nodo' ya se encuentra en formato estándar: '${cellI1.formattedValue || cellI1.value}'`);
          }
        }
      }

      console.log("\n=== ESTANDARIZACIÓN DE FECHAS FINALIZADA CON ÉXITO ===");
    } catch (err: any) {
      console.error("[ERROR] Falló la ejecución del script de estandarización:", err?.message || err);
      process.exit(1);
    }
  });
}

estandarizarFechasHistoricas();
