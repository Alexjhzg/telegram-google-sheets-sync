import { obtenerHojaDeCalculo, buscarFilaPorNodo, COLUMNAS, sheetsMutex } from "../src/services/sheets.js";
import { esDBActiva, guardarOActualizarReporteDB } from "../src/services/database.js";

export interface ReporteAjuste {
  municipio: string;
  nodo: number;
  b1: number;
  b2: number;
  b3: number;
  total: number;
  hora: string;
  remitente: string;
}

// Lista de los 9 reportes del 16/10/2026 recuperados del chat de Telegram
export const REPORTES_RECUPERADOS: ReporteAjuste[] = [
  {
    municipio: "Caripe",
    nodo: 16044,
    b1: 0,
    b2: 0,
    b3: 1,
    total: 1,
    hora: "16:05",
    remitente: "Yonlis",
  },
  {
    municipio: "Piar",
    nodo: 16022,
    b1: 0,
    b2: 0,
    b3: 0,
    total: 0,
    hora: "16:55",
    remitente: "Ruth Bronis",
  },
  {
    municipio: "Maturin",
    nodo: 16115,
    b1: 0,
    b2: 2,
    b3: 1,
    total: 3,
    hora: "17:18",
    remitente: "JesusZM_",
  },
  {
    municipio: "Libertador",
    nodo: 16023,
    b1: 0,
    b2: 0,
    b3: 1,
    total: 1,
    hora: "17:25",
    remitente: "R.A Ore y.",
  },
  {
    municipio: "Maturin",
    nodo: 16073,
    b1: 0,
    b2: 0,
    b3: 2,
    total: 2,
    hora: "17:30",
    remitente: "Maria Mallerlin López",
  },
  {
    municipio: "Bolívar",
    nodo: 16102,
    b1: 0,
    b2: 0,
    b3: 1,
    total: 1,
    hora: "17:30",
    remitente: "Salvy",
  },
  {
    municipio: "Piar",
    nodo: 16009,
    b1: 0,
    b2: 0,
    b3: 4,
    total: 4,
    hora: "17:35",
    remitente: "Rosa Carrillo",
  },
  {
    municipio: "Maturin",
    nodo: 16017,
    b1: 0,
    b2: 0,
    b3: 3,
    total: 3,
    hora: "17:37",
    remitente: "Yuris Sanchez",
  },
  {
    municipio: "Maturin",
    nodo: 16061,
    b1: 0,
    b2: 0,
    b3: 3,
    total: 3,
    hora: "17:54",
    remitente: "Ronnys Montilla",
  },
];

async function ejecutar() {
  const fechaHoy = "16/10/2026";
  console.log(`========================================================`);
  console.log(` APLICANDO AJUSTE DE REPORTES RECUPERADOS (${fechaHoy})`);
  console.log(`========================================================\n`);

  await sheetsMutex.runExclusive(async () => {
    const doc = await obtenerHojaDeCalculo();
    const hoja = doc.sheetsByTitle["registros_telegram"];
    if (!hoja) throw new Error("No se encontró la pestaña 'registros_telegram'.");

    const filas = await hoja.getRows();
    let actualizados = 0;
    let noEncontrados = 0;

    for (const rep of REPORTES_RECUPERADOS) {
      const fila = buscarFilaPorNodo(filas, rep.municipio, rep.nodo);
      if (!fila) {
        console.warn(`[ADVERTENCIA] No se encontró fila fija para Municipio: ${rep.municipio}, Nodo: ${rep.nodo}`);
        noEncontrados++;
        continue;
      }

      fila.set(COLUMNAS.BLOQUE_1, rep.b1);
      fila.set(COLUMNAS.BLOQUE_2, rep.b2);
      fila.set(COLUMNAS.BLOQUE_3, rep.b3);
      fila.set(COLUMNAS.TOTAL_VERIFICADORES, rep.total);
      fila.set(COLUMNAS.FECHA, fechaHoy);
      fila.set(COLUMNAS.HORA, rep.hora);
      fila.set(COLUMNAS.REMITENTE, rep.remitente);
      fila.set(COLUMNAS.ESTADO, "OK");

      await fila.save();
      actualizados++;

      console.log(`[OK] Nodo ${rep.nodo} (${rep.municipio}) actualizado: B1=${rep.b1}, B2=${rep.b2}, B3=${rep.b3}, Total=${rep.total}`);

      if (esDBActiva()) {
        try {
          await guardarOActualizarReporteDB({
            municipioOficial: rep.municipio,
            nodo: rep.nodo,
            fecha: fechaHoy,
            hora: rep.hora,
            b1Final: rep.b1,
            b2Final: rep.b2,
            b3Final: rep.b3,
            totalFinal: rep.total,
            remitente: rep.remitente,
            messageId: 0,
            chatId: 0,
          });
        } catch (dbErr: any) {
          console.error(`[ERROR DB] No se pudo guardar en DB nodo ${rep.nodo}:`, dbErr.message);
        }
      }
    }

    console.log(`\n========================================================`);
    console.log(`RESUMEN: ${actualizados} nodos actualizados exitosamente en Google Sheets.`);
    if (noEncontrados > 0) {
      console.log(`ALERTAS: ${noEncontrados} nodos no se encontraron en la hoja.`);
    }
    console.log(`========================================================`);
  });
}

ejecutar().catch((err) => {
  console.error("[FATAL] Error ejecutando la corrección de reportes:", err);
  process.exit(1);
});
