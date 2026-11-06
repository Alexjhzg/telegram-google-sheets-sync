import test from "node:test";
import assert from "node:assert/strict";
import { ejecutarLimpieza } from "../src/jobs/cleanup.js";
import { setHojaDeCalculoProviderForTesting, COLUMNAS } from "../src/services/sheets.js";
import { createMockWorksheet, createMockGoogleSpreadsheet } from "./helpers/mockSheets.js";
import { createGoogle503Error } from "./helpers/errorSimulation.js";

test("resilience.cleanup - contención de errores por fila: fila 1 falla con 503 pero filas 2 y 3 se limpian con éxito", async () => {
  // Configurar 3 filas marcadas para revisión que han excedido los 5 minutos de holgura
  const timestampExpirado = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    rows: [
      {
        rowNumber: 2,
        Municipio: "Maturín",
        Nodo: "16039",
        "Total Verificadores": "3",
        "Bloque 1 (9am)": "3",
        "ID Mensaje": "1001",
        "ID Chat": "-100111",
        Estado: `Revisión desde: ${timestampExpirado}`,
      },
      {
        rowNumber: 3,
        Municipio: "Cedeño",
        Nodo: "16040",
        "Total Verificadores": "2",
        "Bloque 1 (9am)": "2",
        "ID Mensaje": "1002",
        "ID Chat": "-100111",
        Estado: `Revisión desde: ${timestampExpirado}`,
      },
      {
        rowNumber: 4,
        Municipio: "Piar",
        Nodo: "16041",
        "Total Verificadores": "1",
        "Bloque 1 (9am)": "1",
        "ID Mensaje": "1003",
        "ID Chat": "-100111",
        Estado: `Revisión desde: ${timestampExpirado}`,
      },
    ],
  });

  // Configurar falla permanente 503 exclusivamente para la primera fila que procesará el bucle reverso
  // ejecutarLimpieza itera desde filas.length - 1 hacia 0 (índice 2: rowNumber 4, ID 1003)
  hojaTelegram.setRowSaveFailure(2, 10, createGoogle503Error("503 Service Unavailable en fila 1003"));

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: createMockWorksheet({ title: "verificadores_nodo" }),
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  // Mock API de Telegram mínima
  const mockApi = {} as any;

  try {
    // force = true para omitir chequeo de horario laboral durante la prueba
    await ejecutarLimpieza(mockApi, 10, true);

    const filasFinales = await hojaTelegram.getRows();

    // La fila con falla 503 (ID 1003) no pudo resetearse, pero NO abortó el ciclo
    const filaFalla = filasFinales.find((f) => f.get(COLUMNAS.ID_MENSAJE) === "1003");
    assert.ok(filaFalla, "La fila que falló debe existir");
    assert.equal(filaFalla.get(COLUMNAS.TOTAL_VERIFICADORES), "1", "La fila con 503 mantuvo su valor previo");

    // Las otras dos filas (ID 1001 e ID 1002) debieron ser analizadas y reseteadas exitosamente
    const fila2 = filasFinales.find((f) => f.get(COLUMNAS.NODO) === "16039");
    const fila3 = filasFinales.find((f) => f.get(COLUMNAS.NODO) === "16040");

    assert.ok(fila2, "La fila 16039 debe existir");
    assert.equal(fila2.get(COLUMNAS.TOTAL_VERIFICADORES), "0", "La fila 16039 debió resetearse a 0");
    assert.equal(fila2.get(COLUMNAS.ESTADO), "", "El estado de 16039 debió limpiarse");

    assert.ok(fila3, "La fila 16040 debe existir");
    assert.equal(fila3.get(COLUMNAS.TOTAL_VERIFICADORES), "0", "La fila 16040 debió resetearse a 0");
    assert.equal(fila3.get(COLUMNAS.ESTADO), "", "El estado de 16040 debió limpiarse");
  } finally {
    setHojaDeCalculoProviderForTesting(null);
  }
});

test("resilience.cleanup - ciclo completo se ejecuta sin unhandled rejections ante fallo 503 en getRows", async () => {
  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    failAttemptsOnGetRows: 10, // Falla permanente al leer filas
  });

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: createMockWorksheet({ title: "verificadores_nodo" }),
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  let unhandledCaptured = false;
  const handler = () => {
    unhandledCaptured = true;
  };
  process.on("unhandledRejection", handler);

  try {
    // No debe lanzar excepción no capturada ni detener la aplicación
    await ejecutarLimpieza({} as any, 10, true);

    await new Promise((r) => setTimeout(r, 20));
    assert.equal(unhandledCaptured, false, "No deben ocurrir unhandledRejections");
  } finally {
    process.off("unhandledRejection", handler);
    setHojaDeCalculoProviderForTesting(null);
  }
});
