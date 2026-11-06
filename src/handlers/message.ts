import { Bot, Context } from "grammy";
import { config } from "../config/index.js";
import { parsearReporte, convertirTimestamp, obtenerBloqueYHoraActivo } from "../utils/parser.js";
import { obtenerNombreRemitente, reaccionar } from "../utils/telegram.js";
import { registrarComandos } from "./commands.js";
import {
  eliminarReporte,
  marcarFilaParaRevision,
  procesarYGuardarReporte,
} from "../services/reportProcessor.js";

const REGEX_ELIMINAR = /\b(?:eliminar|borrar|eliminado|borrado)\b/i;

async function manejarEliminacion(ctx: Context, messageId: number): Promise<void> {
  console.log(`[INFO] Solicitud de eliminación detectada — Mensaje ID: ${messageId}`);
  try {
    const reseteado = await eliminarReporte(messageId);

    if (reseteado) {
      console.log(`[INFO] Fila reseteada a cero en Google Sheets (Mensaje ID: ${messageId}).`);
    } else {
      console.warn(`[ADVERTENCIA] No se encontró fila con Mensaje ID: ${messageId} para resetear.`);
    }

    try {
      await ctx.deleteMessage();
      console.log(`[INFO] Mensaje de Telegram ID ${messageId} eliminado exitosamente.`);
    } catch (err: any) {
      console.warn(`[ADVERTENCIA] No se pudo borrar el mensaje de Telegram ID ${messageId}: ${err.message}`);
    }
  } catch (error: any) {
    console.error("[ERROR] No se pudo procesar la eliminación:", error?.message ?? error);
    try {
      await ctx.reply(
        "⚠️ No se pudo completar la eliminación en la hoja de cálculo por un error temporal de conexión. Por favor intenta nuevamente.",
        { reply_parameters: { message_id: messageId } }
      );
    } catch (_) {}
  }
}

