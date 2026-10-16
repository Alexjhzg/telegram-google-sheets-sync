import { obtenerHojaDeCalculo, buscarFilaPorNodo, COLUMNAS, sheetsMutex } from "../src/services/sheets.js";
import { esDBActiva, guardarOActualizarReporteDB } from "../src/services/database.js";

export interface ReporteAjuste {
  municipio: string;
  nodo: number;
  b1?: number;
  b2?: number;
  b3?: number;
  total?: number;
  hora?: string;
  remitente?: string;
}

/**
 * Corrige o inserta reportes en la hoja principal 'registros_telegram'
 * para la fecha de hoy, ideal para subsanar caídas del servidor.
 */
export async function aplicarAjusteReportesHoy(reportes: ReporteAjuste[], fechaManual?: string) {
  const opts: Intl.DateTimeFormatOptions = { timeZone: "America/Caracas", year: "numeric", month: "2-digit", day: "2-digit" };
  const fechaHoy = fechaManual || new Date().toLocaleDateString("es-VE", opts);

  console.log(`[AJUSTE] Aplicando corrección para la fecha: ${fechaHoy}`);
  console.log(`[AJUSTE] Cantidad de nodos a procesar: ${reportes.length}`);

  return sheetsMutex.runExclusive(async () => {
    const doc = await obtenerHojaDeCalculo();
    const hoja = doc.sheetsByTitle["registros_telegram"];
    if (!hoja) throw new Error("No se encontró la pestaña 'registros_telegram'.");

    const filas = await hoja.getRows();
    let actualizados = 0;
    let noEncontrados = 0;

    for (const rep of reportes) {
      const fila = buscarFilaPorNodo(filas, rep.municipio, rep.nodo);
      if (!fila) {
        console.warn(`[ADVERTENCIA] No se encontró fila fija para Municipio: ${rep.municipio}, Nodo: ${rep.nodo}`);
        noEncontrados++;
        continue;
      }

      const prevB1 = parseInt(fila.get(COLUMNAS.BLOQUE_1) || "0", 10);
      const prevB2 = parseInt(fila.get(COLUMNAS.BLOQUE_2) || "0", 10);
      const prevB3 = parseInt(fila.get(COLUMNAS.BLOQUE_3) || "0", 10);

      const nuevoB1 = rep.b1 !== undefined ? rep.b1 : prevB1;
      const nuevoB2 = rep.b2 !== undefined ? rep.b2 : prevB2;
      const nuevoB3 = rep.b3 !== undefined ? rep.b3 : prevB3;
      const nuevoTotal = rep.total !== undefined ? rep.total : (nuevoB1 + nuevoB2 + nuevoB3);
      const horaStr = rep.hora || "18:00";
      const remitenteStr = rep.remitente || fila.get(COLUMNAS.REMITENTE) || "Ajuste Manual";

      fila.set(COLUMNAS.BLOQUE_1, nuevoB1);
      fila.set(COLUMNAS.BLOQUE_2, nuevoB2);
      fila.set(COLUMNAS.BLOQUE_3, nuevoB3);
      fila.set(COLUMNAS.TOTAL_VERIFICADORES, nuevoTotal);
      fila.set(COLUMNAS.FECHA, fechaHoy);
      fila.set(COLUMNAS.HORA, horaStr);
      fila.set(COLUMNAS.REMITENTE, remitenteStr);
      fila.set(COLUMNAS.ESTADO, "OK");

      await fila.save();
      actualizados++;

      console.log(`[OK] Nodo ${rep.nodo} (${rep.municipio}) actualizado: B1=${nuevoB1}, B2=${nuevoB2}, B3=${nuevoB3}, Total=${nuevoTotal}`);

      if (esDBActiva()) {
        try {
          await guardarOActualizarReporteDB({
            municipioOficial: rep.municipio,
            nodo: rep.nodo,
            fecha: fechaHoy,
            hora: horaStr,
            b1Final: nuevoB1,
            b2Final: nuevoB2,
            b3Final: nuevoB3,
            totalFinal: nuevoTotal,
            remitente: remitenteStr,
            messageId: 0,
            chatId: 0,
          });
        } catch (dbErr: any) {
          console.error(`[ERROR DB] No se pudo sincronizar en PostgreSQL nodo ${rep.nodo}:`, dbErr.message);
        }
      }
    }

    console.log(`\n=== RESUMEN DE AJUSTE ===`);
    console.log(`Total procesados: ${reportes.length}`);
    console.log(`Actualizados con éxito: ${actualizados}`);
    console.log(`No encontrados: ${noEncontrados}`);
  });
}
