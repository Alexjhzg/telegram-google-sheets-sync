import { GoogleSpreadsheet } from "google-spreadsheet";
import { normalizarTexto } from "./sheets.js";
import { ValidacionResultado } from "../types/index.js";

/**
 * Valida si la combinación de Municipio y Nodo existe en la hoja de catálogo oficial 'verificadores_nodo'.
 *
 * @param doc - El documento de Google Sheets autenticado.
 * @param municipio - Nombre del municipio parsed.
 * @param nodo - Número del nodo parsed.
 */
export async function validarMunicipioNodo(
  doc: GoogleSpreadsheet,
  municipio: string,
  nodo: number
): Promise<ValidacionResultado> {
  const hojaNodos = doc.sheetsByTitle["verificadores_nodo"];
  if (!hojaNodos) {
    console.error("[ERROR] No se encontró la hoja 'verificadores_nodo' para la validación.");
    throw new Error("Falta la hoja 'verificadores_nodo'");
  }

  const municipioNormalizado = normalizarTexto(municipio);

  const filasNodos = await hojaNodos.getRows();

  const filaMunicipio = filasNodos.find(fila => normalizarTexto(fila.get("MUNICIPIO")) === municipioNormalizado);
  const municipioExiste = !!filaMunicipio;
  const municipioOficialDetectado = filaMunicipio ? (filaMunicipio.get("MUNICIPIO") || "").trim() : municipio;

  const registroOficial = filasNodos.find(fila => {
    const mun = normalizarTexto(fila.get("MUNICIPIO"));
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
