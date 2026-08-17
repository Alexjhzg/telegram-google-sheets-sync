import "dotenv/config";

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

export const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN!,
    managerChatId: process.env.TELEGRAM_MANAGER_CHAT_ID || null,
    managerChatIds: process.env.TELEGRAM_MANAGER_CHAT_ID
      ? process.env.TELEGRAM_MANAGER_CHAT_ID.split(",").map((id) => id.trim()).filter(Boolean)
      : [],
  },

  google: {
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID!,
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  },

  db: {
    url: process.env.DATABASE_URL || process.env.DB_URL || process.env.SUPABASE_URL || null,
    key: process.env.DATABASE_KEY || process.env.DB_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || null,
    enabled: !!(
      (process.env.DATABASE_URL || process.env.DB_URL || process.env.SUPABASE_URL) &&
      (process.env.DATABASE_KEY || process.env.DB_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
    ),
  },

  app: {
    timezone: "America/Caracas",
    reportKeyword: "Formato de reporte",
    cutoffHours: [9, 14, 18],
    reportEditGracePeriodMins: parseInt(process.env.REPORT_EDIT_GRACE_PERIOD_MINS || "10", 10) || 10,
    cleanupIntervalMs: 5 * 60 * 1000,
    cleanupInitialDelayMs: 10_000,
    cleanupRequestDelayMs: 500,
    workStartHour: 7,
    workEndHour: 18,
    workEndMinute: 30,
  },
};
