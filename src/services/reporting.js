"use strict";

import { obtenerHojaDeCalculo, COLUMNAS } from "./sheets.js";

/**
 * Obtiene los totales del día desde la hoja 'formato_reporte' y los envía
 * en el formato solicitado al canal/grupo según el corte de hora activo.
 *
 * @param {import("grammy").Api} api - API del bot de Telegram.
 * @param {number} corte - El corte de reporte: 1 para 9:05 am, 2 para 2:05 pm, 3 para 6:05 pm.
 */
export async function enviarReporteDiario(api, corte = 3) {
  console.log(`[INFO] Iniciando envío de reporte consolidado (Corte: ${corte})...`);
  try {
    const doc = await obtenerHojaDeCalculo();
    const sheet = doc.sheetsByTitle["formato_reporte"];
    if (!sheet) {
      console.error("[ERROR] No se encontró la hoja 'formato_reporte' para generar el reporte diario.");
      return;
    }

    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();

    // Buscar la fila de TOTAL
    const filaTotal = rows.find((r) => (r.get("MUNICIPIO") || "").trim().toUpperCase() === "TOTAL");
    if (!filaTotal) {
      console.error("[ERROR] No se encontró la fila 'TOTAL' en la hoja 'formato_reporte'.");
      return;
    }

    const limiteStr = filaTotal.get("CANT. DE VERIFICADORES") || "0";
    const v9amStr   = filaTotal.get("9:00 a. m.") || "0";
    const v2pmStr   = filaTotal.get("2:00 p. m.") || "0";
    const v6pmStr   = filaTotal.get("6:00 p. m.") || "0";
    const vTotalStr = filaTotal.get("TOTAL") || "0";

    const parseVal = (val) => {
      if (!val) return 0;
      const parsed = parseFloat(String(val).replace(",", "."));
      return isNaN(parsed) ? 0 : parsed;
    };

    const limite = parseVal(limiteStr);
    const v9am   = parseVal(v9amStr);
    const v2pm   = parseVal(v2pmStr);
    const v6pm   = parseVal(v6pmStr);
    const vTotal = parseVal(vTotalStr);

    if (limite === 0) {
      console.error("[ERROR] El límite total de verificadores en la hoja es 0. Abortando reporte.");
      return;
    }

    const pct9am   = ((v9am / limite) * 100).toFixed(2).replace(".", ",");
    const pct2pm   = ((v2pm / limite) * 100).toFixed(2).replace(".", ",");
    const pct6pm   = ((v6pm / limite) * 100).toFixed(2).replace(".", ",");

    // Formatear las líneas de los cortes de forma dinámica
    const linea9am = `9:00 am ${v9am}/${limite} = ${pct9am}%`;
    const linea2pm = corte >= 2 ? `2:00 pm ${v2pm}/${limite} = ${pct2pm}%` : `2:00 pm /${limite}`;
    const linea6pm = corte >= 3 ? `6:00 pm ${v6pm}/${limite} = ${pct6pm}%` : `6:00 pm /${limite}`;

    // Calcular acumulado de campo dinámicamente según el corte para no mostrar el acumulado global de la jornada completa
    let vAcumulado = 0;
    if (corte === 1) {
      vAcumulado = v9am;
    } else if (corte === 2) {
      vAcumulado = v9am + v2pm;
    } else {
      vAcumulado = vTotal; // Corte de cierre (final de la jornada)
    }
    const pctAcumulado = ((vAcumulado / limite) * 100).toFixed(2).replace(".", ",");

    // Obtener el día de la semana actual en español (Zona Horaria Venezuela)
    const opcionesDia = { timeZone: "America/Caracas", weekday: "long" };
    const diaSemanaRaw = new Intl.DateTimeFormat("es-VE", opcionesDia).format(new Date());
    // Capitalizar el día (ej: "Lunes")
    const diaSemana = diaSemanaRaw.charAt(0).toUpperCase() + diaSemanaRaw.slice(1);

    const mensaje =
      `${diaSemana}\n\n` +
      `Monagas\n` +
      `Reporte de Encuestadores SEGEN en campo:\n` +
      `${linea9am}\n` +
      `${linea2pm}\n` +
      `${linea6pm}\n` +
      `Acumulado campo ${vAcumulado}/${limite} = ${pctAcumulado}%`;

    // Buscar el Chat ID para enviar el reporte
    let chatId = process.env.TELEGRAM_REPORT_CHAT_ID;
    if (!chatId) {
      // Intentamos extraer el chat ID de cualquier registro guardado en la hoja principal
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

    // Fallback si no hay registros aún
    if (!chatId) {
      chatId = -1003785032543;
    }

    console.log(`[INFO] Enviando reporte consolidado (Corte: ${corte}) al Chat ID: ${chatId}`);
    await api.sendMessage(chatId, mensaje);
    console.log(`[INFO] Reporte consolidado del corte ${corte} enviado con éxito.`);
  } catch (err) {
    console.error(`[ERROR] Falló la generación/envío del reporte consolidado del corte ${corte}:`, err);
  }
}

/**
 * Genera el reporte consolidado del estado Monagas en tiempo real.
 * Determina el corte horario dinámicamente según la hora actual.
 *
 * @param {object} doc - Instancia cargada de GoogleSpreadsheet.
 * @returns {Promise<string>} Mensaje formateado listo para enviar.
 */
export async function generarReporteRealTime(doc) {
  const sheet = doc.sheetsByTitle["formato_reporte"];
  if (!sheet) {
    throw new Error("No se encontró la hoja 'formato_reporte' para generar el reporte en tiempo real.");
  }

  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();

  // Buscar la fila de TOTAL
  const filaTotal = rows.find((r) => (r.get("MUNICIPIO") || "").trim().toUpperCase() === "TOTAL");
  if (!filaTotal) {
    throw new Error("No se encontró la fila 'TOTAL' en la hoja 'formato_reporte'.");
  }

  const limiteStr = filaTotal.get("CANT. DE VERIFICADORES") || "0";
  const v9amStr   = filaTotal.get("9:00 a. m.") || "0";
  const v2pmStr   = filaTotal.get("2:00 p. m.") || "0";
  const v6pmStr   = filaTotal.get("6:00 p. m.") || "0";
  const vTotalStr = filaTotal.get("TOTAL") || "0";

  const parseVal = (val) => {
    if (!val) return 0;
    const parsed = parseFloat(String(val).replace(",", "."));
    return isNaN(parsed) ? 0 : parsed;
  };

  const limite = parseVal(limiteStr);
  const v9am   = parseVal(v9amStr);
  const v2pm   = parseVal(v2pmStr);
  const v6pm   = parseVal(v6pmStr);
  const vTotal = parseVal(vTotalStr);

  if (limite === 0) {
    throw new Error("El límite total de verificadores en la hoja es 0.");
  }

  // Determinar corte dinámico en tiempo real basado en la hora de Venezuela (VET)
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

  let corte = 3;
  if (minutosDelDia <= 540) {
    corte = 1; // Antes de las 9:00 am
  } else if (minutosDelDia <= 840) {
    corte = 2; // 9:01 am a 2:00 pm
  }

  const pct9am   = ((v9am / limite) * 100).toFixed(2).replace(".", ",");
  const pct2pm   = ((v2pm / limite) * 100).toFixed(2).replace(".", ",");
  const pct6pm   = ((v6pm / limite) * 100).toFixed(2).replace(".", ",");

  const linea9am = `9:00 am ${v9am}/${limite} = ${pct9am}%`;
  const linea2pm = corte >= 2 ? `2:00 pm ${v2pm}/${limite} = ${pct2pm}%` : `2:00 pm /${limite}`;
  const linea6pm = corte >= 3 ? `6:00 pm ${v6pm}/${limite} = ${pct6pm}%` : `6:00 pm /${limite}`;

  let vAcumulado = 0;
  if (corte === 1) {
    vAcumulado = v9am;
  } else if (corte === 2) {
    vAcumulado = v9am + v2pm;
  } else {
    vAcumulado = vTotal;
  }
  const pctAcumulado = ((vAcumulado / limite) * 100).toFixed(2).replace(".", ",");

  const opcionesDia = { timeZone: "America/Caracas", weekday: "long" };
  const diaSemanaRaw = new Intl.DateTimeFormat("es-VE", opcionesDia).format(new Date());
  const diaSemana = diaSemanaRaw.charAt(0).toUpperCase() + diaSemanaRaw.slice(1);

  return (
    `*Reporte en Tiempo Real*\n` +
    `*${diaSemana}*\n\n` +
    `*Monagas*\n` +
    `Reporte de Encuestadores SEGEN en campo:\n\n` +
    `• ${linea9am}\n` +
    `• ${linea2pm}\n` +
    `• ${linea6pm}\n\n` +
    `*Acumulado campo:* ${vAcumulado}/${limite} = *${pctAcumulado}%*`
  );
}
