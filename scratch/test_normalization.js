import { normalizarTexto, buscarFilaPorNodo } from "../src/services/sheets.js";

console.log("=== INICIANDO VERIFICACIÓN DE NORMALIZACIÓN ===");

const casos = [
  { entrada: "Maturín", esperado: "maturin" },
  { entrada: "maturin", esperado: "maturin" },
  { entrada: " MATURÍN ", esperado: "maturin" },
  { entrada: "Cedeño", esperado: "cedeno" },
  { entrada: "Caripe", esperado: "caripe" },
];

let aprobados = 0;
for (const c of casos) {
  const resultado = normalizarTexto(c.entrada);
  const ok = resultado === c.esperado;
  console.log(`Normalizar "${c.entrada}": ${resultado} (Esperado: ${c.esperado}) -> ${ok ? "✅ PASÓ" : "❌ FALLÓ"}`);
  if (ok) aprobados++;
}

console.log("\n=== PROBANDO BUSQUEDA DE FILA POR NODO ===");
const filasMock = [
  { get: (col) => col === "Municipio" ? "Maturin" : (col === "Nodo" ? "16039" : "") },
  { get: (col) => col === "Municipio" ? "Cedeño" : (col === "Nodo" ? "16040" : "") },
];

const encontrada1 = buscarFilaPorNodo(filasMock, "Maturín", 16039);
const encontrada2 = buscarFilaPorNodo(filasMock, "cedeno", 16040);

console.log("Buscar Maturín (con tilde) en fila Maturin (sin tilde):", encontrada1 ? "✅ ENCONTRADA" : "❌ NO ENCONTRADA");
console.log("Buscar cedeno (sin tilde/mayús) en fila Cedeño (con tilde/mayús):", encontrada2 ? "✅ ENCONTRADA" : "❌ NO ENCONTRADA");

if (aprobados === casos.length && encontrada1 && encontrada2) {
  console.log("\n🎉 TODAS LAS PRUEBAS DE NORMALIZACIÓN PASARON SATISFACTORIAMENTE!");
} else {
  console.error("\n❌ ALGUNAS PRUEBAS FALLARON");
  process.exit(1);
}
