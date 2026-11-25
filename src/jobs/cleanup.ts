import { Cron } from "croner";
import { Api } from "grammy";
import { config } from "../config/index.js";
import { ejecutarConReintento } from "../utils/retry.js";
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
  const startMinutes = (config.app.workStartHour ?? 6) * 60 + (config.app.workStartMinute ?? 0);
  const endMinutes = (config.app.cleanupEndHour ?? 18) * 60 + (config.app.cleanupEndMinute ?? 30);

  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

export async function ejecutarLimpieza(
  api: Api,
  limiteFilas: number = 15,
  force: boolean = false
): Promise<void> {
  if (!force && !esHorarioLaboral()) {
    console.log("[INFO] Limpieza periódica en pausa (fuera del horario laboral de monitoreo).");
    return;
  }

  return sheetsMutex.runExclusive(async () => {
    console.log(
      `[INFO] Iniciando limpieza de mensajes eliminados en Telegram (límite: ${limiteFilas} filas)...`
    );
    try {
      const doc = await obtenerHojaDeCalculo();
      const hoja = doc.sheetsByTitle["registros_telegram"];
      if (!hoja) return;

      const filas = await ejecutarConReintento(() => hoja.getRows(), {
        contexto: "Lectura de filas en ejecutarLimpieza",
        maxIntentos: 3,
        retrasoBaseMs: 300,
      });

      let eliminados = 0;
      let analizados = 0;
      let fallosFila = 0;

      for (let i = filas.length - 1; i >= 0; i--) {
        const fila = filas[i];
        let messageId = 0;
        let chatId = 0;

        try {
          const obj = fila.toObject();
          messageId = parseInt(obj[COLUMNAS.ID_MENSAJE], 10);
          chatId = parseInt(obj[COLUMNAS.ID_CHAT], 10);

          if (isNaN(messageId) || isNaN(chatId)) continue;

          analizados++;
          if (analizados > limiteFilas) {
            console.log(
              `[INFO] Se alcanzó el límite de seguridad de ${limiteFilas} filas analizadas. Finalizando escaneo.`
            );
            break;
          }

          const estado = obj[COLUMNAS.ESTADO] || "";
          let debeBorrarse = false;

          if (typeof estado === "string" && estado.startsWith("Revisión desde:")) {
            const timestampRevision = new Date(
              estado.replace("Revisión desde:", "").trim()
            ).getTime();
            if (!isNaN(timestampRevision)) {
              const transcurridoMins = (Date.now() - timestampRevision) / 1000 / 60;
              if (transcurridoMins >= 5) {
                console.log(
                  `[INFO] Fila en REVISIÓN superó el tiempo de gracia de 5 min (${Math.round(transcurridoMins)} min). Reseteando...`
                );
                debeBorrarse = true;
              }
            }
          }

          const existe = debeBorrarse ? false : await mensajeExiste(api, chatId, messageId);

          if (!existe) {
            if (!debeBorrarse) {
              console.log(
                `[INFO] Mensaje eliminado en Telegram (Chat: ${chatId}, ID: ${messageId}). Reseteando fila...`
              );
            }

            // Reseteo de fila contenido con reintento por fila
            await ejecutarConReintento(() => resetearFila(fila), {
              contexto: `Reseteo fila mensaje ID ${messageId}`,
              maxIntentos: 3,
              retrasoBaseMs: 300,
            });
            eliminados++;
          }
        } catch (filaError: any) {
          fallosFila++;
          console.error(
            `[ERROR] Falló el procesamiento/reseteo de la fila (Mensaje ID: ${messageId || "desconocido"}):`,
            filaError?.message ?? filaError
          );
          // Contención de error a nivel de fila: continúa con la siguiente fila sin abortar el bucle
        }

        await new Promise((r) => setTimeout(r, config.app.cleanupRequestDelayMs));
      }

      console.log(
        eliminados > 0
          ? `[INFO] Limpieza finalizada: ${eliminados} fila(s) reseteada(s)${fallosFila > 0 ? `, ${fallosFila} fallo(s) contenido(s)` : ""}.`
          : `[INFO] Limpieza finalizada: no se detectaron mensajes borrados${fallosFila > 0 ? ` (${fallosFila} fallo(s) contenido(s))` : ""}.`
      );
    } catch (error: any) {
      console.error("[ERROR] Falló la ejecución general de la limpieza:", error?.message ?? error);
    }
  });
}

