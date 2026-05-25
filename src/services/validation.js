"use strict";

/**
 * Valida si la combinación de Municipio y Nodo existe en la hoja de catálogo oficial 'verificadores_nodo'.
 *
 * @param {import("google-spreadsheet").GoogleSpreadsheet} doc - El documento de Google Sheets autenticado.
 * @param {string} municipio - Nombre del municipio parsed.
 * @param {number} nodo - Número del nodo parsed.
 * @returns {Promise<{ valido: boolean, limiteVerificadores: number }>}
 */
export async function validarMunicipioNodo(doc, municipio, nodo) {
  const hojaNodos = doc.sheetsByTitle["verificadores_nodo"];
  if (!hojaNodos) {
    console.error("[ERROR] No se encontró la hoja 'verificadores_nodo' para la validación.");
    throw new Error("Falta la hoja 'verificadores_nodo'");
  }

  const normalizar = (txt) =>
    (txt || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, ""); // Quitar acentos/tildes

  const municipioNormalizado = normalizar(municipio);

  const filasNodos = await hojaNodos.getRows();
  const registroOficial = filasNodos.find(fila => {
    const mun = normalizar(fila.get("MUNICIPIO"));
    const nod = parseInt(fila.get("NODO") || "0", 10);
    return mun === municipioNormalizado && nod === nodo;
  });

  if (!registroOficial) {
    return { valido: false, limiteVerificadores: 0, municipioOficial: municipio };
  }

  const municipioOficial = (registroOficial.get("MUNICIPIO") || "").trim();
  const limiteVerificadores = parseInt(registroOficial.get("CANTIDAD DE VERIFICADORES") || "0", 10);
  return { valido: true, limiteVerificadores, municipioOficial };
}
