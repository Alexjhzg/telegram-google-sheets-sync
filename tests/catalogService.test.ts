import test from "node:test";
import assert from "node:assert/strict";
import { reconciliarCatalogoNodosDB, esDBActiva } from "../src/services/database.js";
import { sincronizarCatalogoDesdeSheets } from "../src/services/catalogService.js";

test("database - reconciliarCatalogoNodosDB maneja BD inactiva retornando error adecuado", async () => {
  if (!esDBActiva()) {
    await assert.rejects(
      async () => {
        await reconciliarCatalogoNodosDB([]);
      },
      {
        name: "Error",
        message: "La base de datos relacional no está configurada",
      }
    );
  }
});

test("catalogService - sincronizarCatalogoDesdeSheets expone propiedad eliminados en resultado con DB inactiva", async () => {
  if (!esDBActiva()) {
    const res = await sincronizarCatalogoDesdeSheets();
    assert.equal(res.exitoso, false);
    assert.equal(res.sincronizados, 0);
    assert.equal(res.eliminados, 0);
    assert.equal(res.razon, "DB_NO_ACTIVA");
  }
});
