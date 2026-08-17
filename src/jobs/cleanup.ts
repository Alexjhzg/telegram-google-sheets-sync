import { Cron } from "croner";
import { Api } from "grammy";
import { config } from "../config/index.js";
import {
  obtenerHojaDeCalculo,
  COLUMNAS,
  resetearFila,
  resetearFilasDeDiasAnteriores,
  guardarHistoricoDiario,
  sheetsMutex,
} from "../services/sheets.js";
import { ordenarYLimpiarHojaPrincipal } from "../services/sheets.business.js";
import { enviarReporteDiario } from "../services/reporting.js";
import { enviarAvisoCierre, enviarAvisoNodosFaltantes } from "../services/notifications.js";
import { sincronizarCatalogoDesdeSheets } from "../services/catalogService.js";

async function mensajeExiste(api: Api, chatId: number, messageId: number): Promise<boolean> {
  return true;
}

export function esHorarioLaboral(): boolean {
  const tz = config.app.timezone || "America/Caracas";
  const now = new Date();

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  let hour = 0;
  let minute = 0;
  for (const part of parts) {
    if (part.type === "hour") hour = parseInt(part.value, 10);
    if (part.type === "minute") minute = parseInt(part.value, 10);
  }
  if (hour === 24) hour = 0;

  const currentMinutes = hour * 60 + minute;
  const startMinutes = (config.app.workStartHour ?? 7) * 60;
  const endMinutes = (config.app.workEndHour ?? 18) * 60 + (config.app.workEndMinute ?? 30);

  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

export async function ejecutarLimpieza(api: Api, limiteFilas: number = 15, force: boolean = false): Promise<void> {
  if (!force && !esHorarioLaboral()) {
    console.log("[INFO] Limpieza periódica en pausa (fuera del horario laboral 07:00 - 18:30 VET).");
    return;
  }

  return sheetsMutex.runExclusive(async () => {
    console.log(`[INFO] Iniciando limpieza de mensajes eliminados en Telegram (límite: ${limiteFilas} filas)...`);
    try {
      const doc   = await obtenerHojaDeCalculo();
      const hoja  = doc.sheetsByTitle["registros_telegram"];
      if (!hoja) return;
      const filas = await hoja.getRows();

      let eliminados = 0;
      let analizados = 0;

      for (let i = filas.length - 1; i >= 0; i--) {
        const fila      = filas[i];
        const obj       = fila.toObject();
        const messageId = parseInt(obj[COLUMNAS.ID_MENSAJE], 10);
        const chatId    = parseInt(obj[COLUMNAS.ID_CHAT], 10);

        if (isNaN(messageId) || isNaN(chatId)) continue;

        analizados++;
        if (analizados > limiteFilas) {
          console.log(`[INFO] Se alcanzó el límite de seguridad de ${limiteFilas} filas analizadas. Finalizando escaneo.`);
          break;
        }

        const estado = obj[COLUMNAS.ESTADO] || "";
        let debeBorrarse = false;

        if (typeof estado === "string" && estado.startsWith("Revisión desde:")) {
          const timestampRevision = new Date(estado.replace("Revisión desde:", "").trim()).getTime();
          if (!isNaN(timestampRevision)) {
            const transcurridoMins = (Date.now() - timestampRevision) / 1000 / 60;
            if (transcurridoMins >= 5) {
              console.log(`[INFO] Fila en REVISIÓN superó el tiempo de gracia de 5 min (${Math.round(transcurridoMins)} min). Reseteando...`);
              debeBorrarse = true;
            }
          }
        }

        const existe = debeBorrarse ? false : await mensajeExiste(api, chatId, messageId);

        if (!existe) {
          if (!debeBorrarse) {
            console.log(`[INFO] Mensaje eliminado en Telegram (Chat: ${chatId}, ID: ${messageId}). Reseteando fila...`);
          }
          await resetearFila(fila);
          eliminados++;
        }

        await new Promise((r) => setTimeout(r, config.app.cleanupRequestDelayMs));
      }

      console.log(
        eliminados > 0
          ? `[INFO] Limpieza finalizada: ${eliminados} fila(s) reseteada(s).`
          : "[INFO] Limpieza finalizada: no se detectaron mensajes borrados."
      );
    } catch (error) {
      console.error("[ERROR] Falló la ejecución de la limpieza:", error);
    }
  });
}

export function programarLimpieza(api: Api): void {
  setTimeout(() => ejecutarLimpieza(api, 60, true), config.app.cleanupInitialDelayMs);

  new Cron("*/5 * * * *", { timezone: "America/Caracas" }, () => ejecutarLimpieza(api, 60));

  const jobCortes = new Cron("0 9,14,18 * * *", { timezone: "America/Caracas" }, () => ejecutarLimpieza(api, 60));

  new Cron("0 0 * * *", { timezone: "America/Caracas" }, async () => {
    await sheetsMutex.runExclusive(async () => {
      console.log("[INFO] Iniciando reseteo diario de medianoche...");
      try {
        const doc = await obtenerHojaDeCalculo();
        await resetearFilasDeDiasAnteriores(doc);
        await ordenarYLimpiarHojaPrincipal(doc);
      } catch (err) {
        console.error("[ERROR] Fallo en el reseteo diario de medianoche:", err);
      }
    });
  });

  const jobReporte9am = new Cron("5 9 * * *",  { timezone: "America/Caracas" }, () => enviarReporteDiario(api, 1));
  new Cron("5 14 * * *", { timezone: "America/Caracas" }, () => enviarReporteDiario(api, 2));
  new Cron("5 18 * * *", { timezone: "America/Caracas" }, () => enviarReporteDiario(api, 3));

  new Cron("0 9 * * *",  { timezone: "America/Caracas" }, () => enviarAvisoCierre(api, 1));
  new Cron("0 14 * * *", { timezone: "America/Caracas" }, () => enviarAvisoCierre(api, 2));
  new Cron("0 18 * * *", { timezone: "America/Caracas" }, () => enviarAvisoCierre(api, 3));

  new Cron("6 18 * * *", { timezone: "America/Caracas" }, () => enviarAvisoNodosFaltantes(api));

  const jobHistorico = new Cron("0 23 * * *", { timezone: "America/Caracas" }, async () => {
    await sheetsMutex.runExclusive(async () => {
      console.log("[INFO] Iniciando resguardo de historial diario a las 11:00 PM VET...");
      try {
        const doc = await obtenerHojaDeCalculo();
        await guardarHistoricoDiario(doc);
      } catch (err) {
        console.error("[ERROR] Fallo al guardar el historial diario:", err);
      }
    });
  });

  new Cron("*/15 * * * *", { timezone: "America/Caracas" }, async () => {
    if (esHorarioLaboral()) {
      await sincronizarCatalogoDesdeSheets();
    }
  });

  const fmtTime: Intl.DateTimeFormatOptions = { timeZone: "America/Caracas", hour: "2-digit", minute: "2-digit" };
  const fmtFull: Intl.DateTimeFormatOptions = { timeZone: "America/Caracas", weekday: "long", hour: "2-digit", minute: "2-digit" };

  const nextCortes = jobCortes.nextRun();
  if (nextCortes) {
    console.log(`[INFO] Limpieza horaria activa. Siguiente corte a las ${nextCortes.toLocaleTimeString("es-VE", fmtTime)} (VET).`);
  }
  const nextReporte = jobReporte9am.nextRun();
  if (nextReporte) {
    console.log(`[INFO] Reportes diarios a Gerencia activos (9:05am, 2:05pm, 6:05pm VET). Siguiente envío el ${nextReporte.toLocaleDateString("es-VE", fmtFull)} (VET).`);
  }
  const nextHist = jobHistorico.nextRun();
  if (nextHist) {
    console.log(`[INFO] Historial diario activo. Siguiente guardado el ${nextHist.toLocaleDateString("es-VE", fmtFull)} (VET).`);
  }
}
