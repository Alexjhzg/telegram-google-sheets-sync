import test from "node:test";
import assert from "node:assert/strict";
import { procesarYGuardarReporte } from "../src/services/reportProcessor.js";
import { setHojaDeCalculoProviderForTesting, sheetsMutex } from "../src/services/sheets.js";
import { createMockGoogleSpreadsheet, createMockWorksheet } from "./helpers/mockSheets.js";
import { config } from "../src/config/index.js";
import { DatosReporteProcesar } from "../src/types/index.js";

function generarDatosReportePrueba(nodo = 16039, municipio = "Maturín"): DatosReporteProcesar {
  return {
    reporte: {
      municipio,
      nodo,
      totalVerificadores: 2,
      bloque1: 2,
      bloque2: null,
      bloque3: null,
    },
    tiempo: {
      fecha: "14/08/2026",
      hora: "09:15 AM",
    },
    remitente: "Supervisor Pruebas",
    messageId: 54321,
    chatId: -100123456789,
    creationTimestamp: Math.floor(new Date("2026-08-14T09:15:00-04:00").getTime() / 1000),
    editTimestamp: null,
    esEdicion: false,
  };
}

test("resilience.reportProcessor - recupera tras error 503 transitorio en filaExistente.save()", async () => {
  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    rows: [
      {
        Municipio: "Maturín",
        Nodo: "16039",
        "Total Verificadores": "0",
        "Bloque 1 (9am)": "0",
        "Bloque 2 (2pm)": "0",
        "Bloque 3 (6pm)": "0",
        Fecha: "14/08/2026",
      },
    ],
    failAttemptsOnSave: 1, // 1er intento 503, 2do intento éxito
  });

  const hojaNodos = createMockWorksheet({
    title: "verificadores_nodo",
    headers: ["MUNICIPIO", "NODO", "CANTIDAD DE VERIFICADORES"],
    rows: [{ MUNICIPIO: "Maturín", NODO: "16039", "CANTIDAD DE VERIFICADORES": "5" }],
  });

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: hojaNodos,
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  try {
    const payload = generarDatosReportePrueba();
    const resultado = await procesarYGuardarReporte(payload);

    assert.equal(resultado.valido, true, "El reporte debe ser válido y procesado con éxito");
    assert.equal(
      hojaTelegram.stats.saveCalls,
      2,
      "Debe haber reintentado save() exactamente una vez"
    );
    assert.equal(resultado.totalFinal, 2);
  } finally {
    setHojaDeCalculoProviderForTesting(null);
  }
});

test("resilience.reportProcessor - degradación elegante cuando 503 es persistente con Base de Datos inactiva", async () => {
  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    rows: [{ Municipio: "Maturín", Nodo: "16039", Fecha: "14/08/2026" }],
    failAttemptsOnSave: 10, // Falla permanente
  });

  const hojaNodos = createMockWorksheet({
    title: "verificadores_nodo",
    headers: ["MUNICIPIO", "NODO", "CANTIDAD DE VERIFICADORES"],
    rows: [{ MUNICIPIO: "Maturín", NODO: "16039", "CANTIDAD DE VERIFICADORES": "5" }],
  });

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: hojaNodos,
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  const prevDbEnabled = config.db.enabled;
  config.db.enabled = false; // Simular DB no disponible

  try {
    const payload = generarDatosReportePrueba();

    // NO debe arrojar AxiosError 503 sin capturar
    const resultado = await procesarYGuardarReporte(payload);

    assert.equal(resultado.valido, false);
    assert.equal(
      resultado.razon,
      "ERROR_CONEXION_SHEETS",
      "Debe retornar razón controlada de falla de conexión externa"
    );
  } finally {
    config.db.enabled = prevDbEnabled;
    setHojaDeCalculoProviderForTesting(null);
  }
});

test("resilience.reportProcessor - proceso emite cero 'unhandledRejection' durante 503 permanente", async () => {
  let unhandledRejectionsCount = 0;
  const unhandledHandler = (reason: any) => {
    unhandledRejectionsCount++;
    console.error("[TEST DETECTED UNHANDLED REJECTION]", reason);
  };

  process.on("unhandledRejection", unhandledHandler);

  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    rows: [{ Municipio: "Maturín", Nodo: "16039", Fecha: "14/08/2026" }],
    failAttemptsOnSave: 10,
  });

  const hojaNodos = createMockWorksheet({
    title: "verificadores_nodo",
    headers: ["MUNICIPIO", "NODO", "CANTIDAD DE VERIFICADORES"],
    rows: [{ MUNICIPIO: "Maturín", NODO: "16039", "CANTIDAD DE VERIFICADORES": "5" }],
  });

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: hojaNodos,
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  try {
    const payload = generarDatosReportePrueba();
    await procesarYGuardarReporte(payload);

    // Esperar un ciclo del event loop para capturar cualquier microtask huérfana
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(
      unhandledRejectionsCount,
      0,
      "No debe haberse registrado ningún unhandledRejection"
    );
  } finally {
    process.off("unhandledRejection", unhandledHandler);
    setHojaDeCalculoProviderForTesting(null);
  }
});

test("resilience.reportProcessor - sheetsMutex libera el lock incluso si la operación falla con 503", async () => {
  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    rows: [{ Municipio: "Maturín", Nodo: "16039", Fecha: "14/08/2026" }],
    failAttemptsOnSave: 10,
  });

  const hojaNodos = createMockWorksheet({
    title: "verificadores_nodo",
    headers: ["MUNICIPIO", "NODO", "CANTIDAD DE VERIFICADORES"],
    rows: [{ MUNICIPIO: "Maturín", NODO: "16039", "CANTIDAD DE VERIFICADORES": "5" }],
  });

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: hojaNodos,
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  try {
    const payload = generarDatosReportePrueba();
    await procesarYGuardarReporte(payload);

    // Verificar que un siguiente llamador adquiere el lock de sheetsMutex sin deadlock
    let lockAdquirido = false;
    await sheetsMutex.runExclusive(async () => {
      lockAdquirido = true;
    });

    assert.equal(lockAdquirido, true, "El mutex debe estar libre para el siguiente hilo/operación");
  } finally {
    setHojaDeCalculoProviderForTesting(null);
  }
});
