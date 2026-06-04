"use strict";

import { obtenerHojaDeCalculo, COLUMNAS } from "./sheets.js";

/** ID de Chat de respaldo cuando no hay registros en Sheets aún. */
const FALLBACK_CHAT_ID = -1003785032543;

/**
 * Resuelve el Chat ID de destino: primero intenta leer la variable de entorno,
 * luego busca entre las filas ya cargadas y finalmente usa el fallback hardcodeado.
 *
 * @param {import("google-spreadsheet").GoogleSpreadsheetRow[]} [filasCargadas] - Filas ya obtenidas de la hoja.
 * @returns {number|string}
 */
function resolverChatId(filasCargadas = []) {
  if (process.env.TELEGRAM_REPORT_CHAT_ID) {
    return process.env.TELEGRAM_REPORT_CHAT_ID;
  }

  for (const row of filasCargadas) {
    const cId = row.get(COLUMNAS.ID_CHAT);
    if (cId) return cId;
  }

  return FALLBACK_CHAT_ID;
}

/**
 * Envía el aviso de cierre de bloque horario al canal/grupo.
 *
 * @param {import("grammy").Api} api - API del bot de Telegram.
 * @param {number} corte - El corte: 1 para 9:00 am, 2 para 2:00 pm, 3 para 6:00 pm.
 */
export async function enviarAvisoCierre(api, corte) {
  console.log(`[INFO] Iniciando envío de aviso de cierre para el corte ${corte}...`);
  try {
    const MENSAJES_CIERRE = {
      1: `🔴 *Corte de las 9:00 am CERRADO*\n` +
         `🟢 *Bloque de las 2:00 pm ACTIVO*\n\n` +
         `Cualquier dato recibido de ahora en adelante se debe asignar al bloque de las 2pm y 6pm.`,
      2: `🔴 *Corte de las 2:00 pm CERRADO*\n` +
         `🟢 *Bloque de las 6:00 pm ACTIVO*\n\n` +
         `Cualquier dato recibido de ahora en adelante se asignará al bloque de las 6pm.`,
      3: `🔴 *Corte de las 6:00 pm CERRADO*\n` +
         `🏁 *Cierre de jornada de hoy completado*`,
    };

    const mensaje = MENSAJES_CIERRE[corte];
    if (!mensaje) {
      console.warn(`[ADVERTENCIA] No hay mensaje de cierre definido para el corte ${corte}.`);
      return;
    }

    let chatId;
    try {
      const doc = await obtenerHojaDeCalculo();
      const rowsPrincipal = await doc.sheetsByTitle["registros_telegram"].getRows();
      chatId = resolverChatId(rowsPrincipal);
    } catch (e) {
      console.error("[ERROR] No se pudo obtener Chat ID de la hoja para aviso de cierre:", e);
      chatId = FALLBACK_CHAT_ID;
    }

    console.log(`[INFO] Enviando aviso de cierre (Corte: ${corte}) al Chat ID: ${chatId}`);
    await api.sendMessage(chatId, mensaje, { parse_mode: "Markdown" });
    console.log(`[INFO] Aviso de cierre del corte ${corte} enviado con éxito.`);
  } catch (err) {
    console.error(`[ERROR] Falló el envío del aviso de cierre del corte ${corte}:`, err);
  }
}

/**
 * Escanea la base de datos de Sheets, persiste el registro de incidencias en la hoja
 * 'nodos_sin_reportes' y envía una alerta grupal listando todos los nodos que
 * finalizaron la jornada con 0 verificadores reportados.
 *
 * @param {import("grammy").Api} api - API del bot de Telegram.
 */
