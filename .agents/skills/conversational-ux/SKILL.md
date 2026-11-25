---
name: conversational-ux
description: Rol de Conversational UX Developer para estandarizar mensajes Markdown, tablas monoespaciadas, reacciones y experiencia conversacional en Telegram dentro de bot-telegram-campo.
---

# 🎨 Skill: Conversational UX (`bot-telegram-campo`)

> **Contexto real del proyecto:** La interfaz de usuario de `bot-telegram-campo` es 100% conversacional en **Telegram** (mensajes Markdown, reacciones, tablas monoespaciadas y reportes gerenciales).

## Cuándo activar
Activa esta skill al diseñar o modificar textos de respuesta, alertas de rechazo, avisos de cierre, tablas de `/lista`, diagnósticos de `/estado` o reportes consolidados en:
- `src/handlers/message.ts`
- `src/handlers/commands.ts`
- `src/services/reporting.ts`
- `src/services/notifications.ts`

## Reglas de Diseño Conversacional
1. **Apego al Design System:** Respetar estrictamente la semántica de reacciones (`👍`/`👎`), emojis (`⚠️`, `❌`, `✅`, `ℹ️`, `🔴`, `🟢`, `📍`, `📉`, `📊`, `⛔`, `🔄`, `👉`) y plantillas definidas en [`docs/DESIGN_SYSTEM.md`](../../../docs/DESIGN_SYSTEM.md).
2. **Legibilidad móvil:** Usar párrafos breves, viñetas (`•`), valores numéricos en monoespaciado (`` `valor` ``) y ancho controlado en tablas ASCII (`/lista`).
3. **Contexto y acción:** En rechazos de reportes, responder siempre citando el mensaje original (`reply_parameters: { message_id }`) e incluir la causa concreta y cómo corregirlo.
4. **Seguridad de Markdown:** Verificar que ningún texto dinámico rompa `parse_mode: "Markdown"` en la API de Telegram y envolver `ctx.reply` en `try/catch` para evitar fallos de entrega.
5. **Si en el futuro se agrega un dashboard web:** Aplicar tokens CSS consistentes con la semántica de estados (`OK`, `Revisión`, `Faltante`, `Cerrado`) y documentarlos en `docs/DESIGN_SYSTEM.md`.

