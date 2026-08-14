"use strict";

import { createClient } from "@supabase/supabase-js";
import { config } from "../config/index.js";
import { normalizarTexto } from "./sheets.js";

let dbClient = null;

/**
 * Retorna la instancia singleton del cliente de Base de Datos relacional si está habilitada en la configuración.
 * @returns {import("@supabase/supabase-js").SupabaseClient | null}
 */
export function obtenerClienteDB() {
  if (!config.db.enabled) {
    return null;
  }

  if (!dbClient) {
    console.log("[INFO] Inicializando cliente de Base de Datos relacional...");
    dbClient = createClient(config.db.url, config.db.key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      realtime: {
        disabled: true,
      },
    });
  }

  return dbClient;
}

/**
 * Indica si la Base de Datos relacional está configurada y lista para ser usada.
 * @returns {boolean}
 */
export function esDBActiva() {
  return config.db.enabled;
}

/**
 * Valida un Municipio y Nodo contra el catálogo oficial en la Base de Datos.
 *
 * @param {string} municipio - Nombre del municipio.
 * @param {number} nodo - Número del nodo.
 * @returns {Promise<{ valido: boolean, limiteVerificadores: number, municipioOficial: string, razon?: string }>}
 */
export async function validarMunicipioNodoDB(municipio, nodo) {
  const client = obtenerClienteDB();
  if (!client) {
    throw new Error("La base de datos relacional no está configurada");
  }

  const munNormalizado = normalizarTexto(municipio);
  const nodInt = parseInt(nodo, 10);

  // 1. Verificar si el municipio existe en el catálogo
  const { data: nodosMunicipio, error: errMun } = await client
    .from("nodos_catalogo")
    .select("*")
    .eq("municipio_normalizado", munNormalizado);

  if (errMun) {
    console.error("[ERROR] Error al consultar municipio en Base de Datos:", errMun.message);
    throw errMun;
  }

  const municipioExiste = nodosMunicipio && nodosMunicipio.length > 0;
  const municipioOficialDetectado = municipioExiste ? nodosMunicipio[0].municipio : municipio;

  // 2. Buscar la combinación exacta de municipio + nodo
  const { data: registroOficial, error: errNodo } = await client
    .from("nodos_catalogo")
    .select("*")
    .eq("municipio_normalizado", munNormalizado)
    .eq("nodo", nodInt)
    .maybeSingle();

  if (errNodo) {
    console.error("[ERROR] Error al consultar combinación municipio+nodo en Base de Datos:", errNodo.message);
    throw errNodo;
  }

  if (!registroOficial) {
    if (!municipioExiste) {
      return { valido: false, razon: "MUNICIPIO_INCORRECTO", limiteVerificadores: 0, municipioOficial: municipio };
    } else {
      return { valido: false, razon: "NODO_INCORRECTO", limiteVerificadores: 0, municipioOficial: municipioOficialDetectado };
    }
  }

  return {
    valido: true,
    limiteVerificadores: registroOficial.limite_verificadores,
    municipioOficial: registroOficial.municipio,
  };
}

/**
 * Guarda o actualiza (Upsert) un reporte en la tabla 'reportes_diarios' de la Base de Datos.
 *
 * @param {object} datos
 * @returns {Promise<object>} Registro insertado/actualizado.
 */
export async function guardarOActualizarReporteDB(datos) {
  const client = obtenerClienteDB();
  if (!client) {
    throw new Error("La base de datos relacional no está configurada");
  }

  const munNormalizado = normalizarTexto(datos.municipioOficial);

  const payload = {
    municipio: datos.municipioOficial,
    municipio_normalizado: munNormalizado,
    nodo: parseInt(datos.nodo, 10),
    fecha: datos.fecha,
    hora: datos.hora,
    bloque_1: datos.b1Final,
    bloque_2: datos.b2Final,
    bloque_3: datos.b3Final,
    total_verificadores: datos.totalFinal,
    remitente: datos.remitente,
    telegram_message_id: datos.messageId ? BigInt(datos.messageId) : null,
    telegram_chat_id: datos.chatId ? BigInt(datos.chatId) : null,
    estado: "OK",
    sincronizado_sheets: false,
  };

  const { data, error } = await client
    .from("reportes_diarios")
    .upsert(payload, { onConflict: "nodo,fecha" })
    .select()
    .single();

  if (error) {
    console.error("[ERROR] Error al hacer upsert en la Base de Datos:", error.message);
    throw error;
  }

  console.log(`[INFO] Reporte guardado/actualizado exitosamente en Base de Datos (Nodo: ${datos.nodo}, Fecha: ${datos.fecha}).`);
  return data;
}

/**
 * Registra una acción en la tabla de auditoría de la Base de Datos.
 */
export async function registrarAuditoriaDB({ chatId, messageId, remitente, accion, detalles }) {
  const client = obtenerClienteDB();
  if (!client) return;

  try {
    await client.from("logs_auditoria").insert({
      telegram_chat_id: chatId ? BigInt(chatId) : null,
      telegram_message_id: messageId ? BigInt(messageId) : null,
      remitente,
      accion,
      detalles,
    });
  } catch (err) {
    console.warn("[ADVERTENCIA] No se pudo guardar log de auditoría en la Base de Datos:", err.message);
  }
}
