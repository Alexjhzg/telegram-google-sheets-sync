"use strict";

import { config } from "../config/index.js";
import { parsearReporte, convertirTimestamp, obtenerBloqueYHoraActivo } from "../utils/parser.js";
import { obtenerNombreRemitente, reaccionar } from "../utils/telegram.js";
import { registrarComandos } from "./commands.js";
import {
  eliminarReporte,
  marcarFilaParaRevision,
  procesarYGuardarReporte,
} from "../services/reportProcessor.js";

// Regex que detecta si un mensaje contiene una solicitud de eliminación manual
const REGEX_ELIMINAR = /\b(?:eliminar|borrar|eliminado|borrado)\b/i;

/**
 * Maneja la solicitud de eliminación de un registro desde Telegram.
 * El usuario edita su mensaje a "eliminar" para borrar la fila de Sheets.
 *
 * @param {import("grammy").Context} ctx
 * @param {number} messageId
 */
async function manejarEliminacion(ctx, messageId) {
  console.log(`[INFO] Solicitud de eliminación detectada — Mensaje ID: ${messageId}`);
  try {
    const reseteado = await eliminarReporte(messageId);

    if (reseteado) {
      console.log(`[INFO] Fila reseteada a cero en Google Sheets (Mensaje ID: ${messageId}).`);
    } else {
      console.warn(`[ADVERTENCIA] No se encontró fila con Mensaje ID: ${messageId} para resetear.`);
    }

    // Intentar eliminar también el mensaje en Telegram para mantener limpio el grupo
    try {
      await ctx.deleteMessage();
      console.log(`[INFO] Mensaje de Telegram ID ${messageId} eliminado exitosamente.`);
    } catch (err) {
      console.warn(`[ADVERTENCIA] No se pudo borrar el mensaje de Telegram ID ${messageId}: ${err.message}`);
    }
  } catch (error) {
    console.error("[ERROR] No se pudo resetear el registro de Google Sheets:", error);
  }
}

/**
 * Registra el handler principal de mensajes (nuevos y editados) en el bot.
 * @param {import("grammy").Bot} bot
 */
