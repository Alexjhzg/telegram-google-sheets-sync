import test from "node:test";
import assert from "node:assert/strict";
import { esDBActiva, obtenerClienteDB } from "../src/services/database.js";

test("database - esDBActiva retorna un booleano sin fallar", () => {
  const activa = esDBActiva();
  assert.equal(typeof activa, "boolean");
});

test("database - obtenerClienteDB retorna null si no están configuradas las variables de BD", () => {
  if (!esDBActiva()) {
    const client = obtenerClienteDB();
    assert.equal(client, null);
  }
});