export async function enviarAvisoNodosFaltantes(api) {
  console.log("[INFO] Iniciando generación de aviso de nodos sin reporte...");
  try {
    const doc = await obtenerHojaDeCalculo();
    const sheet = doc.sheetsByTitle["registros_telegram"];
    if (!sheet) {
      console.error("[ERROR] No se encontró la hoja 'registros_telegram' para verificar nodos faltantes.");
      return;
    }

    const filas = await sheet.getRows();

    // Agrupar los nodos con totalVerificadores === 0 por municipio
    const faltantesPorMunicipio = {};
    let totalFaltantes = 0;

    for (const fila of filas) {
      const municipio = (fila.get(COLUMNAS.MUNICIPIO) || "").trim();
      const nodo = (fila.get(COLUMNAS.NODO) || "").trim();
      const totalVerificadores = parseInt(fila.get(COLUMNAS.TOTAL_VERIFICADORES) || "0", 10);
      const idMensaje = (fila.get(COLUMNAS.ID_MENSAJE) || "").trim();
      const fecha = (fila.get(COLUMNAS.FECHA) || "").trim();

      // Se considera nodo faltante si tiene 0 verificadores Y además no tiene ningún reporte registrado (sin ID de mensaje y sin fecha)
      if (municipio && nodo && totalVerificadores === 0 && !idMensaje && !fecha) {
        if (!faltantesPorMunicipio[municipio]) {
          faltantesPorMunicipio[municipio] = [];
        }
        faltantesPorMunicipio[municipio].push(nodo);
        totalFaltantes++;
      }
    }

    // Si todos los nodos reportaron, no mandamos nada
    if (totalFaltantes === 0) {
      console.log("[INFO] Todos los nodos han reportado hoy. No se envía aviso de faltantes.");
      return;
    }

    // 1. Persistir el registro histórico de incidencias en Google Sheets
    console.log("[INFO] Guardando registro de incidencias en 'nodos_sin_reportes'...");
    try {
      let sheetSinReportes = doc.sheetsByTitle["nodos_sin_reportes"];
      if (!sheetSinReportes) {
        console.log("[INFO] Creando la hoja 'nodos_sin_reportes' ya que no existía...");
        sheetSinReportes = await doc.addSheet({ title: "nodos_sin_reportes" });
      }

      try {
        await sheetSinReportes.loadHeaderRow();
      } catch (_) {
        console.log("[INFO] Inicializando cabeceras en 'nodos_sin_reportes'...");
        await sheetSinReportes.setHeaderRow(["Fecha", "Municipio", "Nodo"]);
      }

      const opts = { timeZone: "America/Caracas", year: "numeric", month: "2-digit", day: "2-digit" };
      const hoyStr = new Date().toLocaleDateString("es-VE", opts);

      // Verificar si ya existen registros del día de hoy en nodos_sin_reportes
      const filasExistentes = await sheetSinReportes.getRows();
      const yaExiste = filasExistentes.some(f => (f.get("Fecha") || "").trim() === hoyStr);

      if (yaExiste) {
        console.log(`[INFO] Los registros de nodos sin reporte para el día ${hoyStr} ya están guardados. Omitiendo duplicados.`);
      } else {
        const filasNuevas = [];
        for (const municipio of Object.keys(faltantesPorMunicipio)) {
          for (const nodo of faltantesPorMunicipio[municipio]) {
            filasNuevas.push({ "Fecha": hoyStr, "Municipio": municipio, "Nodo": String(nodo) });
          }
        }

        if (filasNuevas.length > 0) {
          await sheetSinReportes.addRows(filasNuevas);
          console.log(`[INFO] Se guardaron exitosamente ${filasNuevas.length} registros en 'nodos_sin_reportes'.`);
        }
      }
    } catch (errSheet) {
      console.error("[ERROR] Falló el guardado histórico en la hoja 'nodos_sin_reportes':", errSheet);
    }

    // 2. Construir y enviar el mensaje de alerta a Telegram
    let mensaje = "⚠️ *NODOS SIN REPORTE REGISTRADO HOY*\n\n" +
                  "Municipios y sus respectivos nodos sin actividad:\n\n";

    const municipiosOrdenados = Object.keys(faltantesPorMunicipio).sort((a, b) => a.localeCompare(b));
    for (const municipio of municipiosOrdenados) {
      const nodos = faltantesPorMunicipio[municipio].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const nodosStr = nodos.map(n => `Nodo ${n}`).join(" • ");
      mensaje += `📍 *${municipio}* • ${nodosStr}\n\n`;
    }
    mensaje += "📝 _Estaremos registrando estas incidencias._";

    // Reutilizar las filas ya cargadas para evitar una segunda llamada a la API de Google
    const chatId = resolverChatId(filas);
    console.log(`[INFO] Enviando aviso de nodos faltantes al Chat ID: ${chatId}`);
    await api.sendMessage(chatId, mensaje, { parse_mode: "Markdown" });
    console.log("[INFO] Aviso de nodos faltantes enviado con éxito.");
  } catch (err) {
    console.error("[ERROR] Falló el envío del aviso de nodos faltantes:", err);
  }
}
