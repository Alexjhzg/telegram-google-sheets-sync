import { Cron } from "croner";
import { config } from "../config/index.js";
import { obtenerHojaDeCalculo, COLUMNAS, buscarFilaPorMensaje, resetearFila, resetearFilasDeDiasAnteriores, guardarHistoricoDiario } from "../services/sheets.js";

/**
 * Verifica si un mensaje de Telegram sigue existiendo intentando
 * llamar a setMessageReaction con una lista vacía (operación no destructiva).
 *
 * @param {import("grammy").Api} api - API de Telegram.
 * @param {number} chatId
 * @param {number} messageId
 * @returns {Promise<boolean>} `true` si el mensaje existe, `false` si fue borrado.
 */
async function mensajeExiste(api, chatId, messageId) {
  try {
    // Intentamos editar el markup del mensaje con una lista vacía.
    // Como el mensaje fue enviado por un usuario (y no por el bot), si el mensaje existe
    // esta llamada FALLARÁ inmediatamente con el error "message can't be edited" (o "message is not modified").
    // Si el mensaje NO existe (fue borrado), fallará con "message to edit not found".
    // Esto nos permite verificar la existencia de forma 100% silenciosa sin alterar reacciones ni animaciones.
    await api.editMessageReplyMarkup(chatId, messageId, { reply_markup: { inline_keyboard: [] } });
    return true; // Si por alguna razón tiene éxito, el mensaje existe.
  } catch (error) {
    const desc = (error.description || "").toLowerCase();

    // Si el mensaje fue borrado o no existe en el servidor
    if (
      desc.includes("message to edit not found") ||
      desc.includes("message_id_invalid") ||
      desc.includes("message not found")
    ) {
      return false;
    }

    // Si el mensaje SÍ existe pero no tenemos permisos de edición (comportamiento esperado)
    if (
      desc.includes("message can't be edited") ||
      desc.includes("message is not modified")
    ) {
      return true;
    }

    // Otro tipo de error (permisos, rate-limit…): asumir que el mensaje existe para no borrar datos válidos por error.
    console.warn(`[ADVERTENCIA] No se pudo verificar Mensaje ID ${messageId} en Chat ${chatId}: ${error.message}`);
    return true;
  }
}

/**
 * Recorre todas las filas de Google Sheets que tengan un ID de mensaje
 * registrado y elimina aquellas cuyo mensaje ya no exista en Telegram.
 *
 * @param {import("grammy").Api} api - API de Telegram para verificar mensajes.
 * @param {number} limiteFilas - Límite de filas más recientes a analizar para evitar sobrecarga.
 */
export async function ejecutarLimpieza(api, limiteFilas = 15) {
  console.log(`[INFO] Iniciando limpieza de mensajes eliminados en Telegram (límite: ${limiteFilas} filas)...`);
  try {
    const doc   = await obtenerHojaDeCalculo();
    const hoja  = doc.sheetsByTitle["registros_telegram"];
    const filas = await hoja.getRows();

    let eliminados = 0;
    let analizados = 0;
    const MAX_FILAS_ANALIZAR = limiteFilas;

    // Iteramos en orden inverso (de abajo hacia arriba) para evitar que el desfase de
    // índices en Google Sheets afecte a las filas restantes al eliminar registros en bucle.
    for (let i = filas.length - 1; i >= 0; i--) {
      const fila       = filas[i];
      const obj        = fila.toObject();
      const messageId  = parseInt(obj[COLUMNAS.ID_MENSAJE], 10);
      const chatId     = parseInt(obj[COLUMNAS.ID_CHAT], 10);

      // Saltar filas que aún no tienen los campos de rastreo
      if (isNaN(messageId) || isNaN(chatId)) continue;

      analizados++;
      if (analizados > MAX_FILAS_ANALIZAR) {
        console.log(`[INFO] Se alcanzó el límite de seguridad de ${MAX_FILAS_ANALIZAR} filas analizadas. Finalizando escaneo.`);
        break;
      }

      // Verificar si la fila está en revisión y ha superado el tiempo de gracia de 5 minutos
      const estado = obj[COLUMNAS.ESTADO] || "";
      let debeBorrarsePorRevision = false;

      if (estado.startsWith("Revisión desde:")) {
        const timestampStr = estado.replace("Revisión desde:", "").trim();
        const timestampRevision = new Date(timestampStr).getTime();
        if (!isNaN(timestampRevision)) {
          const ahora = Date.now();
          const transcurridoMins = (ahora - timestampRevision) / 1000 / 60;
          if (transcurridoMins >= 5) {
            console.log(`[INFO] Fila en REVISIÓN superó el tiempo de gracia de 5 min (${Math.round(transcurridoMins)} min). Se procederá a borrar.`);
            debeBorrarsePorRevision = true;
          }
        }
      }

      const existe = debeBorrarsePorRevision ? false : await mensajeExiste(api, chatId, messageId);

      if (!existe || debeBorrarsePorRevision) {
        if (!existe && !debeBorrarsePorRevision) {
          console.log(`[INFO] Mensaje eliminado en Telegram (Chat: ${chatId}, ID: ${messageId}). Reseteando fila...`);
        } else if (debeBorrarsePorRevision) {
          console.log(`[INFO] Reporte inválido superó tiempo de revisión (Mensaje ID: ${messageId}). Reseteando fila...`);
        }
        await resetearFila(fila);
        eliminados++;
      }

      // Respetar los límites de velocidad de la API de Telegram
      await new Promise((r) => setTimeout(r, config.app.cleanupRequestDelayMs));
    }

    console.log(
      eliminados > 0
        ? `[INFO] Limpieza finalizada: ${eliminados} fila(s) eliminada(s).`
        : "[INFO] Limpieza finalizada: no se detectaron mensajes borrados."
    );
  } catch (error) {
    console.error("[ERROR] Falló la ejecución de la limpieza:", error);
  }
}

