"use strict";

/**
 * Comandos administrativos del bot.
 * Responsabilidad única: responder a comandos Telegram (/reportes, /lista, etc.)
 */

import { config } from "../config/index.js";
import { obtenerNombreRemitente } from "../utils/telegram.js";
import { obtenerHojaDeCalculo, COLUMNAS } from "../services/sheets.js";
import { generarReporteRealTime } from "../services/reporting.js";

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
}
