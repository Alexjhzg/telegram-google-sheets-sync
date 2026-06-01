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

  // Buscar si el municipio existe en alguna parte del catálogo para extraer su nombre oficial
  const filaMunicipio = filasNodos.find(fila => normalizar(fila.get("MUNICIPIO")) === municipioNormalizado);
  const municipioExiste = !!filaMunicipio;
  const municipioOficialDetectado = filaMunicipio ? (filaMunicipio.get("MUNICIPIO") || "").trim() : municipio;

  // Buscar el registro exacto de la combinación municipio + nodo
  const registroOficial = filasNodos.find(fila => {
    const mun = normalizar(fila.get("MUNICIPIO"));
    const nod = parseInt(fila.get("NODO") || "0", 10);
    return mun === municipioNormalizado && nod === nodo;
  });

  if (!registroOficial) {
    if (!municipioExiste) {
      return { valido: false, razon: "MUNICIPIO_INCORRECTO", limiteVerificadores: 0, municipioOficial: municipio };
    } else {
      return { valido: false, razon: "NODO_INCORRECTO", limiteVerificadores: 0, municipioOficial: municipioOficialDetectado };
    }
  }

  const municipioOficial = (registroOficial.get("MUNICIPIO") || "").trim();
  const limiteVerificadores = parseInt(registroOficial.get("CANTIDAD DE VERIFICADORES") || "0", 10);
  return { valido: true, limiteVerificadores, municipioOficial };
}
