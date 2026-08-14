import test from "node:test";
import assert from "node:assert/strict";
import { esHorarioLaboral } from "../src/jobs/cleanup.js";

test("cleanup - esHorarioLaboral retorna un valor booleano válido", () => {
  const enHorario = esHorarioLaboral();
  assert.equal(typeof enHorario, "boolean");
});
