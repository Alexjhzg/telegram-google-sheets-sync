import test from "node:test";
import assert from "node:assert/strict";
import { sincronizarCatalogoDesdeSheets } from "../src/services/catalogService.js";
import { esDBActiva } from "../src/services/database.js";

test("catalogService - sincronizarCatalogoDesdeSheets no falla si DB no está activa", async () => {
  if (!esDBActiva()) {
    const res = await sincronizarCatalogoDesdeSheets();
    assert.equal(res.exitoso, false);
    assert.equal(res.razon, "DB_NO_ACTIVA");
  }
});
