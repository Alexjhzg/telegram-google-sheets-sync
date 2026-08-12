"use strict";

import { config } from "../config/index.js";
import { obtenerHojaDeCalculo, COLUMNAS } from "./sheets.js";

/**
 * Determina el corte horario activo (1: 9am, 2: 2pm, 3: 6pm) basado en la hora local VET.
 *
 * @returns {number}
 */
export function determinarCorteActivoVET() {
  const dateVE = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Caracas",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(dateVE);
  const hourVE = parseInt(parts.find((p) => p.type === "hour").value, 10);
  const minuteVE = parseInt(parts.find((p) => p.type === "minute").value, 10);
  const minutosDelDia = hourVE * 60 + minuteVE;

  if (minutosDelDia > 1080) return 3; // Después de las 6:00 pm
  if (minutosDelDia > 840) return 2;  // 2:01 pm a 6:00 pm
  if (minutosDelDia > 540) return 1;  // 9:01 am a 2:00 pm
  return 0;                           // Antes de las 9:00 am
}

/**
 * Construye el mensaje consolidado general del Estado Monagas desde 'formato_reporte'.
 *
 * @param {import("google-spreadsheet").GoogleSpreadsheet} doc
 * @param {number} corte - El corte horario activo: 1 (9am), 2 (2pm), 3 (6pm).
 * @returns {Promise<string>}
 */
export async function obtenerConsolidadoGeneral(doc, corte) {
  const sheet = doc.sheetsByTitle["formato_reporte"];
  if (!sheet) {
    throw new Error("No se encontró la hoja 'formato_reporte' para generar el reporte diario.");
  }

  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();

  const filaTotal = rows.find((r) => (r.get("MUNICIPIO") || "").trim().toUpperCase() === "TOTAL");
  if (!filaTotal) {
    throw new Error("No se encontró la fila 'TOTAL' en la hoja 'formato_reporte'.");
  }

  const parseVal = (val) => {
    if (!val) return 0;
    const parsed = parseFloat(String(val).replace(",", "."));
    return isNaN(parsed) ? 0 : parsed;
  };

  const limite = parseVal(filaTotal.get("CANT. DE VERIFICADORES"));
  const v9am   = parseVal(filaTotal.get("9:00 a. m."));
  const v2pm   = parseVal(filaTotal.get("2:00 p. m."));
  const v6pm   = parseVal(filaTotal.get("6:00 p. m."));
  const vTotal = parseVal(filaTotal.get("TOTAL"));

  if (limite === 0) {
    throw new Error("El límite total de verificadores en la hoja es 0.");
  }

  const pct9am   = ((v9am / limite) * 100).toFixed(2).replace(".", ",");
  const pct2pm   = ((v2pm / limite) * 100).toFixed(2).replace(".", ",");
  const pct6pm   = ((v6pm / limite) * 100).toFixed(2).replace(".", ",");

  const linea9am = corte >= 1 ? `9:00 am ${v9am}/${limite} = ${pct9am}%` : `9:00 am`;
  const linea2pm = corte >= 2 ? `2:00 pm ${v2pm}/${limite} = ${pct2pm}%` : `2:00 pm`;
  const linea6pm = corte >= 3 ? `6:00 pm ${v6pm}/${limite} = ${pct6pm}%` : `6:00 pm`;

  let vAcumulado = 0;
  if (corte === 1) vAcumulado = v9am;
  else if (corte === 2) vAcumulado = v9am + v2pm;
  else vAcumulado = vTotal;

  const pctAcumulado = ((vAcumulado / limite) * 100).toFixed(2).replace(".", ",");

  const opcionesDia = { timeZone: "America/Caracas", weekday: "long" };
  const opcionesFecha = { timeZone: "America/Caracas", year: "numeric", month: "2-digit", day: "2-digit" };
  const fechaStr = new Intl.DateTimeFormat("es-VE", opcionesFecha).format(new Date());
  const diaSemanaRaw = new Intl.DateTimeFormat("es-VE", opcionesDia).format(new Date());
  const diaSemana = diaSemanaRaw.charAt(0).toUpperCase() + diaSemanaRaw.slice(1);

  return (
    `*${diaSemana} ${fechaStr}*\n\n` +
    `*Monagas*\n` +
    `Reporte de Encuestadores SEGEN en campo:\n\n` +
    `• ${linea9am}\n` +
    `• ${linea2pm}\n` +
    `• ${linea6pm}\n\n` +
    `*Acumulado campo:* ${vAcumulado}/${limite} = *${pctAcumulado}%*`
  );
}

