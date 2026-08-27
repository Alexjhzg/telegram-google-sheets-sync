import { sincronizarCatalogoDesdeSheets } from "../src/services/catalogService.js";
import { esDBActiva } from "../src/services/database.js";

/**
 * Script para migrar/poblar/reconciliar automáticamente el catálogo de nodos
 * desde la hoja 'verificadores_nodo' de Google Sheets hacia la Base de Datos relacional.
 */
async function poblarCatalogo() {
  console.log("=== INICIANDO MIGRACIÓN/RECONCILIACIÓN DEL CATÁLOGO DE NODOS ===");

  if (!esDBActiva()) {
    console.error("[ERROR] Las variables de Base de Datos (DATABASE_URL y DATABASE_KEY) no están configuradas en el archivo .env");
    process.exit(1);
  }

  try {
    const res = await sincronizarCatalogoDesdeSheets();

    if (!res.exitoso) {
      console.error("[ERROR] Falló la reconciliación del catálogo:", res.error || res.razon);
      process.exit(1);
    }

    console.log(`✅ ¡ÉXITO! Se actualizaron ${res.sincronizados} nodos y se eliminaron ${res.eliminados || 0} nodos obsoletos en 'nodos_catalogo'.`);
    console.log("=== PROCESO FINALIZADO SATISFACTORIAMENTE ===");
  } catch (err) {
    console.error("[ERROR FATAL] Ocurrió un error no esperado:", err);
    process.exit(1);
  }
}

poblarCatalogo();

