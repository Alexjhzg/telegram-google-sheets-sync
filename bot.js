"use strict";

// ── Punto de entrada ────────────────────────────────────────────
// Carga la configuración primero (valida y falla rápido si falta algo)
import { config } from "./src/config/index.js";

import { Bot }                      from "grammy";
import { registrarHandlers }        from "./src/handlers/message.js";
import { programarLimpieza }        from "./src/jobs/cleanup.js";
import { obtenerHojaDeCalculo,
         inicializarHojaConNodos,
         resetearFilasDeDiasAnteriores }  from "./src/services/sheets.js";

// ── Instanciar el bot ───────────────────────────────────────────
const bot = new Bot(config.telegram.token);

// ── Registrar handlers de mensajes ─────────────────────────────
registrarHandlers(bot);

// ── Manejador global de errores ─────────────────────────────────
bot.catch((err) => {
  const updateId = err.ctx?.update?.update_id ?? "desconocida";
  console.error(`[ERROR GLOBAL] Error en actualización ${updateId}:`, err.error);
});

// ── Arrancar el bot ─────────────────────────────────────────────
console.log("[INFO] Iniciando bot de supervisión de campo...");
bot.start({
  onStart: async (info) => {
    console.log(`[INFO] Bot @${info.username} en línea y escuchando mensajes.`);

    // Inicializar hoja con filas fijas de nodos y limpiar registros de días anteriores
    try {
      const doc = await obtenerHojaDeCalculo();
      await inicializarHojaConNodos(doc);
      await resetearFilasDeDiasAnteriores(doc);
    } catch (err) {
      console.error("[ERROR] Fallo al inicializar y limpiar la hoja de cálculo:", err);
    }

    // Iniciar tareas en segundo plano (acceso a la API de Telegram vía bot.api)
    programarLimpieza(bot.api);
  },
});
