import test from "node:test";
import assert from "node:assert/strict";
import { normalizarTexto, buscarFilaPorNodo, obtenerUltimosValores } from "../src/services/sheets.js";

test("sheets - normalizarTexto elimina tildes, mayúsculas y espacios extra", () => {
  assert.equal(normalizarTexto("Maturín"), "maturin");
  assert.equal(normalizarTexto("  MATURÍN  "), "maturin");
  assert.equal(normalizarTexto("Cedeño"), "cedeno");
  assert.equal(normalizarTexto("Caripe"), "caripe");
  assert.equal(normalizarTexto(null), "");
});

test("sheets - buscarFilaPorNodo encuentra la fila independientemente de tildes o mayúsculas", () => {
  const filasMock: any[] = [
    {
      get: (col: string) => {
        if (col === "Municipio") return "Maturin";
        if (col === "Nodo") return "16039";
        return "";
      },
    },
    {
      get: (col: string) => {
        if (col === "Municipio") return "Cedeño";
        if (col === "Nodo") return "16040";
        return "";
      },
    },
  ];

  const res1 = buscarFilaPorNodo(filasMock, "Maturín", 16039);
  assert.ok(res1);
  assert.equal(res1.get("Nodo"), "16039");

  const res2 = buscarFilaPorNodo(filasMock, "cedeno", 16040);
  assert.ok(res2);
  assert.equal(res2.get("Nodo"), "16040");

  const resInexistente = buscarFilaPorNodo(filasMock, "Maturín", 99999);
  assert.equal(resInexistente, null);
});

test("sheets - obtenerUltimosValores recupera correctamente los valores acumulados", () => {
  const fechaHoy = "14/08/2026";
  const filasMock: any[] = [
    {
      rowNumber: 1,
      toObject: () => ({
        Municipio: "Maturin",
        Nodo: "16039",
        Fecha: fechaHoy,
        "Total Verificadores": "3",
        "Bloque 1 (9am)": "1",
        "Bloque 2 (2pm)": "2",
        "Bloque 3 (6pm)": "0",
      }),
    },
  ];

  const ultimos = obtenerUltimosValores(filasMock, "Maturín", 16039, fechaHoy);
  assert.equal(ultimos.total, 3);
  assert.equal(ultimos.b1, 1);
  assert.equal(ultimos.b2, 2);
  assert.equal(ultimos.b3, 0);
});
