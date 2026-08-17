import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config/index.js";
import { normalizarTexto } from "./sheets.js";
import { ValidacionResultado, AuditoriaPayload } from "../types/index.js";

let dbClient: SupabaseClient | null = null;

/**
 * Retorna la instancia singleton del cliente de Base de Datos relacional si está habilitada en la configuración.
 */
export function obtenerClienteDB(): SupabaseClient | null {
  if (!config.db.enabled) {
    return null;
  }

  if (!dbClient) {
    console.log("[INFO] Inicializando cliente de Base de Datos relacional...");
    dbClient = createClient(config.db.url!, config.db.key!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }

  return dbClient;
}

/**
 * Indica si la Base de Datos relacional está configurada y lista para ser usada.
 */
export function esDBActiva(): boolean {
  return config.db.enabled;
}

/**
 * Valida un Municipio y Nodo contra el catálogo oficial en la Base de Datos.
 */
export async function validarMunicipioNodoDB(municipio: string, nodo: number | string): Promise<ValidacionResultado> {
  const client = obtenerClienteDB();
  if (!client) {
    throw new Error("La base de datos relacional no está configurada");
  }

  const munNormalizado = normalizarTexto(municipio);
  const nodInt = parseInt(String(nodo), 10);

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
 */
export async function guardarOActualizarReporteDB(datos: any): Promise<any> {
  const client = obtenerClienteDB();
  if (!client) {
    throw new Error("La base de datos relacional no está configurada");
  }

  const munNormalizado = normalizarTexto(datos.municipioOficial);

  let fechaISO = datos.fecha;
  if (datos.fecha && datos.fecha.includes("/")) {
    const partes = datos.fecha.split("/");
    if (partes.length === 3) {
      fechaISO = `${partes[2]}-${partes[1].padStart(2, "0")}-${partes[0].padStart(2, "0")}`;
    }
  }

  const payload = {
    municipio: datos.municipioOficial,
    municipio_normalizado: munNormalizado,
    nodo: parseInt(datos.nodo, 10),
    fecha: fechaISO,
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
    if (error.code === "23503") {
      console.warn(`[ADVERTENCIA] No se pudo guardar en BD: El nodo ${datos.nodo} (${datos.municipioOficial}) no se encuentra en nodos_catalogo.`);
    } else {
      console.error("[ERROR] Error al hacer upsert en la Base de Datos:", error.message);
    }
    throw error;
  }

  console.log(`[INFO] Reporte guardado/actualizado exitosamente en Base de Datos (Nodo: ${datos.nodo}, Fecha: ${datos.fecha}).`);
  return data;
}

/**
 * Registra una acción en la tabla de auditoría de la Base de Datos.
 */
export async function registrarAuditoriaDB({ chatId, messageId, remitente, accion, detalles }: AuditoriaPayload): Promise<void> {
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
  } catch (err: any) {
    console.warn("[ADVERTENCIA] No se pudo guardar log de auditoría en la Base de Datos:", err.message);
  }
}

/**
 * Marca un reporte como sincronizado con Google Sheets en la Base de Datos (sincronizado_sheets = true).
 */
export async function marcarReporteSincronizadoDB(nodo: number | string, fecha: string): Promise<void> {
  const client = obtenerClienteDB();
  if (!client) return;

  let fechaISO = fecha;
  if (fecha && fecha.includes("/")) {
    const partes = fecha.split("/");
    if (partes.length === 3) {
      fechaISO = `${partes[2]}-${partes[1].padStart(2, "0")}-${partes[0].padStart(2, "0")}`;
    }
  }

  try {
    const { error } = await client
      .from("reportes_diarios")
      .update({ sincronizado_sheets: true })
      .eq("nodo", parseInt(String(nodo), 10))
      .eq("fecha", fechaISO);

    if (error) {
      console.warn("[ADVERTENCIA] No se pudo marcar reporte como sincronizado en Base de Datos:", error.message);
    } else {
      console.log(`[INFO] Reporte marcado como sincronizado_sheets = true en BD (Nodo: ${nodo}, Fecha: ${fechaISO}).`);
    }
  } catch (err: any) {
    console.warn("[ADVERTENCIA] Error al actualizar sincronizado_sheets en Base de Datos:", err.message);
  }
}

/**
 * Guarda o actualiza un lote de nodos del catálogo en la Base de Datos relacional.
 */
export async function upsertCatalogoNodosDB(nodos: Array<{ municipio: string; municipioNormalizado?: string; nodo: number; limiteVerificadores?: number }>): Promise<{ guardados: number }> {
  const client = obtenerClienteDB();
  if (!client) {
    throw new Error("La base de datos relacional no está configurada");
  }

  if (!Array.isArray(nodos) || nodos.length === 0) {
    return { guardados: 0 };
  }

  const payload = nodos.map((n) => ({
    municipio: n.municipio,
    municipio_normalizado: n.municipioNormalizado || normalizarTexto(n.municipio),
    nodo: parseInt(String(n.nodo), 10),
    limite_verificadores: parseInt(String(n.limiteVerificadores || 0), 10),
  }));

  const { data, error } = await client
    .from("nodos_catalogo")
    .upsert(payload, { onConflict: "municipio_normalizado,nodo" })
    .select();

  if (error) {
    console.error("[ERROR] Falló upsert de catálogo de nodos en Base de Datos:", error.message);
    throw error;
  }

  const cantidad = data?.length || nodos.length;
  console.log(`[INFO] ${cantidad} nodo(s) sincronizado(s)/actualizado(s) exitosamente en la Base de Datos.`);
  return { guardados: cantidad };
}
