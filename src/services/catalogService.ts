import { obtenerHojaDeCalculo, normalizarTexto, sheetsMutex } from "./sheets.js";
import { esDBActiva, reconciliarCatalogoNodosDB } from "./database.js";
import { SyncCatalogoResultado } from "../types/index.js";

/**
 * Lee el catálogo de municipios, nodos y límites de verificadores desde la hoja
 * 'verificadores_nodo' en Google Sheets y los sincroniza/reconcilia hacia PostgreSQL.
 */
export async function sincronizarCatalogoDesdeSheets(): Promise<SyncCatalogoResultado> {
  if (!esDBActiva()) {
    console.log("[INFO] Base de Datos relacional no activa. Omitiendo sincronización de catálogo.");
    return { exitoso: false, sincronizados: 0, eliminados: 0, razon: "DB_NO_ACTIVA" };
  }

  return sheetsMutex.runExclusive(async () => {
    try {
      console.log("[SYNC] Iniciando sincronización del catálogo de nodos desde Google Sheets a SQL...");
      const doc = await obtenerHojaDeCalculo();
      const hojaNodos = doc.sheetsByTitle["verificadores_nodo"];

      if (!hojaNodos) {
        console.error("[ERROR] No se encontró la hoja 'verificadores_nodo' para sincronizar el catálogo.");
        return { exitoso: false, sincronizados: 0, eliminados: 0, razon: "HOJA_NO_ENCONTRADA" };
      }

      const filas = await hojaNodos.getRows();
      const nodosParaSincronizar: Array<{ municipio: string; municipioNormalizado: string; nodo: number; limiteVerificadores: number }> = [];

      for (const fila of filas) {
        const municipio = (fila.get("MUNICIPIO") || "").trim();
        const rawNodo = (fila.get("NODO") || "").trim();
        const rawLimite = (fila.get("CANTIDAD DE VERIFICADORES") || "0").trim();

        const nodo = parseInt(rawNodo, 10);
        const limiteVerificadores = parseInt(rawLimite, 10);

        if (municipio && !isNaN(nodo) && nodo > 0) {
          nodosParaSincronizar.push({
            municipio,
            municipioNormalizado: normalizarTexto(municipio),
            nodo,
            limiteVerificadores: isNaN(limiteVerificadores) ? 0 : limiteVerificadores,
          });
        }
      }

      const res = await reconciliarCatalogoNodosDB(nodosParaSincronizar);
      console.log(`[SYNC] Catálogo sincronizado exitosamente: ${res.guardados} nodos procesados/guardados, ${res.eliminados} nodos obsoletos eliminados.`);
      return { exitoso: true, sincronizados: res.guardados, eliminados: res.eliminados };
    } catch (error: any) {
      console.error("[ERROR] Falló la sincronización del catálogo desde Google Sheets:", error.message);
      return { exitoso: false, sincronizados: 0, eliminados: 0, error: error.message };
    }
  });
}
