"use strict";

/**
 * Obtiene el nombre del remitente de forma legible de un mensaje de Telegram.
 *
 * Caso especial: cuando un admin publica de forma anónima en un grupo,
 * Telegram usa el bot "GroupAnonymousBot" (ID 1087968824) como remitente.
 * En ese caso intentamos usar la firma del autor (author_signature) o
 * el título del chat como identificador alternativo.
 *
 * @param {import("grammy").Context} ctx
 * @returns {string}
 */
export function obtenerNombreRemitente(ctx) {
  const from = ctx.from;

  // Admin anónimo de grupo (GroupAnonymousBot)
  if (from?.id === 1087968824) {
    const mensajeObj = ctx.message || ctx.editedMessage;
    // author_signature: nombre que pone el admin cuando publica anónimamente
    if (mensajeObj?.author_signature) return mensajeObj.author_signature;
    // Fallback: título del grupo con etiqueta
    const titulo = ctx.chat?.title;
    return titulo ? `Admin de ${titulo}` : "Admin Anónimo";
  }

  return (
    [from?.first_name, from?.last_name].filter(Boolean).join(" ") ||
    from?.username ||
    "Desconocido"
  );
}

/**
 * Intenta agregar una reacción al mensaje de forma segura, sin lanzar
 * error si el chat no admite reacciones.
 * @param {import("grammy").Context} ctx
 * @param {string} emoji
 */
export async function reaccionar(ctx, emoji) {
  const messageId = ctx.message?.message_id || ctx.editedMessage?.message_id;
  try {
    await ctx.react(emoji);
    console.log(`[INFO] Reacción con '${emoji}' añadida al mensaje ID: ${messageId}`);
  } catch (error) {
    console.warn(`[ADVERTENCIA] No se pudo reaccionar con '${emoji}' al mensaje ID ${messageId}: ${error.message}`);
  }
}

/**
 * Verifica si el usuario actual es administrador o el creador del chat.
 *
 * @param {import("grammy").Context} ctx
 * @returns {Promise<boolean>}
 */
export async function esUsuarioAdmin(ctx) {
  // En chats privados, restringimos por defecto a menos que se defina otra lógica
  if (ctx.chat?.type === "private") {
    return false;
  }

  // Si el usuario es el canal anónimo o "GroupAnonymousBot", es admin de forma implícita
  if (ctx.from?.id === 1087968824) {
    return true;
  }

  try {
    const chatMember = await ctx.getChatMember(ctx.from.id);
    return chatMember.status === "administrator" || chatMember.status === "creator";
  } catch (error) {
    console.error(`[ERROR] No se pudo verificar rango del usuario ${ctx.from?.id}:`, error.message);
    return false;
  }
}
