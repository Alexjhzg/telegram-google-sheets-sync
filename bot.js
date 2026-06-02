"use strict";

// ── Punto de entrada ────────────────────────────────────────────
// Carga la configuración primero (valida y falla rápido si falta algo)
import { config } from "./src/config/index.js";

import http                           from "node:http";
import { Bot }                      from "grammy";
import { registrarHandlers }        from "./src/handlers/message.js";
import { programarLimpieza }        from "./src/jobs/cleanup.js";
import { obtenerHojaDeCalculo,
         inicializarHojaConNodos,
         resetearFilasDeDiasAnteriores,
         ordenarYLimpiarHojaPrincipal }  from "./src/services/sheets.js";

// ── Instanciar el bot ───────────────────────────────────────────
const bot = new Bot(config.telegram.token);

// ── Registrar handlers de mensajes ─────────────────────────────
registrarHandlers(bot);

// ── Manejador global de errores ─────────────────────────────────
bot.catch((err) => {
  const updateId = err.ctx?.update?.update_id ?? "desconocida";
  console.error(`[ERROR GLOBAL] Error en actualización ${updateId}:`, err.error);
});

// ── Servidor HTTP para Render (Evita fallos de despliegue y permite pings de vida) ──
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[INFO] Servidor HTTP escuchando en el puerto ${PORT} (Requerido para despliegues en Render Web Services).`);
});

// ── Arrancar el bot ─────────────────────────────────────────────
console.log("[INFO] Iniciando bot de supervisión de campo...");
bot.start({
  onStart: async (info) => {
    console.log(`[INFO] Bot @${info.username} en línea y escuchando mensajes.`);

    // Inicializar hoja con filas fijas de nodos, limpiar registros de días anteriores y reordenar/sanear la hoja
    try {
      const doc = await obtenerHojaDeCalculo();
      await inicializarHojaConNodos(doc);
      await resetearFilasDeDiasAnteriores(doc);
      await ordenarYLimpiarHojaPrincipal(doc);
    } catch (err) {
      console.error("[ERROR] Fallo al inicializar, limpiar y ordenar la hoja de cálculo:", err);
    }

    // Iniciar tareas en segundo plano (acceso a la API de Telegram vía bot.api)
    programarLimpieza(bot.api);
  },
});

