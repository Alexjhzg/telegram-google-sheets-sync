"use strict";

import { obtenerHojaDeCalculo } from "../src/services/sheets.js";
import { obtenerClienteDB, esDBActiva } from "../src/services/database.js";
import { normalizarTexto } from "../src/services/sheets.js";

/**
 * Script para migrar/poblar automáticamente el catálogo de nodos
 * desde la hoja 'verificadores_nodo' de Google Sheets hacia la Base de Datos relacional.
 */
async function poblarCatalogo() {
  console.log("=== INICIANDO MIGRACIÓN/POBLADO DEL CATÁLOGO DE NODOS ===");

  if (!esDBActiva()) {
    console.error("[ERROR] Las variables de Base de Datos (DATABASE_URL y DATABASE_KEY) no están configuradas en el archivo .env");
    process.exit(1);
  }

  const client = obtenerClienteDB();

  try {
    // 1. Cargar hoja de cálculo de Google
    console.log("[1/3] Conectando con Google Sheets para leer 'verificadores_nodo'...");
    const doc = await obtenerHojaDeCalculo();
    const hojaNodos = doc.sheetsByTitle["verificadores_nodo"];

    if (!hojaNodos) {
      console.error("[ERROR] No se encontró la hoja 'verificadores_nodo' en Google Sheets.");
      process.exit(1);
    }

    const filasNodos = await hojaNodos.getRows();
    console.log(`[INFO] Se encontraron ${filasNodos.length} registros en el catálogo de Google Sheets.`);

    // 2. Mapear filas a formato de Base de Datos
    const registrosInsertar = [];
    for (const fila of filasNodos) {
      const municipio = (fila.get("MUNICIPIO") || "").trim();
      const nodo = parseInt(fila.get("NODO") || "0", 10);
      const limite = parseInt(fila.get("CANTIDAD DE VERIFICADORES") || "0", 10);

      if (municipio && nodo) {
        registrosInsertar.push({
          municipio,
          municipio_normalizado: normalizarTexto(municipio),
          nodo,
          limite_verificadores: limite,
        });
      }
    }

    console.log(`[2/3] Insertando/Actualizando ${registrosInsertar.length} nodos en la Base de Datos...`);

    // 3. Upsert masivo en la Base de Datos
    const { data, error } = await client
      .from("nodos_catalogo")
      .upsert(registrosInsertar, { onConflict: "municipio_normalizado,nodo" })
      .select();

    if (error) {
      console.error("[ERROR] Falló la inserción en la Base de Datos:", error.message);
      process.exit(1);
    }

    console.log(`[3/3] ✅ ¡ÉXITO! Se poblaron ${data.length} nodos en la tabla 'nodos_catalogo'.`);
    console.log("=== PROCESO FINALIZADO SATISFACTORIAMENTE ===");
  } catch (err) {
    console.error("[ERROR FATAL] Ocurrió un error no esperado:", err);
    process.exit(1);
  }
}

poblarCatalogo();