/**
 * Obtiene los totales del día desde la hoja 'formato_reporte' y los envía
 * en el formato solicitado al canal/grupo a las 6:05 PM.
 *
 * @param {import("grammy").Api} api - API del bot de Telegram.
 */
export async function enviarReporteDiario(api) {
  console.log("[INFO] Iniciando envío de reporte diario de las 6:05 PM...");
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
    const pctTotal = ((vTotal / limite) * 100).toFixed(0);

    // Obtener el día de la semana actual en español (Zona Horaria Venezuela)
    const opcionesDia = { timeZone: "America/Caracas", weekday: "long" };
    const diaSemanaRaw = new Intl.DateTimeFormat("es-VE", opcionesDia).format(new Date());
    // Capitalizar el día (ej: "Lunes")
    const diaSemana = diaSemanaRaw.charAt(0).toUpperCase() + diaSemanaRaw.slice(1);

    const mensaje =
      `${diaSemana}\n\n` +
      `Monagas\n` +
      `Reporte de Encuestadores SEGEN en campo:\n` +
      `9am ${v9am}/${limite} = ${pct9am}%\n` +
      `2pm ${v2pm}/${limite} = ${pct2pm}%\n` +
      `6pm ${v6pm}/${limite} = ${pct6pm}%\n` +
      `Acumulado campo ${vTotal}/${limite} = ${pctTotal}%`;

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
      chatId = -1003966980568;
    }

    console.log(`[INFO] Enviando reporte diario al Chat ID: ${chatId}`);
    await api.sendMessage(chatId, mensaje);
    console.log("[INFO] Reporte diario enviado con éxito.");
  } catch (err) {
    console.error("[ERROR] Falló la generación/envío del reporte diario:", err);
  }
}

export function programarLimpieza(api) {
  // 1. Limpieza inicial al arrancar el bot (últimas 60 filas)
  setTimeout(() => ejecutarLimpieza(api, 60), config.app.cleanupInitialDelayMs);

  // 2. Limpieza periódica continua (cada 5 minutos, verifica las últimas 60 filas)
  new Cron("*/5 * * * *", { timezone: "America/Caracas" }, () => ejecutarLimpieza(api, 60));

  // 3. Limpieza de precisión exactamente en las horas de corte (9am, 2pm y 6pm de Venezuela, verifica 60 filas)
  const jobCortes = new Cron("0 9,14,18 * * *", { timezone: "America/Caracas" }, () => ejecutarLimpieza(api, 60));

  // 4. Limpieza diaria a la medianoche (00:00) para vaciar/resetear los reportes del día anterior
  new Cron("0 0 * * *", { timezone: "America/Caracas" }, async () => {
    console.log("[INFO] Iniciando reseteo diario de medianoche para registros del día anterior...");
    try {
      const doc = await obtenerHojaDeCalculo();
      await resetearFilasDeDiasAnteriores(doc);
    } catch (err) {
      console.error("[ERROR] Fallo en el reseteo diario de medianoche:", err);
    }
  });

  // 5. Envío automático del reporte consolidado diario a las 6:05 PM (18:05 VET)
  const jobReporte = new Cron("5 18 * * *", { timezone: "America/Caracas" }, () => enviarReporteDiario(api));

  // 6. Resguardo de historial diario a las 11:00 PM (23:00 VET)
  const jobHistorico = new Cron("0 23 * * *", { timezone: "America/Caracas" }, async () => {
    console.log("[INFO] Iniciando resguardo de historial diario a las 11:00 PM VET...");
    try {
      const doc = await obtenerHojaDeCalculo();
      await guardarHistoricoDiario(doc);
    } catch (err) {
      console.error("[ERROR] Fallo al guardar el historial diario:", err);
    }
  });

  // Loguear de forma legible cuándo será el próximo corte real
  const proximaFecha = jobCortes.nextRun();
  const proximoCorteStr = proximaFecha.toLocaleTimeString("es-VE", {
    timeZone: "America/Caracas",
    hour: "2-digit",
    minute: "2-digit",
  });
  console.log(`[INFO] Limpieza horaria activa. Siguiente corte a las ${proximoCorteStr} (hora de Venezuela).`);

  const proximoReporteFecha = jobReporte.nextRun();
  const proximoReporteStr = proximoReporteFecha.toLocaleDateString("es-VE", {
    timeZone: "America/Caracas",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  console.log(`[INFO] Reporte diario consolidado activo. Siguiente reporte programado para el ${proximoReporteStr} (hora de Venezuela).`);

  const proximoHistoricoFecha = jobHistorico.nextRun();
  const proximoHistoricoStr = proximoHistoricoFecha.toLocaleDateString("es-VE", {
    timeZone: "America/Caracas",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  console.log(`[INFO] Resguardo histórico diario activo. Siguiente guardado programado para el ${proximoHistoricoStr} (hora de Venezuela).`);
}