export function registrarHandlers(bot: Bot): void {
  registrarComandos(bot);

  bot.on(["message:text", "edited_message:text"], async (ctx) => {
    const mensajeObj = ctx.message || ctx.editedMessage;
    if (!mensajeObj || !ctx.chat) return;

    const texto      = mensajeObj.text || "";
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

    const creationTimestamp = mensajeObj.date || Math.floor(Date.now() / 1000);
    const editTimestamp = (mensajeObj as any).edit_date || null;
    let timestampEfectivo = creationTimestamp;

    if (esEdicion && editTimestamp) {
      // Si la edición se realizó cuando el bloque ya está cerrado (después de 18:00),
      // forzar timestampEfectivo a la hora de edición para que no use la holgura del pasado.
      const infoEdicion = obtenerBloqueYHoraActivo(editTimestamp);
      if (infoEdicion.bloqueActivo === 0) {
        timestampEfectivo = editTimestamp;
      } else {
        const diffMins = (editTimestamp - creationTimestamp) / 60;
        const holgura = config.app.reportEditGracePeriodMins;
        if (diffMins > holgura) {
          timestampEfectivo = editTimestamp;
        }
      }
    }

    const { minutosDelDia, horaStr, bloqueActivo } = obtenerBloqueYHoraActivo(timestampEfectivo);

    // Verificar también la hora real de recepción del mensaje
    const nowTimestamp = Math.floor(Date.now() / 1000);
    const infoAhora = obtenerBloqueYHoraActivo(nowTimestamp);

    const fueraDeJornada = bloqueActivo === 0 || infoAhora.bloqueActivo === 0;

    const esComandoEliminar = REGEX_ELIMINAR.test(texto);
    const esReporte = texto.toLowerCase().includes(config.app.reportKeyword.toLowerCase()) ||
      (/(?:Municipio|municipio)\*?\s*:/i.test(texto) && /(?:Nodo|nodo)\*?\s*:/i.test(texto));

    if (fueraDeJornada) {
      if (esReporte || esComandoEliminar) {
        console.log(`[INFO] Reporte o acción recibida fuera de jornada laboral (${horaStr} VET). Rechazando con alerta.`);
        await reaccionar(ctx, "👎");
        const tipoAccion = esEdicion ? "Edición rechazada" : "Reporte rechazado";
        const startTotalMin = (config.app.workStartHour ?? 6) * 60 + (config.app.workStartMinute ?? 0);
        let detalleHorario = "";
        if (infoAhora.minutosDelDia < startTotalMin) {
          detalleHorario = `La recepción de reportes de hoy inicia a las 06:00 AM VET. Por favor, envía tu reporte a partir de las 06:00 AM.`;
        } else {
          detalleHorario = `La jornada laboral de hoy finalizó a las 06:00 PM VET. El corte de las 6:00 pm ya fue consolidado y enviado a Gerencia. No se admiten nuevos reportes ni modificaciones hasta la siguiente jornada laboral (06:00 AM).`;
        }

        const mensajeFuera =
          `⚠️ *${tipoAccion}: Fuera de jornada laboral*\n\n` +
          `Hola *${remitente}*, ${detalleHorario}\n\n` +
          `• *Horario de recepción:* 06:00 AM – 06:00 PM VET.\n` +
          `• *Hora actual:* \`${infoAhora.horaStr}\` VET.`;

        try {
          await ctx.reply(mensajeFuera, {
            parse_mode: "Markdown",
            reply_parameters: { message_id: messageId }
          });
        } catch (err: any) {
          console.error("[ERROR] No se pudo enviar el mensaje de rechazo fuera de jornada:", err.message);
        }
      } else {
        console.log(`[INFO] Mensaje general recibido fuera de jornada laboral (${horaStr} VET). Ignorando silenciosamente.`);
      }
      return;
    }

    if (REGEX_ELIMINAR.test(texto)) {
      await manejarEliminacion(ctx, messageId);
      return;
    }

    if (!texto.toLowerCase().includes(config.app.reportKeyword.toLowerCase())) {
      if (esEdicion) {
        await marcarFilaParaRevision(null, messageId);
      }
      return;
    }

    const reporte = parsearReporte(texto);
    if (!reporte) {
      console.warn("[ADVERTENCIA] Palabra clave encontrada pero no se pudo parsear el reporte.");
      if (esEdicion) {
        await marcarFilaParaRevision(null, messageId);
      }
      await reaccionar(ctx, "👎");

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
        } catch (err: any) {
          console.error("[ERROR] No se pudo enviar el mensaje de alerta de formato:", err.message);
        }
      }
      return;
    }

    const tiempo = convertirTimestamp(mensajeObj.date);
    console.log("[INFO] Reporte parseado:", { ...reporte, ...tiempo, remitente });

    try {
      const creationTimestamp = mensajeObj.date || Math.floor(Date.now() / 1000);
      const editTimestamp = (mensajeObj as any).edit_date || null;

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

        let mensajeRespuesta = "";

        if (resultado.razon === "FUERA_DE_HORARIO") {
          mensajeRespuesta =
            `⚠️ *Reporte Rechazado: Fuera de jornada laboral*\n\n` +
            `Hola *${remitente}*, la jornada laboral de hoy ha finalizado (horario de atención: 06:00 AM a 06:00 PM VET).\n\n` +
            `• *Hora registrada:* \`${horaStr}\` VET\n\n` +
            `👉 El corte de las 6:00 pm ya fue consolidado y enviado a Gerencia. No se aceptan más reportes por hoy.`;
        } else if (resultado.razon === "MUNICIPIO_INCORRECTO") {
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
        } else if (resultado.razon === "ERROR_CONEXION_SHEETS") {
          mensajeRespuesta =
            `⚠️ *Aviso de servicio: Conexión temporalmente no disponible*\n\n` +
            `Hola *${remitente}*, no pudimos registrar tu reporte en este momento debido a una indisponibilidad temporal en los servidores de Google Sheets (Error 503).\n\n` +
            `👉 *¿Cómo solucionarlo?* Por favor, espera 1 o 2 minutos y reenvía tu reporte.`;
        }

        if (mensajeRespuesta) {
          try {
            await ctx.reply(mensajeRespuesta, {
              parse_mode: "Markdown",
              reply_parameters: { message_id: messageId },
            });
          } catch (err: any) {
            console.error("[ERROR] No se pudo enviar el mensaje de rechazo:", err.message);
          }
        }
        return;
      }

      // El reporte fue aceptado exitosamente
      await reaccionar(ctx, "👍");

      // Si se aplicó degradación graciosa (guardado en BD, pero Sheets no respondió tras reintentos):
      if (resultado.sincronizadoSheets === false) {
        console.warn(`[ADVERTENCIA] Reporte guardado en Base de Datos pero sincronización en Sheets diferida por 503 (Mensaje ID: ${messageId}).`);
        try {
          await ctx.reply(
            `ℹ️ *Reporte resguardado en base de datos*\n\n` +
            `Hola *${remitente}*, tu reporte fue registrado exitosamente en el sistema central. La sincronización visual en Google Sheets se reflejará en breve debido a demoras temporales del servicio de Google.`,
            {
              parse_mode: "Markdown",
              reply_parameters: { message_id: messageId },
            }
          );
        } catch (warnErr: any) {
          console.warn("[ADVERTENCIA] No se pudo enviar el aviso informativo de sincronización diferida:", warnErr.message);
        }
      }
    } catch (error: any) {
      console.error("[ERROR] Error procesando reporte en message handler:", error?.message ?? error);
      try {
        await reaccionar(ctx, "👎");
      } catch (_) {}

      try {
        await ctx.reply(
          `⚠️ *Aviso de servicio*\n\n` +
          `Hola *${remitente}*, ocurrió un inconveniente técnico temporal al procesar tu reporte. Por favor, reenvía tu mensaje en unos instantes.`,
          {
            parse_mode: "Markdown",
            reply_parameters: { message_id: messageId },
          }
        );
      } catch (replyErr: any) {
        console.error("[ERROR] No se pudo enviar mensaje de error al usuario:", replyErr.message);
      }
      // NUNCA ejecutar "throw error" para evitar que el fallo escale a bot.catch
    }
  });
}