/**
 * Obtiene el desglose exclusivo de verificadores faltantes agrupados por municipio y nodo.
 *
 * @param {import("google-spreadsheet").GoogleSpreadsheet} doc
 * @param {number} corte - El corte horario activo: 1 (9am), 2 (2pm), 3 (6pm).
 * @returns {Promise<{ mensajeDesglose: string, totalFaltantes: number, limiteTotal: number }>}
 */
export async function obtenerDesgloseFaltantes(doc, corte) {
  const hojaNodos = doc.sheetsByTitle["verificadores_nodo"];
  const hojaTelegram = doc.sheetsByTitle["registros_telegram"];

  if (!hojaNodos) {
    throw new Error("No se encontró la hoja 'verificadores_nodo' para el desglose de faltantes.");
  }

  const rowsNodos = await hojaNodos.getRows();
  const rowsTelegram = hojaTelegram ? await hojaTelegram.getRows() : [];

  const telegramMap = new Map();
  for (const r of rowsTelegram) {
    const mun = (r.get(COLUMNAS.MUNICIPIO) || "").trim().toLowerCase();
    const nod = parseInt(r.get(COLUMNAS.NODO) || "0", 10);
    if (mun && nod) {
      telegramMap.set(`${mun}-${nod}`, r);
    }
  }

  const municipiosMap = new Map();
  let limiteEstado = 0;
  let salieronEstado = 0;
  let faltantesEstado = 0;

  for (const rowNodo of rowsNodos) {
    const municipio = (rowNodo.get("MUNICIPIO") || "").trim();
    const nodo = parseInt(rowNodo.get("NODO") || "0", 10);
    const limiteNodo = parseInt(rowNodo.get("CANTIDAD DE VERIFICADORES") || "0", 10);

    if (!municipio || !nodo) continue;

    limiteEstado += limiteNodo;

    const key = `${municipio.toLowerCase()}-${nodo}`;
    const rowTelegram = telegramMap.get(key);

    let b1 = 0, b2 = 0, b3 = 0, totalMsg = 0;
    let idMensaje = "";
    let fechaFila = "";

    if (rowTelegram) {
      b1 = parseInt(rowTelegram.get(COLUMNAS.BLOQUE_1) || "0", 10);
      b2 = parseInt(rowTelegram.get(COLUMNAS.BLOQUE_2) || "0", 10);
      b3 = parseInt(rowTelegram.get(COLUMNAS.BLOQUE_3) || "0", 10);
      totalMsg = parseInt(rowTelegram.get(COLUMNAS.TOTAL_VERIFICADORES) || "0", 10);
      idMensaje = (rowTelegram.get(COLUMNAS.ID_MENSAJE) || "").trim();
      fechaFila = (rowTelegram.get(COLUMNAS.FECHA) || "").trim();
    }

    let reportadoNodo = 0;
    if (corte <= 1) {
      reportadoNodo = b1;
    } else if (corte === 2) {
      reportadoNodo = b1 + b2;
    } else {
      reportadoNodo = totalMsg > 0 ? totalMsg : (b1 + b2 + b3);
    }

    const faltantesNodo = Math.max(0, limiteNodo - reportadoNodo);
    const tieneReporte = !!(idMensaje || fechaFila);

    salieronEstado += reportadoNodo;
    faltantesEstado += faltantesNodo;

    if (!municipiosMap.has(municipio)) {
      municipiosMap.set(municipio, {
        municipio,
        capacidad: 0,
        salieron: 0,
        faltan: 0,
        nodos: [],
      });
    }

    const munData = municipiosMap.get(municipio);
    munData.capacidad += limiteNodo;
    munData.salieron += reportadoNodo;
    munData.faltan += faltantesNodo;

    munData.nodos.push({
      nodo,
      limiteNodo,
      reportadoNodo,
      faltantesNodo,
      tieneReporte,
    });
  }

  const pctFaltantesEstado = limiteEstado > 0
    ? ((faltantesEstado / limiteEstado) * 100).toFixed(2).replace(".", ",")
    : "0,00";

  if (faltantesEstado === 0) {
    const mensajeDesglose =
      `📍 *DESGLOSE DE FALTANTES POR MUNICIPIO Y NODO*\n\n` +
      `✅ *¡Todos los municipios y nodos han completado la salida a campo!*`;
    return { mensajeDesglose, totalFaltantes: 0, limiteTotal: limiteEstado };
  }

  let mensajeDesglose =
    `📊 *DESGLOSE DE FALTANTES POR MUNICIPIO Y NODO*\n` +
    `⚠️ *Total Faltaron por Salir en el Estado:* ${faltantesEstado}/${limiteEstado} = *${pctFaltantesEstado}%*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const municipiosOrdenados = Array.from(municipiosMap.values())
    .filter((m) => m.faltan > 0)
    .sort((a, b) => a.municipio.localeCompare(b.municipio));

  for (const m of municipiosOrdenados) {
    mensajeDesglose += `📍 *${m.municipio}* (Faltan: ${m.faltan} | Salieron: ${m.salieron}/${m.capacidad})\n`;

    const nodosFaltantes = m.nodos
      .filter((n) => n.faltantesNodo > 0)
      .sort((a, b) => a.nodo - b.nodo);

    for (const n of nodosFaltantes) {
      let etiquetaEstado = "";
      if (!n.tieneReporte) {
        etiquetaEstado = `(Sin reporte ❌)`;
      } else if (n.reportadoNodo === 0) {
        etiquetaEstado = `(Reportó 0/${n.limiteNodo} ⚠️)`;
      } else {
        etiquetaEstado = `(Reportó ${n.reportadoNodo}/${n.limiteNodo} 📉)`;
      }

      mensajeDesglose += `  • Nodo ${n.nodo}: Faltan ${n.faltantesNodo} ${etiquetaEstado}\n`;
    }

    mensajeDesglose += `\n`;
  }

  return { mensajeDesglose: mensajeDesglose.trim(), totalFaltantes: faltantesEstado, limiteTotal: limiteEstado };
}

/**
 * Genera el reporte consolidado del estado Monagas en tiempo real.
 * Determina el corte horario dinámicamente según la hora actual y devuelve 2 mensajes.
 *
 * @param {object} doc - Instancia cargada de GoogleSpreadsheet.
 * @returns {Promise<string[]>} Arreglo con [mensajeConsolidado, mensajeDesglose].
 */
export async function generarReporteRealTime(doc) {
  const corte = determinarCorteActivoVET();
  const mensajeConsolidado = await obtenerConsolidadoGeneral(doc, corte);
  const { mensajeDesglose } = await obtenerDesgloseFaltantes(doc, corte);

  return [mensajeConsolidado, mensajeDesglose];
}

/**
 * Obtiene los totales del día y los envía según la configuración al canal principal y gerentes.
 *
 * @param {import("grammy").Api} api - API del bot de Telegram.
 * @param {number} corte - El corte de reporte: 1 para 9:05 am, 2 para 2:05 pm, 3 para 6:05 pm.
 */
export async function enviarReporteDiario(api, corte = 3) {
  console.log(`[INFO] Iniciando envío de reporte consolidado (Corte: ${corte})...`);
  try {
    const doc = await obtenerHojaDeCalculo();
    const mensajeConsolidado = await obtenerConsolidadoGeneral(doc, corte);
    const { mensajeDesglose } = await obtenerDesgloseFaltantes(doc, corte);

    let chatId = process.env.TELEGRAM_REPORT_CHAT_ID;
    if (!chatId) {
      const sheetPrincipal = doc.sheetsByTitle["registros_telegram"];
      const rowsPrincipal = await sheetPrincipal.getRows();
      for (const row of rowsPrincipal) {
        const cId = row.get(COLUMNAS.ID_CHAT);
        if (cId) {
          chatId = cId;
          break;
        }
      }
    }

    if (!chatId) {
      chatId = -1003785032543;
    }

    console.log(`[INFO] Enviando reporte consolidado general (Corte: ${corte}) al Chat ID principal: ${chatId}`);
    await api.sendMessage(chatId, mensajeConsolidado, { parse_mode: "Markdown" });
    console.log(`[INFO] Reporte consolidado general del corte ${corte} enviado con éxito al grupo principal.`);

    if (config.telegram.managerChatIds.length > 0) {
      for (const managerId of config.telegram.managerChatIds) {
        console.log(`[INFO] Enviando reporte y desglose de faltantes individualmente al encargado (Chat ID: ${managerId})`);
        try {
          await api.sendMessage(managerId, mensajeConsolidado, { parse_mode: "Markdown" });
          await api.sendMessage(managerId, mensajeDesglose, { parse_mode: "Markdown" });
          console.log(`[INFO] Copia del reporte y desglose enviadas individualmente a ${managerId} con éxito.`);
        } catch (managerErr) {
          console.error(`[ERROR] Falló el envío del reporte al encargado ${managerId}:`, managerErr);
        }
      }
    }
  } catch (err) {
    console.error(`[ERROR] Falló la generación/envío del reporte consolidado del corte ${corte}:`, err);
  }
}
