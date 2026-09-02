import { test, describe } from "node:test";
import assert from "node:assert";
import { estandarizarFecha, obtenerFechaHoyEstandar } from "../src/utils/dateUtils.js";

describe("Pruebas de estandarización de fechas (dateUtils)", () => {
  test("Debe estandarizar formato D/M/YYYY y DD/MM/YYYY a DD/MM/YYYY", () => {
    assert.strictEqual(estandarizarFecha("2/9/2026"), "02/09/2026");
    assert.strictEqual(estandarizarFecha("02/09/2026"), "02/09/2026");
    assert.strictEqual(estandarizarFecha("11/8/2026"), "11/08/2026");
    assert.strictEqual(estandarizarFecha("5/12/2025"), "05/12/2025");
  });

  test("Debe estandarizar formato ISO YYYY-MM-DD y YYYY/MM/DD a DD/MM/YYYY", () => {
    assert.strictEqual(estandarizarFecha("2026-09-02"), "02/09/2026");
    assert.strictEqual(estandarizarFecha("2026-9-2"), "02/09/2026");
    assert.strictEqual(estandarizarFecha("2026/08/11"), "11/08/2026");
  });

  test("Debe estandarizar formato guiones DD-MM-YYYY a DD/MM/YYYY", () => {
    assert.strictEqual(estandarizarFecha("02-09-2026"), "02/09/2026");
    assert.strictEqual(estandarizarFecha("2-9-2026"), "02/09/2026");
  });

  test("Debe estandarizar cadenas con timestamp o ISO completas", () => {
    assert.strictEqual(estandarizarFecha("2026-09-02T15:30:00.000Z"), "02/09/2026");
    assert.strictEqual(estandarizarFecha("02/09/2026 10:00:00"), "02/09/2026");
  });

  test("Debe estandarizar número de serie de Excel/Google Sheets", () => {
    // 46237 en Excel Epoch es 2026-07-28 aproximadamente
    const resultado = estandarizarFecha(46237);
    assert.ok(resultado !== null && /^\d{2}\/\d{2}\/\d{4}$/.test(resultado));
  });

  test("Debe retornar null para valores vacíos o inválidos", () => {
    assert.strictEqual(estandarizarFecha(""), null);
    assert.strictEqual(estandarizarFecha("    "), null);
    assert.strictEqual(estandarizarFecha(null), null);
    assert.strictEqual(estandarizarFecha(undefined), null);
    assert.strictEqual(estandarizarFecha("fecha-invalida"), null);
    assert.strictEqual(estandarizarFecha("32/13/2026"), null);
  });

  test("obtenerFechaHoyEstandar debe retornar formato DD/MM/YYYY válido", () => {
    const hoy = obtenerFechaHoyEstandar();
    assert.match(hoy, /^\d{2}\/\d{2}\/\d{4}$/);
  });
});
