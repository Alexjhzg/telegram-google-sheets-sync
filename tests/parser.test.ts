import test from "node:test";
import assert from "node:assert/strict";
import { parsearReporte, obtenerBloqueYHoraActivo } from "../src/utils/parser.js";

test("parser - parsearReporte extrae correctamente todos los datos", () => {
  const texto = `
  1. Municipio: Punceres
  2. Nodo: 16039
  3. Total de Verificadores en el nodo: 5
  ➡️Bloque (1) 9am: 2
  ➡️Bloque (2) 2pm: 3
  ➡️Bloque (3) 6pm: 0
  `;

  const reporte = parsearReporte(texto);
  assert.ok(reporte);
  assert.equal(reporte.municipio, "Punceres");
  assert.equal(reporte.nodo, 16039);
  assert.equal(reporte.totalVerificadores, 5);
  assert.equal(reporte.bloque1, 2);
  assert.equal(reporte.bloque2, 3);
  assert.equal(reporte.bloque3, 0);
});

test("parser - parsearReporte devuelve null si falta municipio o nodo", () => {
  const textoIncompleto = `Total de Verificadores: 5\n9am: 2`;
  assert.equal(parsearReporte(textoIncompleto), null);
});

test("parser - obtenerBloqueYHoraActivo determina correctamente bloques según horario", () => {
  const timestamp8am = Math.floor(new Date("2026-08-14T12:00:00Z").getTime() / 1000);
  const info8am = obtenerBloqueYHoraActivo(timestamp8am);
  assert.equal(info8am.bloqueActivo, 1);
  assert.equal(info8am.bloqueStr, "9am");

  const timestamp11am = Math.floor(new Date("2026-08-14T15:00:00Z").getTime() / 1000);
  const info11am = obtenerBloqueYHoraActivo(timestamp11am);
  assert.equal(info11am.bloqueActivo, 2);
  assert.equal(info11am.bloqueStr, "2pm");

  // 4:00 PM VET (20:00 UTC) -> Bloque 3 (6pm)
  const timestamp4pm = Math.floor(new Date("2026-08-14T20:00:00Z").getTime() / 1000);
  const info4pm = obtenerBloqueYHoraActivo(timestamp4pm);
  assert.equal(info4pm.bloqueActivo, 3);
  assert.equal(info4pm.bloqueStr, "6pm");

  // 6:01 PM VET (22:01 UTC) -> Cerrado (fuera de jornada)
  const timestamp601pm = Math.floor(new Date("2026-08-14T22:01:00Z").getTime() / 1000);
  const info601pm = obtenerBloqueYHoraActivo(timestamp601pm);
  assert.equal(info601pm.bloqueActivo, 0);
  assert.equal(info601pm.bloqueStr, "Cerrado");

  // 5:30 AM VET (09:30 UTC) -> Cerrado (antes de iniciar jornada)
  const timestamp530am = Math.floor(new Date("2026-08-14T09:30:00Z").getTime() / 1000);
  const info530am = obtenerBloqueYHoraActivo(timestamp530am);
  assert.equal(info530am.bloqueActivo, 0);
  assert.equal(info530am.bloqueStr, "Cerrado");
});
