"use strict";

/**
 * Comandos administrativos del bot.
 * Responsabilidad única: responder a comandos Telegram (/reportes, /lista, etc.)
 */

import { config } from "../config/index.js";
import { obtenerNombreRemitente, esUsuarioAdmin } from "../utils/telegram.js";
import { obtenerHojaDeCalculo, COLUMNAS } from "../services/sheets.js";
import { generarReporteRealTime } from "../services/reporting.js";
import { obtenerBloqueYHoraActivo } from "../utils/parser.js";

/**
 * Registra todos los comandos administrativos del bot.
 * @param {import("grammy").Bot} bot
 */
export function registrarComandos(bot) {
  // /reporte — Consulta el reporte consolidado del estado Monagas en tiempo real
  bot.command("reporte", async (ctx) => {
    try {
      const remitente = obtenerNombreRemitente(ctx);
      console.log(`[INFO] Comando /reporte (tiempo real) ejecutado por ${remitente} (Chat: ${ctx.chat.id})`);

      // Verificar privilegios de administrador/propietario
      const isAdmin = await esUsuarioAdmin(ctx);
      if (!isAdmin) return;

      const doc = await obtenerHojaDeCalculo();
      const mensaje = await generarReporteRealTime(doc);

      await ctx.reply(mensaje, { parse_mode: "Markdown" });
    } catch (error) {
      console.error("[ERROR] Falló al ejecutar el comando /reporte:", error);
      await ctx.reply("❌ Ocurrió un error al generar el reporte.");
    }
  });

  // /lista — Consulta el desglose nodo por nodo de los reportes del día actual
  bot.command("lista", async (ctx) => {
    try {
      const remitente = obtenerNombreRemitente(ctx);
      console.log(`[INFO] Comando /lista (desglose) ejecutado por ${remitente} (Chat: ${ctx.chat.id})`);

      // Verificar privilegios de administrador/propietario
      const isAdmin = await esUsuarioAdmin(ctx);
      if (!isAdmin) return;

      const doc  = await obtenerHojaDeCalculo();
      const hoja = doc.sheetsByTitle["registros_telegram"];
      const filas = await hoja.getRows();

      const opts   = { timeZone: config.app.timezone, year: "numeric", month: "2-digit", day: "2-digit" };
      const hoyStr = new Date().toLocaleDateString("es-VE", opts);

      const reportesHoy = filas.filter(
        (fila) => (fila.get(COLUMNAS.FECHA) || "").trim() === hoyStr
      );

      if (reportesHoy.length === 0) {
        await ctx.reply(
          `*Reportes registrados para hoy (${hoyStr}):*\n\nNo hay reportes registrados aún.`,
          { parse_mode: "Markdown" }
        );
        return;
      }

      let respuesta = `*Desglose de reportes de hoy (${hoyStr}):*\n\n`;
      respuesta += "```\n";
      respuesta += "Mun         |Nodo |9a|2p|6p|Tot\n";
      respuesta += "------------+-----+--+--+--+---\n";

      for (const fila of reportesHoy) {
        const mun   = (fila.get(COLUMNAS.MUNICIPIO) || "").trim();
        const nod   = (fila.get(COLUMNAS.NODO) || "").trim();
        const b1    = (fila.get(COLUMNAS.BLOQUE_1)            || "0").trim();
        const b2    = (fila.get(COLUMNAS.BLOQUE_2)            || "0").trim();
        const b3    = (fila.get(COLUMNAS.BLOQUE_3)            || "0").trim();
        const total = (fila.get(COLUMNAS.TOTAL_VERIFICADORES) || "0").trim();

        // Limitar municipio a 12 caracteres y rellenar
        const munPad   = mun.substring(0, 12).padEnd(12, " ");
        const nodPad   = nod.padEnd(5, " ");
        const b1Pad    = b1.padStart(2, " ");
        const b2Pad    = b2.padStart(2, " ");
        const b3Pad    = b3.padStart(2, " ");
        const totalPad = total.padStart(3, " ");

        respuesta += `${munPad}|${nodPad}|${b1Pad}|${b2Pad}|${b3Pad}|${totalPad}\n`;
      }
      respuesta += "```";

      await ctx.reply(respuesta, { parse_mode: "Markdown" });
    } catch (error) {
      console.error("[ERROR] Falló al ejecutar el comando /lista:", error);
      await ctx.reply("❌ Ocurrió un error al consultar el desglose de reportes en Google Sheets.");
    }
  });

  // /estado — Diagnóstico del sistema y estado de conexión
  bot.command("estado", async (ctx) => {
    try {
      const remitente = obtenerNombreRemitente(ctx);
      console.log(`[INFO] Comando /estado ejecutado por ${remitente} (Chat: ${ctx.chat.id})`);

      // Verificar privilegios de administrador/propietario
      const isAdmin = await esUsuarioAdmin(ctx);
      if (!isAdmin) return;

      // 1. Probar conexión a Google Sheets y cargar datos de hoy
      let sheetsStatus = "✅ Conectado";
      let reporteCargaStr = "";
      try {
        const doc = await obtenerHojaDeCalculo();
        const hoja = doc.sheetsByTitle["registros_telegram"];
        if (hoja) {
          const filas = await hoja.getRows();
          const opts = { timeZone: config.app.timezone, year: "numeric", month: "2-digit", day: "2-digit" };
          const hoyStr = new Date().toLocaleDateString("es-VE", opts);
          const reportesHoy = filas.filter(
            (fila) => (fila.get(COLUMNAS.FECHA) || "").trim() === hoyStr
          );
          reporteCargaStr = `• *Nodos reportados hoy:* ${reportesHoy.length} / ${filas.length}\n`;
        }
      } catch (err) {
        sheetsStatus = `❌ Error: ${err.message}`;
      }

      // 2. Calcular Uptime humano
      const uptimeSecs = process.uptime();
      const d = Math.floor(uptimeSecs / (3600 * 24));
      const h = Math.floor((uptimeSecs % (3600 * 24)) / 3600);
      const m = Math.floor((uptimeSecs % 3600) / 60);
      const s = Math.floor(uptimeSecs % 60);

      const uptimeParts = [];
      if (d > 0) uptimeParts.push(`${d}d`);
      if (h > 0) uptimeParts.push(`${h}h`);
      if (m > 0) uptimeParts.push(`${m}m`);
      uptimeParts.push(`${s}s`);
      const uptimeStr = uptimeParts.join(" ");

      // 3. Uso de Memoria heap
      const memory = `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`;

      // 4. Hora oficial Venezuela (VET)
      const dateVE = new Date();
      const formatter = new Intl.DateTimeFormat("es-VE", {
        timeZone: config.app.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        hour12: true,
      });
      const horaVET = formatter.format(dateVE);

      // 5. Estado de la jornada laboral (Abierto: 6:00 AM - 6:00 PM VET, es decir, 360 - 1080 min)
      const nowVE = Math.floor(Date.now() / 1000);
      const { minutosDelDia } = obtenerBloqueYHoraActivo(nowVE);
      const horarioLaboral = (minutosDelDia >= 360 && minutosDelDia <= 1080)
        ? "🟢 Abierto (Recibiendo reportes)"
        : "🔴 Cerrado (Bloqueo activo)";

      const mensaje =
        `*Estado del Sistema*\n\n` +
        `• *Google Sheets:* ${sheetsStatus}\n` +
        reporteCargaStr +
        `• *Horario Laboral:* ${horarioLaboral}\n` +
        `• *Uptime:* \`${uptimeStr}\`\n` +
        `• *Memoria:* \`${memory}\`\n` +
        `• *Hora Oficial VET:* \`${horaVET}\``;

      await ctx.reply(mensaje, { parse_mode: "Markdown" });
    } catch (error) {
      console.error("[ERROR] Falló al ejecutar el comando /estado:", error);
      await ctx.reply("❌ Ocurrió un error al diagnosticar el sistema.");
    }
  });
}
