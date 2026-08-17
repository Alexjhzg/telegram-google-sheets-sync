import { config } from "./src/config/index.js";
import http from "node:http";
import { Bot } from "grammy";
import { registrarHandlers } from "./src/handlers/message.js";
import { programarLimpieza } from "./src/jobs/cleanup.js";
import {
  obtenerHojaDeCalculo,
  resetearFilasDeDiasAnteriores
} from "./src/services/sheets.js";
import {
  inicializarHojaConNodos,
  ordenarYLimpiarHojaPrincipal
} from "./src/services/sheets.business.js";
import { sincronizarCatalogoDesdeSheets } from "./src/services/catalogService.js";

const bot = new Bot(config.telegram.token);

registrarHandlers(bot);

bot.catch((err) => {
  const updateId = err.ctx?.update?.update_id ?? "desconocida";
  console.error(`[ERROR GLOBAL] Error en actualización ${updateId}:`, err.error);
});

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      uptime: Math.round(process.uptime()),
      message: "Bot de supervisión en campo activo y escuchando."
    }));
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
});

server.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`[INFO] Servidor HTTP escuchando en el puerto ${PORT} (Requerido para despliegues en Render Web Services).`);
});

console.log("[INFO] Iniciando bot de supervisión de campo...");
bot.start({
  onStart: async (info) => {
    console.log(`[INFO] Bot @${info.username} en línea y escuchando mensajes.`);

    try {
      const doc = await obtenerHojaDeCalculo();
      await inicializarHojaConNodos(doc);
      await resetearFilasDeDiasAnteriores(doc);
      await ordenarYLimpiarHojaPrincipal(doc);

      await sincronizarCatalogoDesdeSheets();
    } catch (err) {
      console.error("[ERROR] Fallo al inicializar, limpiar y ordenar la hoja de cálculo o sincronizar catálogo:", err);
    }

    programarLimpieza(bot.api);
  },
});
