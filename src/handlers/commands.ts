import { Bot, Context } from "grammy";
import { config } from "../config/index.js";
import { obtenerNombreRemitente, esUsuarioAdmin } from "../utils/telegram.js";
import { obtenerHojaDeCalculo, COLUMNAS } from "../services/sheets.js";
import { generarReporteRealTime } from "../services/reporting.js";
import { obtenerBloqueYHoraActivo } from "../utils/parser.js";
import { sincronizarCatalogoDesdeSheets } from "../services/catalogService.js";

/**
 * Registra todos los comandos administrativos del bot.
 */
export function registrarComandos(bot: Bot): void {
  bot.command("reporte", async (ctx: Context) => {
    try {
      const remitente = obtenerNombreRemitente(ctx);
      console.log(`[INFO] Comando /reporte (tiempo real) ejecutado por ${remitente} (Chat: ${ctx.chat?.id})`);

      const isAdmin = await esUsuarioAdmin(ctx);
      if (!isAdmin) {
        await ctx.reply("⛔ No tienes permisos autorizados para solicitar reportes.");
        return;
      }

      const doc = await obtenerHojaDeCalculo();
      const mensajes = await generarReporteRealTime(doc);

      const listaMensajes = Array.isArray(mensajes) ? mensajes : [mensajes];
      for (const msg of listaMensajes) {
        await ctx.reply(msg, { parse_mode: "Markdown" });
      }
    } catch (error) {
      console.error("[ERROR] Falló al ejecutar el comando /reporte:", error);
      await ctx.reply("❌ Ocurrió un error al generar el reporte.");
    }
  });

  bot.command("lista", async (ctx: Context) => {
    try {
      const remitente = obtenerNombreRemitente(ctx);
      console.log(`[INFO] Comando /lista (desglose) ejecutado por ${remitente} (Chat: ${ctx.chat?.id})`);

      const isAdmin = await esUsuarioAdmin(ctx);
      if (!isAdmin) return;

      const doc  = await obtenerHojaDeCalculo();
      const hoja = doc.sheetsByTitle["registros_telegram"];
      if (!hoja) return;
      const filas = await hoja.getRows();

      const opts: Intl.DateTimeFormatOptions = { timeZone: config.app.timezone, year: "numeric", month: "2-digit", day: "2-digit" };
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

  bot.command("estado", async (ctx: Context) => {
    try {
      const remitente = obtenerNombreRemitente(ctx);
      console.log(`[INFO] Comando /estado ejecutado por ${remitente} (Chat: ${ctx.chat?.id})`);

      const isAdmin = await esUsuarioAdmin(ctx);
      if (!isAdmin) return;

      let sheetsStatus = "✅ Conectado";
      let reporteCargaStr = "";
      try {
        const doc = await obtenerHojaDeCalculo();
        const hoja = doc.sheetsByTitle["registros_telegram"];
        if (hoja) {
          const filas = await hoja.getRows();
          const opts: Intl.DateTimeFormatOptions = { timeZone: config.app.timezone, year: "numeric", month: "2-digit", day: "2-digit" };
          const hoyStr = new Date().toLocaleDateString("es-VE", opts);
          const reportesHoy = filas.filter(
            (fila) => (fila.get(COLUMNAS.FECHA) || "").trim() === hoyStr
          );
          reporteCargaStr = `• *Nodos reportados hoy:* ${reportesHoy.length} / ${filas.length}\n`;
        }
      } catch (err: any) {
        sheetsStatus = `❌ Error: ${err.message}`;
      }

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

      const memory = `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`;

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

  const handlerSync = async (ctx: Context) => {
    try {
      const remitente = obtenerNombreRemitente(ctx);
      console.log(`[INFO] Comando de sincronización de catálogo ejecutado por ${remitente} (Chat: ${ctx.chat?.id})`);

      const isAdmin = await esUsuarioAdmin(ctx);
      if (!isAdmin) {
        await ctx.reply("⛔ No tienes permisos autorizados para sincronizar el catálogo.");
        return;
      }

      await ctx.reply("🔄 Sincronizando catálogo de nodos desde Google Sheets hacia la base de datos SQL...");
      const res = await sincronizarCatalogoDesdeSheets();

      if (res.exitoso) {
        await ctx.reply(`✅ *Catálogo sincronizado exitosamente*\n\nSe procesaron y actualizaron \`${res.sincronizados}\` nodos en la base de datos SQL.`, { parse_mode: "Markdown" });
      } else {
        await ctx.reply(`⚠️ *Fallo en la sincronización del catálogo*\n\nRazón: \`${res.error || res.razon || "Desconocida"}\``, { parse_mode: "Markdown" });
      }
    } catch (error) {
      console.error("[ERROR] Falló al ejecutar la sincronización manual del catálogo:", error);
      await ctx.reply("❌ Ocurrió un error inesperado al sincronizar el catálogo.");
    }
  };

  bot.command("actualizar", handlerSync);
}
