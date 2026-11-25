import test from "node:test";
import assert from "node:assert/strict";
import {
  asegurarColumnas,
  resetearFila,
  obtenerHojaDeCalculo,
  setHojaDeCalculoProviderForTesting,
  COLUMNAS,
} from "../src/services/sheets.js";
import { createMockWorksheet, createMockGoogleSpreadsheet } from "./helpers/mockSheets.js";
import { createGoogle503Error, createGoogleNonTransientError } from "./helpers/errorSimulation.js";

test("resilience.sheets - asegurarColumnas recupera tras 1 error 503 en loadHeaderRow", async () => {
  const mockHoja = createMockWorksheet({
    headers: ["Municipio", "Nodo"],
    failAttemptsOnLoadHeader: 1,
  });

  await asegurarColumnas(mockHoja as any);

  assert.equal(
    mockHoja.stats.loadHeaderCalls,
    2,
    "Debe haber reintentado exactamente una vez tras el 503"
  );
  assert.ok(mockHoja.headerValues.includes(COLUMNAS.ID_MENSAJE));
  assert.ok(mockHoja.headerValues.includes(COLUMNAS.ID_CHAT));
  assert.ok(mockHoja.headerValues.includes(COLUMNAS.ESTADO));
});

test("resilience.sheets - asegurarColumnas recupera tras 2 errores 503 consecutivos en loadHeaderRow", async () => {
  const mockHoja = createMockWorksheet({
    headers: ["Municipio", "Nodo"],
    failAttemptsOnLoadHeader: 2,
  });

  await asegurarColumnas(mockHoja as any);

  assert.equal(mockHoja.stats.loadHeaderCalls, 3, "Debe haber alcanzado el 3er intento exitoso");
  assert.ok(mockHoja.headerValues.includes(COLUMNAS.ESTADO));
});

test("resilience.sheets - asegurarColumnas recupera tras 1 error 503 en setHeaderRow", async () => {
  const mockHoja = createMockWorksheet({
    headers: ["Municipio", "Nodo"],
    failAttemptsOnSetHeader: 1,
  });

  await asegurarColumnas(mockHoja as any);

  assert.equal(
    mockHoja.stats.setHeaderCalls,
    2,
    "Debe haber reintentado setHeaderRow tras el 503 inicial"
  );
  assert.ok(mockHoja.headerValues.includes(COLUMNAS.ESTADO));
});

test("resilience.sheets - asegurarColumnas propaga error cuando los reintentos 503 se agotan", async () => {
  const mockHoja = createMockWorksheet({
    headers: ["Municipio", "Nodo"],
    failAttemptsOnLoadHeader: 10, // Excede maxIntentos (3)
  });

  await assert.rejects(
    async () => {
      await asegurarColumnas(mockHoja as any);
    },
    (err: any) => {
      assert.equal(err.status, 503);
      return true;
    },
    "Debe fallar de manera controlada al agotarse todos los intentos configurados"
  );

  assert.ok(
    mockHoja.stats.loadHeaderCalls >= 3,
    "Debe haber consumido todos los reintentos permitidos"
  );
});

test("resilience.sheets - asegurarColumnas falla inmediatamente sin reintentar ante error no transitorio (403)", async () => {
  const mockHoja = createMockWorksheet({
    headers: ["Municipio", "Nodo"],
    errorToThrowOnLoadHeader: createGoogleNonTransientError(403, "Forbidden: Invalid Credentials"),
    failAttemptsOnLoadHeader: 5,
  });

  await assert.rejects(
    async () => {
      await asegurarColumnas(mockHoja as any);
    },
    (err: any) => {
      assert.equal(err.status, 403);
      return true;
    }
  );

  assert.equal(
    mockHoja.stats.loadHeaderCalls,
    1,
    "No debe realizar reintentos adicionales cuando el error es 403 Forbidden"
  );
});

test("resilience.sheets - setHojaDeCalculoProviderForTesting permite inyectar y restablecer mock provider", async () => {
  const mockDoc = createMockGoogleSpreadsheet();

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  const docObtenido = await obtenerHojaDeCalculo();
  assert.equal(
    docObtenido,
    mockDoc as any,
    "obtenerHojaDeCalculo debe devolver la instancia mock provista"
  );

  // Restablecer provider para no contaminar otras pruebas
  setHojaDeCalculoProviderForTesting(null);
});

test("resilience.sheets - resetearFila recupera tras error 503 transitorio en fila.save()", async () => {
  const mockHoja = createMockWorksheet({
    rows: [
      {
        Municipio: "Maturín",
        Nodo: "16039",
        "Total Verificadores": "4",
        "Bloque 1 (9am)": "4",
        "ID Mensaje": "999",
      },
    ],
    failAttemptsOnSave: 1,
  });

  const filas = await mockHoja.getRows();
  assert.equal(filas.length, 1);

  await resetearFila(filas[0]);

  assert.equal(mockHoja.stats.saveCalls, 2, "Debe haber reintentado save() tras el 503 inicial");
  assert.equal(filas[0].get("Total Verificadores"), "0");
  assert.equal(filas[0].get("ID Mensaje"), "");
});
