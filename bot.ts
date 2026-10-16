import { config, validarConfigBot } from "./src/config/index.js";
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

// Manejadores globales para evitar caídas inesperadas del proceso
process.on("unhandledRejection", (reason) => {
  console.error("[ERROR NO CONTROLADO - PROMISE REJECTION]", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[ERROR NO CONTROLADO - EXCEPTION]", error);
});

validarConfigBot();
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

server.on("error", (err) => {
  console.error("[ERROR HTTP SERVER]", err);
});

server.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`[INFO] Servidor HTTP escuchando en el puerto ${PORT} (Requerido para despliegues en Render Web Services).`);
});

// Apagado limpio y coordinado (SIGTERM y SIGINT) para Render
let isShuttingDown = false;
async function detenerServicio(origen: string, codigoSalida: number = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[INFO] Señal de apagado recibida (${origen}). Cerrando bot y servidor HTTP de forma limpia...`);

  try {
    server.close(() => {
      console.log("[INFO] Servidor HTTP de salud cerrado.");
    });

    if (bot.isInited()) {
      await bot.stop();
      console.log("[INFO] Conexión de polling con Telegram cerrada correctamente.");
    }
  } catch (err) {
    console.error("[ERROR] Error durante el cierre de servicios:", err);
  } finally {
    console.log(`[INFO] Proceso finalizado limpiamente con código ${codigoSalida}.`);
    process.exit(codigoSalida);
  }
}

process.once("SIGINT", () => detenerServicio("SIGINT", 0));
process.once("SIGTERM", () => detenerServicio("SIGTERM", 0));

let inicializacionEjecutada = false;

async function iniciarBot(): Promise<void> {
  console.log("[INFO] Iniciando bot de supervisión de campo...");
  try {
    await bot.start({
      drop_pending_updates: false,
      onStart: async (info) => {
        console.log(`[INFO] Bot @${info.username} en línea y escuchando mensajes.`);

        if (!inicializacionEjecutada) {
          try {
            const doc = await obtenerHojaDeCalculo();
            await inicializarHojaConNodos(doc);
            await resetearFilasDeDiasAnteriores(doc);
            await ordenarYLimpiarHojaPrincipal(doc);
            await sincronizarCatalogoDesdeSheets();
          } catch (err) {
            console.error("[ERROR] Fallo al inicializar, limpiar y ordenar la hoja de cálculo o sincronizar catálogo:", err);
          }

          try {
            programarLimpieza(bot.api);
          } catch (err) {
            console.error("[ERROR] Fallo al programar tareas de limpieza:", err);
          }
          inicializacionEjecutada = true;
        }
      },
    });
  } catch (err: any) {
    console.error("[ERROR POLLING] Error en el ciclo de polling de Telegram:", err);
    if (isShuttingDown) return;

    // Si es un error 409 (Conflicto por otra instancia durante despliegue o reinicio en Render)
    const esConflicto409 =
      err?.error_code === 409 ||
      String(err?.message || "").includes("409") ||
      String(err?.message || "").includes("Conflict");

    const delayMs = esConflicto409 ? 10000 : 5000;
    if (esConflicto409) {
      console.warn(`[CONFLICTO 409] Hay otra instancia activa o la sesión previa de Telegram aún no se cerró. Reintentando en ${delayMs / 1000}s...`);
    } else {
      console.warn(`[RETRY] Reintentando conexión con Telegram en ${delayMs / 1000}s...`);
    }

    setTimeout(() => {
      if (!isShuttingDown) {
        iniciarBot();
      }
    }, delayMs);
  }
}

iniciarBot();