export function registrarHandlers(bot) {
  // Registrar comandos administrativos (/reportes, /lista, etc.)
  registrarComandos(bot);

  bot.on(["message:text", "edited_message:text"], async (ctx) => {
    const mensajeObj = ctx.message || ctx.editedMessage;
    if (!mensajeObj) return;

    const texto      = mensajeObj.text;
    const messageId  = mensajeObj.message_id;
    const esEdicion  = !!ctx.editedMessage;
    const remitente  = obtenerNombreRemitente(ctx);

    console.log(
      `\n=== ${esEdicion ? "MENSAJE EDITADO" : "NUEVO MENSAJE"} ===` +
      `\nDe: ${remitente} (@${ctx.from?.username ?? "sin_usuario"} | ID: ${ctx.from?.id})` +
      `\nChat: ${ctx.chat.id} | Mensaje ID: ${messageId}` +
      `\n${texto}` +
      `\n=============================\n`
    );

    // ── 0. Verificar si está dentro del horario de la jornada laboral (6:00 AM a 6:00 PM VET) ──
    const creationTimestamp = mensajeObj.date || Math.floor(Date.now() / 1000);
    const editTimestamp = mensajeObj.edit_date || null;
    let timestampEfectivo = creationTimestamp;

    if (esEdicion && editTimestamp) {
      const diffMins = (editTimestamp - creationTimestamp) / 60;
      const holgura = config.app.reportEditGracePeriodMins;
      if (diffMins > holgura) {
        timestampEfectivo = editTimestamp;
      }
    }

    const { minutosDelDia, horaStr } = obtenerBloqueYHoraActivo(timestampEfectivo);
    if (minutosDelDia < 360 || minutosDelDia > 1080) {
      console.log(`[INFO] Acción recibida fuera de jornada laboral (${horaStr} VET). Ignorando silenciosamente.`);
      return;
    }

    // ── 1. Verificar si es una solicitud de eliminación manual ──
    if (REGEX_ELIMINAR.test(texto)) {
      await manejarEliminacion(ctx, messageId);
      return;
    }

    // ── 2. Filtrar por palabra clave de reporte ─────────────────
    if (!texto.toLowerCase().includes(config.app.reportKeyword.toLowerCase())) {
      if (esEdicion) {
        await marcarFilaParaRevision(null, messageId);
      }
      return;
    }

    // ── 3. Parsear datos del reporte ────────────────────────────
    const reporte = parsearReporte(texto);
    if (!reporte) {
      console.warn("[ADVERTENCIA] Palabra clave encontrada pero no se pudo parsear el reporte.");
      if (esEdicion) {
        await marcarFilaParaRevision(null, messageId);
      }
      await reaccionar(ctx, "👎");

      // Analizar qué campo faltó para enviar la alerta correspondiente
      const tieneMunicipio = /(?:Municipio|municipio)\*?\s*:/i.test(texto);
      const tieneNodo      = /(?:Nodo|nodo)\*?\s*:/i.test(texto);

      let mensajeError = "";
      if (!tieneMunicipio && !tieneNodo) {
        mensajeError =
          `⚠️ Reporte Rechazado: Formato inválido\n\n` +
          `Hola ${remitente}, no he podido leer los datos de tu reporte. Asegúrate de incluir el Municipio y el número de Nodo.\n\n` +
          `👉 Ejemplo de formato correcto:\n` +
          `1. Municipio: Punceres\n` +
          `2. Nodo: 16039\n` +
          `3. Total de Verificadores en el nodo: 1\n` +
          `➡️Bloque (1) 9am: 0\n` +
          `➡️Bloque (2) 2pm: 0\n` +
          `➡️Bloque (3) 6pm: 1`;
      } else if (!tieneMunicipio) {
        mensajeError =
          `⚠️ Reporte Rechazado: Falta de Municipio\n\n` +
          `Hola ${remitente}, tu reporte no incluye la línea de municipio (ej. Municipio: Punceres).\n\n` +
          `👉 Por favor, edita tu mensaje o envíalo de nuevo incluyendo el municipio correspondiente.`;
      } else if (!tieneNodo) {
        mensajeError =
          `⚠️ Reporte Rechazado: Falta de Nodo\n\n` +
          `Hola ${remitente}, tu reporte no incluye la línea de nodo (ej. Nodo: 16039).\n\n` +
          `👉 Por favor, edita tu mensaje o envíalo de nuevo indicando el número del nodo correspondiente.`;
      }

      if (mensajeError) {
        try {
          await ctx.reply(mensajeError, {
            reply_parameters: { message_id: messageId }
          });
        } catch (err) {
          console.error("[ERROR] No se pudo enviar el mensaje de alerta de formato:", err.message);
        }
      }
      return;
    }

    const tiempo = convertirTimestamp(mensajeObj.date);
    console.log("[INFO] Reporte parseado:", { ...reporte, ...tiempo, remitente });

    // ── 4. Procesar y persistir el reporte en Sheets ────────────
    try {
      const creationTimestamp = mensajeObj.date || Math.floor(Date.now() / 1000);
      const editTimestamp = mensajeObj.edit_date || null;

      const resultado = await procesarYGuardarReporte({
        reporte,
        tiempo,
        remitente,
        messageId,
        chatId: ctx.chat.id,
        creationTimestamp,
        editTimestamp,
        esEdicion,
      });

      if (!resultado.valido) {
        await reaccionar(ctx, "👎");

        // Formatear respuesta de error según la razón del fallo
        let mensajeRespuesta = "";

        if (resultado.razon === "MUNICIPIO_INCORRECTO") {
          mensajeRespuesta =
            `⚠️ *Reporte Rechazado: Municipio no reconocido*\n\n` +
            `Hola *${remitente}*, el municipio *${resultado.municipioParseado}* no se encuentra registrado en la base de datos oficial.\n\n` +
            `• *¿Qué pudo pasar?* Es posible que haya un error de ortografía.\n` +
            `• *Municipios válidos (ejemplos):* Acosta, Caripe, Maturín, Cedeño, Piar, Libertador, etc.\n\n` +
            `👉 *¿Cómo solucionarlo?* Por favor, edita tu mensaje o vuelve a enviar el reporte corregido.`;
        } else if (resultado.razon === "NODO_INCORRECTO") {
          mensajeRespuesta =
            `⚠️ *Reporte Rechazado: Nodo no reconocido*\n\n` +
            `Hola *${remitente}*, en el municipio *${resultado.municipioOficial}* no existe el nodo *${resultado.nodoParseado}* en la base de datos oficial.\n\n` +
            `• *¿Qué pudo pasar?* El número de nodo ingresado no corresponde a este municipio.\n\n` +
            `👉 *¿Cómo solucionarlo?* Por favor, edita tu mensaje o vuelve a enviar el reporte corregido.`;
        } else if (resultado.razon === "EXCESO_VERIFICADORES") {
          mensajeRespuesta =
            `⚠️ *Reporte Rechazado: Límite de verificadores superado*\n\n` +
            `Hola *${remitente}*, el reporte para el nodo *${reporte.nodo}* de *${resultado.municipioOficial}* supera el cupo máximo de personal permitido para hoy.\n\n` +
            `• *Límite oficial permitido:* \`${resultado.limiteVerificadores}\` verificadores.\n` +
            `• *Total acumulado proyectado:* \`${resultado.totalFinal}\` (Suma de hoy: B1: \`${resultado.b1Final}\` | B2: \`${resultado.b2Final}\` | B3: \`${resultado.b3Final}\`)\n\n` +
            `👉 *¿Cómo solucionarlo?* Por favor, edita tu mensaje o vuelve a enviar el reporte corregido con la cantidad de personal ajustada.`;
        }

        if (mensajeRespuesta) {
          try {
            await ctx.reply(mensajeRespuesta, {
              parse_mode: "Markdown",
              reply_parameters: { message_id: messageId },
            });
          } catch (err) {
            console.error("[ERROR] No se pudo enviar el mensaje de rechazo:", err.message);
          }
        }
        return;
      }

      // Si todo es válido, reaccionar con aprobación
      await reaccionar(ctx, "👍");
    } catch (error) {
      console.error("[ERROR] Falló la persistencia en Google Sheets:", error);
      throw error; // Propagado al bot.catch() global
    }
  });
}
