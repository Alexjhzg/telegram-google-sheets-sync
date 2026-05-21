"use strict";

import "dotenv/config";

// ── Validación temprana de variables de entorno obligatorias ────
const REQUIRED_VARS = [
  "TELEGRAM_BOT_TOKEN",
  "GOOGLE_SPREADSHEET_ID",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
];

for (const key of REQUIRED_VARS) {
  if (!process.env[key]) {
    console.error(`[FATAL] La variable de entorno "${key}" no está definida. Abortando.`);
    process.exit(1);
  }
}

// ── Configuración exportada ─────────────────────────────────────
export const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
  },

  google: {
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    // El .env puede guardar la clave con literales \n — los normalizamos aquí
    privateKey: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  },

  app: {
    // Zona horaria de Venezuela
    timezone: "America/Caracas",
    // Palabra clave que identifica un mensaje de reporte en el chat
    reportKeyword: "Formato de reporte",
    // Horas de corte de reporte en hora local Venezuela (9am, 2pm, 6pm)
    cutoffHours: [9, 14, 18],
    // Tiempo de holgura en minutos para poder corregir un reporte en el mismo bloque
    reportEditGracePeriodMins: parseInt(process.env.REPORT_EDIT_GRACE_PERIOD_MINS, 10) || 60,
    // Intervalo de limpieza periódica en milisegundos (5 minutos)
    cleanupIntervalMs: 5 * 60 * 1000,
    // Retardo inicial antes de la primera limpieza al arrancar (segundos)
    cleanupInitialDelayMs: 10_000,
    // Retardo entre verificaciones individuales de mensajes en la limpieza (ms)
    cleanupRequestDelayMs: 100,
  },
};