export function programarLimpieza(api: Api): void {
  setTimeout(() => ejecutarLimpieza(api, 60, true), config.app.cleanupInitialDelayMs);

  new Cron("*/5 * * * *", { timezone: "America/Caracas" }, () => ejecutarLimpieza(api, 60));

  const jobCortes = new Cron("0 9,14,18 * * *", { timezone: "America/Caracas" }, () =>
    ejecutarLimpieza(api, 60)
  );

  // Reseteo diario de medianoche con reintentos a nivel de job (3 intentos con espera de 15s)
  new Cron("0 0 * * *", { timezone: "America/Caracas" }, async () => {
    console.log("[INFO] Iniciando trabajo programado de reseteo diario de medianoche...");
    const maxIntentosJob = 3;
    const delayEntreIntentosMs = process.env.NODE_ENV === "test" ? 5 : 15000;

    for (let intento = 1; intento <= maxIntentosJob; intento++) {
      try {
        await sheetsMutex.runExclusive(async () => {
          console.log(
            `[INFO] Ejecutando reseteo diario de medianoche (intento ${intento}/${maxIntentosJob})...`
          );
          const doc = await obtenerHojaDeCalculo();
          await resetearFilasDeDiasAnteriores(doc);
          await ordenarYLimpiarHojaPrincipal(doc);
          console.log("[INFO] Reseteo diario de medianoche completado exitosamente.");
        });
        break; // Éxito: salir del bucle de reintento
      } catch (err: any) {
        console.error(
          `[ERROR] Intento ${intento}/${maxIntentosJob} del reseteo diario de medianoche falló:`,
          err?.message ?? err
        );
        if (intento < maxIntentosJob) {
          console.log(
            `[INFO] Reintentando reseteo diario de medianoche en ${delayEntreIntentosMs / 1000}s...`
          );
          await new Promise((r) => setTimeout(r, delayEntreIntentosMs));
        } else {
          console.error(
            "[FATAL] Se agotaron todos los reintentos para el reseteo diario de medianoche."
          );
        }
      }
    }
  });

  const jobReporte9am = new Cron("5 9 * * *", { timezone: "America/Caracas" }, () =>
    enviarReporteDiario(api, 1)
  );
  new Cron("5 14 * * *", { timezone: "America/Caracas" }, () => enviarReporteDiario(api, 2));
  new Cron("5 18 * * *", { timezone: "America/Caracas" }, () => enviarReporteDiario(api, 3));

  new Cron("0 9 * * *", { timezone: "America/Caracas" }, () => enviarAvisoCierre(api, 1));
  new Cron("0 14 * * *", { timezone: "America/Caracas" }, () => enviarAvisoCierre(api, 2));
  new Cron("0 18 * * *", { timezone: "America/Caracas" }, () => enviarAvisoCierre(api, 3));

  new Cron("6 18 * * *", { timezone: "America/Caracas" }, () => enviarAvisoNodosFaltantes(api));

  // Resguardo diario de historial (11:00 PM VET) con reintentos a nivel de job
  const jobHistorico = new Cron("0 23 * * *", { timezone: "America/Caracas" }, async () => {
    console.log(
      "[INFO] Iniciando trabajo programado de resguardo de historial diario (11:00 PM VET)..."
    );
    const maxIntentosJob = 3;
    const delayEntreIntentosMs = process.env.NODE_ENV === "test" ? 5 : 15000;

    for (let intento = 1; intento <= maxIntentosJob; intento++) {
      try {
        await sheetsMutex.runExclusive(async () => {
          console.log(
            `[INFO] Ejecutando resguardo de historial diario (intento ${intento}/${maxIntentosJob})...`
          );
          const doc = await obtenerHojaDeCalculo();
          await guardarHistoricoDiario(doc);
          console.log("[INFO] Resguardo de historial diario completado exitosamente.");
        });
        break; // Éxito: salir del bucle de reintento
      } catch (err: any) {
        console.error(
          `[ERROR] Intento ${intento}/${maxIntentosJob} del resguardo de historial diario falló:`,
          err?.message ?? err
        );
        if (intento < maxIntentosJob) {
          console.log(
            `[INFO] Reintentando resguardo de historial diario en ${delayEntreIntentosMs / 1000}s...`
          );
          await new Promise((r) => setTimeout(r, delayEntreIntentosMs));
        } else {
          console.error(
            "[FATAL] Se agotaron todos los reintentos para el resguardo de historial diario."
          );
        }
      }
    }
  });

  new Cron("*/15 * * * *", { timezone: "America/Caracas" }, async () => {
    if (esHorarioLaboral()) {
      await sincronizarCatalogoDesdeSheets();
    }
  });

  const fmtTime: Intl.DateTimeFormatOptions = {
    timeZone: "America/Caracas",
    hour: "2-digit",
    minute: "2-digit",
  };
  const fmtFull: Intl.DateTimeFormatOptions = {
    timeZone: "America/Caracas",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  };

  const nextCortes = jobCortes.nextRun();
  if (nextCortes) {
    console.log(
      `[INFO] Limpieza horaria activa. Siguiente corte a las ${nextCortes.toLocaleTimeString("es-VE", fmtTime)} (VET).`
    );
  }
  const nextReporte = jobReporte9am.nextRun();
  if (nextReporte) {
    console.log(
      `[INFO] Reportes diarios a Gerencia activos (9:05am, 2:05pm, 6:05pm VET). Siguiente envío el ${nextReporte.toLocaleDateString("es-VE", fmtFull)} (VET).`
    );
  }
  const nextHist = jobHistorico.nextRun();
  if (nextHist) {
    console.log(
      `[INFO] Historial diario activo. Siguiente guardado el ${nextHist.toLocaleDateString("es-VE", fmtFull)} (VET).`
    );
  }
}
