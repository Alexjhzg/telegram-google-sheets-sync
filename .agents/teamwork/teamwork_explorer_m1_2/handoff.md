# Handoff Report — Explorer M1-2: Consumer Services Resilience & Graceful Degradation Blueprint

**Date**: 2026-11-06T14:48:00Z  
**Author**: Explorer M1-2 (`teamwork_explorer_m1_2`)  
**Scope**: Exact implementation blueprints for `src/services/reportProcessor.ts`, `src/handlers/message.ts`, and `src/jobs/cleanup.ts` to resolve Google Sheets API 503 errors through mutex-safe retries, per-row error containment, graceful degradation, and safe error propagation.

---

## 1. Observation

Direct inspection of `src/services/reportProcessor.ts`, `src/handlers/message.ts`, `src/jobs/cleanup.ts`, `src/services/database.ts`, and `src/types/index.ts` revealed the following exact lines and behaviors:

### 1.1 `src/services/reportProcessor.ts`
1. **Unprotected Row Deletion (`eliminarReporte`, Lines 29–42)**:
   ```typescript
   export async function eliminarReporte(messageId: number | string): Promise<boolean> {
     return sheetsMutex.runExclusive(async () => {
       const doc  = await obtenerHojaDeCalculo();
       const hoja = doc.sheetsByTitle["registros_telegram"];
       if (!hoja) return false;
       const fila = buscarFilaPorMensaje(await hoja.getRows(), messageId);

       if (fila) {
         await resetearFila(fila);
         return true;
       }
       return false;
     });
   }
   ```
   *Finding*: If `resetearFila(fila)` or `hoja.getRows()` fails with an HTTP 503 `AxiosError`, `eliminarReporte` rejects with an unhandled exception that bubbles directly to `manejarEliminacion` in `src/handlers/message.ts:31`. No retry is executed.

2. **Row Flagging Swallowing Errors Without Retry (`_marcarFilaParaRevision`, Lines 47–66)**:
   ```typescript
   async function _marcarFilaParaRevision(doc: GoogleSpreadsheet | null, messageId: number | string): Promise<void> {
     try {
       ...
       if (fila) {
         const estadoActual = (fila.get(COLUMNAS.ESTADO) || "").toString();
         if (!estadoActual.startsWith("Revisión desde:")) {
           const ahoraIso = new Date().toISOString();
           fila.set(COLUMNAS.ESTADO, `Revisión desde: ${ahoraIso}`);
           await fila.save();
           console.log(`[INFO] Fila marcada para revisión (Mensaje ID: ${messageId}).`);
         }
       }
     } catch (error) {
       console.error("[ERROR] No se pudo marcar la fila para revisión:", error);
     }
   }
   ```
   *Finding*: If `fila.save()` fails with 503, the error is swallowed with `console.error` and never retried. The row is never tagged with `"Revisión desde: <timestamp>"`, leaving invalid edited messages unflagged for the 5-minute cleanup job.

3. **Sheets Persistence Inside Mutex Lacks Retry and Graceful Degradation (`procesarYGuardarReporte`, Lines 245–298)**:
   ```typescript
   if (esDBActiva()) {
     try {
       const reporteGuardado = await guardarOActualizarReporteDB(datosFinales);
       await registrarAuditoriaDB({ ... });
     } catch (errDb: any) {
       console.error("[ERROR] Falló guardado en Base de Datos:", errDb.message);
     }
   }

   const datosHoja = { ... };

   if (filaExistente) {
     filaExistente.assign(datosHoja);
     await filaExistente.save();
   } else {
     await hoja.addRow(datosHoja);
   }

   if (esDBActiva()) {
     await marcarReporteSincronizadoDB(nodo, fecha);
   }

   return {
     valido: true,
     municipioOficial,
     totalFinal,
     b1Final,
     b2Final,
     b3Final
   };
   ```
   *Finding*:
   - In `guardarOActualizarReporteDB` (`src/services/database.ts:143`), new records are saved with `sincronizado_sheets = false`.
   - If `filaExistente.save()` or `hoja.addRow(datosHoja)` throws 503:
     1. Zero retries are attempted.
     2. `marcarReporteSincronizadoDB(nodo, fecha)` is skipped.
     3. An unhandled `AxiosError` escapes `sheetsMutex.runExclusive`.
     4. Even though the report was safely persisted in PostgreSQL/Supabase DB (`sincronizado_sheets = false`), the function crashes and fails to communicate that the report is valid and safely buffered.

---

### 1.2 `src/handlers/message.ts`
1. **Re-throwing Unhandled 503 Errors to Global Error Handler (Lines 244–247)**:
   ```typescript
   } catch (error) {
     console.error("[ERROR] Falló la persistencia en Google Sheets:", error);
     throw error;
   }
   ```
   *Finding*: In Grammy, `throw error` inside a middleware/listener propagates directly to `bot.catch` (`bot.ts:30-33`), triggering `[ERROR GLOBAL] Error en actualización...`. The Telegram user receives NO message feedback (neither 👍 nor 👎), and the update pipeline terminates in error.

2. **Missing Rejection Reason for Sheets Outages (Lines 197–241)**:
   *Finding*: The handler checks only `FUERA_DE_HORARIO`, `MUNICIPIO_INCORRECTO`, `NODO_INCORRECTO`, and `EXCESO_VERIFICADORES`. It lacks handling for `razon === "ERROR_CONEXION_SHEETS"`.

3. **No Warning for Deferred Sync (Line 243)**:
   *Finding*: If a report is valid and persisted in DB but failed Sheets sync (`sincronizadoSheets === false`), the handler does not differentiate this state.

---

### 1.3 `src/jobs/cleanup.ts`
1. **Coarse Outer Try/Catch Aborting Batch on Row 503 (`ejecutarLimpieza`, Lines 56–113)**:
   ```typescript
   try {
     const doc   = await obtenerHojaDeCalculo();
     const hoja  = doc.sheetsByTitle["registros_telegram"];
     if (!hoja) return;
     const filas = await hoja.getRows();

     let eliminados = 0;
     let analizados = 0;

     for (let i = filas.length - 1; i >= 0; i--) {
       ...
       const existe = debeBorrarse ? false : await mensajeExiste(api, chatId, messageId);

       if (!existe) {
         ...
         await resetearFila(fila);
         eliminados++;
       }

       await new Promise((r) => setTimeout(r, config.app.cleanupRequestDelayMs));
     }
     ...
   } catch (error) {
     console.error("[ERROR] Falló la ejecución de la limpieza:", error);
   }
   ```
   *Finding*: There is NO `try/catch` or retry around `await resetearFila(fila)` inside the loop. If row $i$ encounters a 503 error, the exception immediately breaks out of the `for` loop to line 111. The cleanup cycle aborts immediately, skipping rows $i-1, i-2, \dots, 0$.

2. **Single-Attempt Daily Scheduled Jobs (Lines 124–135 & 147–157)**:
   ```typescript
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
   ```
   *Finding*: Both the Midnight Reset (`0 0 * * *`) and the Historical Resguardo (`0 23 * * *`) run only once per day. If Google Sheets API returns a transient 503 during that window, the catch block logs the error and the job terminates. No automated retry is scheduled, resulting in stale data or permanently missed daily archives.

---

## 2. Logic Chain

1. **Premise 1 (Transient Failure Characteristics)**: Google Sheets API encounters occasional transient HTTP 503 "The service is currently unavailable" errors during periods of high backend load or maintenance.
2. **Premise 2 (Mutex Lock Semantics)**: `sheetsMutex` (`src/utils/mutex.ts`) is a FIFO promise-chain lock. A function running inside `sheetsMutex.runExclusive` cannot re-acquire the lock without deadlocking. Retrying operations inside the lock is safe as long as:
   - The retry operation does not call `sheetsMutex.runExclusive`.
   - The retry backoff delays are short and bounded (e.g., 300–800ms) with jitter so lock hold time does not starve pending Telegram updates.
3. **Premise 3 (Dual-Persistence Semantics)**:
   - In `src/services/database.ts:143`, `guardarOActualizarReporteDB` stores records with `sincronizado_sheets = false`.
   - If DB persistence succeeds, the operational report data is durable in PostgreSQL/Supabase.
   - If Google Sheets persistence subsequently fails after retries, the report is NOT lost; it is simply pending Sheets synchronization.
   - Therefore, returning `{ valido: true, sincronizadoSheets: false, persistidoDB: true, ... }` without throwing an error allows the bot to acknowledge the report while preserving consistency.
4. **Premise 4 (Single Persistence Fallback)**:
   - When DB is disabled (`!config.db.enabled`), Google Sheets is the sole data store.
   - If Google Sheets fails after all retries, the report was NOT saved.
   - In this scenario, returning `{ valido: false, razon: "ERROR_CONEXION_SHEETS", sincronizadoSheets: false, persistidoDB: false }` allows the message handler to reject the update with a friendly 503 explanation rather than crashing.
5. **Premise 5 (Telegram Update Pipeline Resilience)**:
   - Re-throwing an exception in `message.ts` routes the error to `bot.catch`, terminating the update handler.
   - By eliminating `throw error` and catching all errors locally, the bot guarantees that every valid message gets feedback (👍) and every connection failure gets a clear explanation (👎 + message).
6. **Premise 6 (Row Containment in Batch Cleanup)**:
   - By wrapping row operations in `ejecutarLimpieza` with a per-row `try/catch` and `ejecutarConReintento`:
     - Transient 503s on row $i$ are retried immediately.
     - Persistent 503s on row $i$ are logged and contained, allowing the loop to proceed to rows $i-1, i-2, \dots, 0$.
7. **Premise 7 (Job-Level Retries for Scheduled Crons)**:
   - For once-daily crons (`0 0 * * *` and `0 23 * * *`), wrapping the job execution in an outer retry loop with 15–30s delays between attempts ensures transient midnight outages do not abort critical daily maintenance.
   - Placing `sheetsMutex.runExclusive` *inside* each attempt releases the mutex during the inter-attempt delay, preventing lock monopolization.

---

## 3. Caveats

1. **Lock Contention**: While retrying inside `sheetsMutex.runExclusive`, other pending Telegram reports must wait. To prevent lag spikes, `maxIntentos` inside the mutex must be limited to 3 with `delayInicialMs` set to 300–400ms (max cumulative delay $\approx 1.5$–$2.0$s).
2. **Re-entrancy Prohibition**: Neither `ejecutarConReintento` nor any helper called inside `reportProcessor.ts` or `cleanup.ts` should invoke `sheetsMutex.runExclusive`.
3. **Database Write Failure**: If `esDBActiva()` is true but `guardarOActualizarReporteDB` throws an error AND Google Sheets write also fails, both systems have failed. In this condition, the system must degrade to `{ valido: false, razon: "ERROR_CONEXION_SHEETS" }`.
4. **Telegram Error Handling**: User notification messages sent in error/degradation scenarios should use isolated `try/catch` blocks so that a secondary Telegram API error (e.g. user blocked bot, chat migrated) does not crash the handler.

---

## 4. Conclusion & Concrete Implementation Blueprints

Below are the exact, production-ready implementation blueprints for the three target files and the domain type definitions.

---

### 4.1 Interface Contract Update: `src/types/index.ts`

In `src/types/index.ts`, update `ResultadoProcesamiento` to explicitly declare `sincronizadoSheets` and `persistidoDB`:

```typescript
export interface ResultadoProcesamiento {
  valido: boolean;
  razon?: string;
  municipioOficial?: string;
  municipioParseado?: string;
  nodoParseado?: number;
  limiteVerificadores?: number;
  totalFinal?: number;
  b1Final?: number;
  b2Final?: number;
  b3Final?: number;
  sincronizadoSheets?: boolean;
  persistidoDB?: boolean;
}
```

---

### 4.2 Implementation Blueprint: `src/services/reportProcessor.ts`

```typescript
import { GoogleSpreadsheet } from "google-spreadsheet";
import { config } from "../config/index.js";
import { convertirTimestamp, obtenerBloqueYHoraActivo } from "../utils/parser.js";
import { validarMunicipioNodo } from "./validation.js";
import { calcularAcumulacion } from "../utils/accumulation.js";
import { ejecutarConReintento } from "../utils/retry.js";
import {
  obtenerHojaDeCalculo,
  asegurarColumnas,
  buscarFilaPorMensaje,
  buscarFilaPorNodo,
  resetearFila,
  COLUMNAS,
  sheetsMutex,
} from "./sheets.js";

import {
  esDBActiva,
  guardarOActualizarReporteDB,
  validarMunicipioNodoDB,
  registrarAuditoriaDB,
  marcarReporteSincronizadoDB,
} from "./database.js";

import { DatosReporteProcesar, ResultadoProcesamiento, ValidacionResultado } from "../types/index.js";

/**
 * Resetea en Google Sheets el registro correspondiente a un ID de mensaje.
 * Aplica reintentos automáticos y previene excepciones no controladas.
 */
export async function eliminarReporte(messageId: number | string): Promise<boolean> {
  return sheetsMutex.runExclusive(async () => {
    try {
      const doc  = await obtenerHojaDeCalculo();
      const hoja = doc.sheetsByTitle["registros_telegram"];
      if (!hoja) return false;

      const filas = await ejecutarConReintento(
        () => hoja.getRows(),
        { contexto: `Lectura de filas para eliminar (Mensaje ID: ${messageId})`, maxIntentos: 3, delayInicialMs: 300 }
      );
      const fila = buscarFilaPorMensaje(filas, messageId);

      if (fila) {
        await ejecutarConReintento(
          () => resetearFila(fila),
          { contexto: `Resetear fila (Mensaje ID: ${messageId})`, maxIntentos: 3, delayInicialMs: 300 }
        );
        return true;
      }
      return false;
    } catch (error: any) {
      console.error(`[ERROR] No se pudo eliminar/resetear el reporte en Google Sheets (Mensaje ID: ${messageId}):`, error?.message ?? error);
      return false;
    }
  });
}

/**
 * Lógica interna para marcar una fila en revisión sin adquirir el lock.
 * Aplica reintentos en fila.save() para tolerancia a 503.
 */
async function _marcarFilaParaRevision(doc: GoogleSpreadsheet | null, messageId: number | string): Promise<void> {
  try {
    const documento = doc || await obtenerHojaDeCalculo();
    const hoja = documento.sheetsByTitle["registros_telegram"];
    if (!hoja) return;
    const filas = await hoja.getRows();
    const fila = buscarFilaPorMensaje(filas, messageId);
    if (fila) {
      const estadoActual = (fila.get(COLUMNAS.ESTADO) || "").toString();
      if (!estadoActual.startsWith("Revisión desde:")) {
        const ahoraIso = new Date().toISOString();
        fila.set(COLUMNAS.ESTADO, `Revisión desde: ${ahoraIso}`);
        await ejecutarConReintento(
          () => fila.save(),
          { contexto: `Marcar fila para revisión (Mensaje ID: ${messageId})`, maxIntentos: 3, delayInicialMs: 300 }
        );
        console.log(`[INFO] Fila marcada para revisión (Mensaje ID: ${messageId}).`);
      }
    }
  } catch (error: any) {
    console.error("[ERROR] No se pudo marcar la fila para revisión:", error?.message ?? error);
  }
}

/**
 * Marca una fila en Google Sheets en estado de revisión si el reporte editado es inválido.
 */
export async function marcarFilaParaRevision(doc: GoogleSpreadsheet | null, messageId: number | string): Promise<void> {
  return sheetsMutex.runExclusive(async () => {
    await _marcarFilaParaRevision(doc, messageId);
  });
}

/**
 * Procesa la lógica de negocio de un reporte con tolerancia a fallos 503 en Google Sheets.
 */
export async function procesarYGuardarReporte({
  reporte,
  tiempo,
  remitente,
  messageId,
  chatId,
  creationTimestamp,
  editTimestamp,
  esEdicion,
}: DatosReporteProcesar): Promise<ResultadoProcesamiento> {
  try {
    const { municipio, nodo, totalVerificadores, bloque1, bloque2, bloque3 } = reporte;

    let timestamp = creationTimestamp;
    let tiempoFinal = tiempo;

    if (esEdicion && editTimestamp) {
      const diffMins = (editTimestamp - creationTimestamp) / 60;
      const holgura = config.app.reportEditGracePeriodMins;

      if (diffMins > holgura) {
        console.log(`[INFO] Reporte editado después de la holgura (${Math.round(diffMins)} min > ${holgura} min). Usando fecha de edición para el bloque.`);
        timestamp = editTimestamp;
        tiempoFinal = convertirTimestamp(timestamp);
      } else {
        console.log(`[INFO] Reporte editado dentro de la holgura (${Math.round(diffMins)} min <= ${holgura} min). Usando fecha de creación original.`);
      }
    }

    const { fecha, hora } = tiempoFinal;

    const { horaStr, bloqueActivo, bloqueStr } = obtenerBloqueYHoraActivo(timestamp);
    console.log(`[INFO] Mensaje procesado a las ${horaStr} (Hora VE). Bloque Activo: ${bloqueStr}.`);

    let doc: GoogleSpreadsheet;
    try {
      doc = await obtenerHojaDeCalculo();
    } catch (docErr: any) {
      console.error("[ERROR] Falló al obtener la hoja de cálculo:", docErr?.message ?? docErr);
      if (!esDBActiva()) {
        return {
          valido: false,
          razon: "ERROR_CONEXION_SHEETS",
          municipioOficial: municipio,
          municipioParseado: municipio,
          nodoParseado: nodo,
          sincronizadoSheets: false,
          persistidoDB: false,
        };
      }
      // Si la BD está activa, continuaremos intentando validar y guardar en BD
      doc = null as any;
    }

    if (bloqueActivo === 0) {
      console.warn(`[ADVERTENCIA] Reporte rechazado: hora ${horaStr} VET fuera de jornada laboral.`);
      if (esEdicion && doc) {
        await marcarFilaParaRevision(doc, messageId);
      }
      return {
        valido: false,
        razon: "FUERA_DE_HORARIO",
        municipioOficial: municipio,
        municipioParseado: municipio,
        nodoParseado: nodo,
      };
    }

    let validacion: ValidacionResultado;
    if (esDBActiva()) {
      try {
        validacion = await validarMunicipioNodoDB(municipio, nodo);
        if (!validacion.valido && doc) {
          const valSheets = await validarMunicipioNodo(doc, municipio, nodo);
          if (valSheets.valido) {
            validacion = valSheets;
          }
        }
      } catch (e: any) {
        console.warn("[ADVERTENCIA] Falló validación en Base de Datos, utilizando fallback a Google Sheets:", e.message);
        if (doc) {
          validacion = await validarMunicipioNodo(doc, municipio, nodo);
        } else {
          return {
            valido: false,
            razon: "ERROR_CONEXION_SHEETS",
            municipioOficial: municipio,
            municipioParseado: municipio,
            nodoParseado: nodo,
          };
        }
      }
    } else {
      if (!doc) {
        return {
          valido: false,
          razon: "ERROR_CONEXION_SHEETS",
          municipioOficial: municipio,
          municipioParseado: municipio,
          nodoParseado: nodo,
        };
      }
      validacion = await validarMunicipioNodo(doc, municipio, nodo);
    }

    const { valido, limiteVerificadores, municipioOficial, razon } = validacion;
    if (!valido) {
      if (esEdicion && doc) {
        await marcarFilaParaRevision(doc, messageId);
      }
      return {
        valido: false,
        razon,
        municipioOficial,
        municipioParseado: municipio,
        nodoParseado: nodo,
      };
    }

    return await sheetsMutex.runExclusive(async () => {
      // 1. Cargar hoja principal con reintentos
      const documentoActual = doc || await obtenerHojaDeCalculo();
      const hoja = documentoActual.sheetsByTitle["registros_telegram"];
      if (!hoja) throw new Error("No existe la hoja registros_telegram");

      await asegurarColumnas(hoja);

      const filas = await ejecutarConReintento(
        () => hoja.getRows(),
        { contexto: "Lectura de filas en registros_telegram", maxIntentos: 3, delayInicialMs: 300 }
      );
      const filaExistente = buscarFilaPorNodo(filas, municipioOficial, nodo);

      const fechaFila = filaExistente ? (filaExistente.get(COLUMNAS.FECHA) || "").trim() : "";
      const filaEsDeHoy = fechaFila === fecha;

      const historial = (filaExistente && filaEsDeHoy) ? {
        b1:    parseInt(filaExistente.get(COLUMNAS.BLOQUE_1)            || "0", 10),
        b2:    parseInt(filaExistente.get(COLUMNAS.BLOQUE_2)            || "0", 10),
        b3:    parseInt(filaExistente.get(COLUMNAS.BLOQUE_3)            || "0", 10),
        total: parseInt(filaExistente.get(COLUMNAS.TOTAL_VERIFICADORES) || "0", 10),
      } : { b1: 0, b2: 0, b3: 0, total: 0 };

      if (filaExistente && !filaEsDeHoy) {
        console.log(`[INFO] La fila fija del nodo ${nodo} tiene datos del día anterior (${fechaFila}). Historial reseteado a cero para hoy.`);
      }

      const { b1Final, b2Final, b3Final } = calcularAcumulacion(bloqueActivo, reporte, historial);
      const totalFinal = b1Final + b2Final + b3Final;

      if (totalFinal > limiteVerificadores) {
        if (esEdicion) {
          await _marcarFilaParaRevision(documentoActual, messageId);
        }
        return {
          valido: false,
          razon: "EXCESO_VERIFICADORES",
          municipioOficial,
          limiteVerificadores,
          totalFinal,
          b1Final,
          b2Final,
          b3Final,
        };
      }

      console.log(
        `\n┌── 📊 LOG DE DATOS & LÓGICA DE GUARDADO ────────────────┐` +
        `\n│ 📥 DATOS PARSEADOS DESDE EL MENSAJE:` +
        `\n│    • Municipio:          ${municipioOficial}` +
        `\n│    • Nodo:               ${nodo}` +
        `\n│    • Total Verif. Msg:   ${totalVerificadores}` +
        `\n│    • B1 (9am) Msg:       ${bloque1}` +
        `\n│    • B2 (2pm) Msg:       ${bloque2}` +
        `\n│    • B3 (6pm) Msg:       ${bloque3}` +
        `\n│` +
        `\n│ 🕒 ANÁLISIS DE TIEMPO & BLOQUES:` +
        `\n│    • Hora Recibido (VE): ${horaStr}` +
        `\n│    • Bloque Activo:      ${bloqueStr.toUpperCase()}` +
        `\n│    • Valor Reportado:    ${bloque1 || bloque2 || bloque3 || totalVerificadores || 0}` +
        `\n│` +
        `\n│ 📜 VALORES PREVIOS EN BASE DE DATOS (HISTORIAL):` +
        `\n│    • Prev B1 (9am):      ${historial.b1}` +
        `\n│    • Prev B2 (2pm):      ${historial.b2}` +
        `\n│    • Prev B3 (6pm):      ${historial.b3}` +
        `\n│    • Prev Total:         ${historial.total}` +
        `\n│` +
        `\n│ 💾 VALORES RESULTANTES A GUARDAR:` +
        `\n│    • Final B1 (9am):     ${b1Final}` +
        `\n│    • Final B2 (2pm):     ${b2Final}` +
        `\n│    • Final B3 (6pm):     ${b3Final}` +
        `\n│    • Final Total:        ${totalFinal}` +
        `\n└────────────────────────────────────────────────────────┘\n`
      );

      const datosFinales = {
        municipioOficial,
        nodo,
        fecha,
        hora,
        b1Final,
        b2Final,
        b3Final,
        totalFinal,
        remitente,
        messageId,
        chatId,
      };

      // 2. Persistencia en Base de Datos Relacional (si está activa)
      let persistidoDB = false;
      if (esDBActiva()) {
        try {
          const reporteGuardado = await guardarOActualizarReporteDB(datosFinales);
          await registrarAuditoriaDB({
            chatId,
            messageId,
            remitente,
            accion: esEdicion ? "EDICION" : "CREACION",
            detalles: datosFinales,
            reporteId:       reporteGuardado?.id            ?? null,
            catalogoNodoId:  reporteGuardado?.catalogo_nodo_id ?? null,
          });
          persistidoDB = true;
        } catch (errDb: any) {
          console.error("[ERROR] Falló guardado en Base de Datos:", errDb.message);
          persistidoDB = false;
        }
      }

      // 3. Persistencia en Google Sheets con reintentos protegidos
      const datosHoja = {
        [COLUMNAS.MUNICIPIO]:           municipioOficial,
        [COLUMNAS.NODO]:                nodo,
        [COLUMNAS.TOTAL_VERIFICADORES]: totalFinal,
        [COLUMNAS.BLOQUE_1]:            b1Final,
        [COLUMNAS.BLOQUE_2]:            b2Final,
        [COLUMNAS.BLOQUE_3]:            b3Final,
        [COLUMNAS.FECHA]:               fecha,
        [COLUMNAS.HORA]:                hora,
        [COLUMNAS.REMITENTE]:           remitente,
        [COLUMNAS.ID_MENSAJE]:          String(messageId),
        [COLUMNAS.ID_CHAT]:             String(chatId),
        [COLUMNAS.ESTADO]:              "OK",
      };

      let sincronizadoSheets = false;
      try {
        await ejecutarConReintento(
          async () => {
            if (filaExistente) {
              filaExistente.assign(datosHoja);
              await filaExistente.save();
              console.log(`[INFO] Fila fija actualizada en Google Sheets (Municipio: ${municipioOficial}, Nodo: ${nodo}, Mensaje ID: ${messageId}).`);
            } else {
              await hoja.addRow(datosHoja);
              console.log(`[INFO] Fila nueva creada en Google Sheets como fallback (Mensaje ID: ${messageId}).`);
            }
          },
          {
            contexto: `Escritura en Google Sheets (Nodo ${nodo})`,
            maxIntentos: 3,
            delayInicialMs: 400,
          }
        );
        sincronizadoSheets = true;

        if (esDBActiva() && persistidoDB) {
          await marcarReporteSincronizadoDB(nodo, fecha);
        }
      } catch (errorSheets: any) {
        console.error(`[ERROR] Persistencia en Google Sheets falló tras agotar reintentos (Nodo ${nodo}):`, errorSheets?.message ?? errorSheets);

        // Degradación graciosa si la BD relacional está activa y resguardó el reporte
        if (esDBActiva() && persistidoDB) {
          console.warn(`[DEGRADACIÓN GRACIOSA] Reporte de Nodo ${nodo} resguardado en Base de Datos (sincronizado_sheets = false). Continuando con éxito.`);
          return {
            valido: true,
            sincronizadoSheets: false,
            persistidoDB: true,
            municipioOficial,
            totalFinal,
            b1Final,
            b2Final,
            b3Final,
          };
        }

        // Si la BD no está activa o falló, Google Sheets era el único almacenamiento
        return {
          valido: false,
          sincronizadoSheets: false,
          persistidoDB: false,
          razon: "ERROR_CONEXION_SHEETS",
          municipioOficial,
          municipioParseado: municipio,
          nodoParseado: nodo,
        };
      }

      return {
        valido: true,
        sincronizadoSheets: true,
        persistidoDB: esDBActiva() ? persistidoDB : undefined,
        municipioOficial,
        totalFinal,
        b1Final,
        b2Final,
        b3Final,
      };
    });
  } catch (errorCritico: any) {
    console.error("[ERROR] Error crítico no controlado en procesarYGuardarReporte:", errorCritico?.message ?? errorCritico);
    return {
      valido: false,
      sincronizadoSheets: false,
      persistidoDB: false,
      razon: "ERROR_CONEXION_SHEETS",
    };
  }
}
```

---

### 4.3 Implementation Blueprint: `src/handlers/message.ts`

```typescript
import { Bot, Context } from "grammy";
import { config } from "../config/index.js";
import { parsearReporte, convertirTimestamp, obtenerBloqueYHoraActivo } from "../utils/parser.js";
import { obtenerNombreRemitente, reaccionar } from "../utils/telegram.js";
import { registrarComandos } from "./commands.js";
import {
  eliminarReporte,
  marcarFilaParaRevision,
  procesarYGuardarReporte,
} from "../services/reportProcessor.js";

const REGEX_ELIMINAR = /\b(?:eliminar|borrar|eliminado|borrado)\b/i;

async function manejarEliminacion(ctx: Context, messageId: number): Promise<void> {
  console.log(`[INFO] Solicitud de eliminación detectada — Mensaje ID: ${messageId}`);
  try {
    const reseteado = await eliminarReporte(messageId);

    if (reseteado) {
      console.log(`[INFO] Fila reseteada a cero en Google Sheets (Mensaje ID: ${messageId}).`);
    } else {
      console.warn(`[ADVERTENCIA] No se encontró fila con Mensaje ID: ${messageId} para resetear.`);
    }

    try {
      await ctx.deleteMessage();
      console.log(`[INFO] Mensaje de Telegram ID ${messageId} eliminado exitosamente.`);
    } catch (err: any) {
      console.warn(`[ADVERTENCIA] No se pudo borrar el mensaje de Telegram ID ${messageId}: ${err.message}`);
    }
  } catch (error: any) {
    console.error("[ERROR] No se pudo procesar la eliminación:", error?.message ?? error);
    try {
      await ctx.reply(
        "⚠️ No se pudo completar la eliminación en la hoja de cálculo por un error temporal de conexión. Por favor intenta nuevamente.",
        { reply_parameters: { message_id: messageId } }
      );
    } catch (_) {}
  }
}

export function registrarHandlers(bot: Bot): void {
  registrarComandos(bot);

  bot.on(["message:text", "edited_message:text"], async (ctx) => {
    const mensajeObj = ctx.message || ctx.editedMessage;
    if (!mensajeObj || !ctx.chat) return;

    const texto      = mensajeObj.text || "";
    const messageId  = mensajeObj.message_id;
    const esEdicion  = !!ctx.editedMessage;
    const remitente  = obtenerNombreRemitente(ctx);

    console.log(
      `\n=== ${esEdicion ? "MENSAJE EDITADO" : "NUEVO MENSAJE"} ===` +
      `\nDe: ${remitente} (@${ctx.from?.username ?? "sin_usuario"} | ID: ${ctx.from?.id})` +
      `\nChat: ${ctx.chat.id} | Mensaje ID: ${messageId}` +
      `\n${texto}` +
      `\n=============================\n`
    );

    const creationTimestamp = mensajeObj.date || Math.floor(Date.now() / 1000);
    const editTimestamp = (mensajeObj as any).edit_date || null;
    let timestampEfectivo = creationTimestamp;

    if (esEdicion && editTimestamp) {
      const infoEdicion = obtenerBloqueYHoraActivo(editTimestamp);
      if (infoEdicion.bloqueActivo === 0) {
        timestampEfectivo = editTimestamp;
      } else {
        const diffMins = (editTimestamp - creationTimestamp) / 60;
        const holgura = config.app.reportEditGracePeriodMins;
        if (diffMins > holgura) {
          timestampEfectivo = editTimestamp;
        }
      }
    }

    const { minutosDelDia, horaStr, bloqueActivo } = obtenerBloqueYHoraActivo(timestampEfectivo);

    const nowTimestamp = Math.floor(Date.now() / 1000);
    const infoAhora = obtenerBloqueYHoraActivo(nowTimestamp);

    const fueraDeJornada = bloqueActivo === 0 || infoAhora.bloqueActivo === 0;

    const esComandoEliminar = REGEX_ELIMINAR.test(texto);
    const esReporte = texto.toLowerCase().includes(config.app.reportKeyword.toLowerCase()) ||
      (/(?:Municipio|municipio)\*?\s*:/i.test(texto) && /(?:Nodo|nodo)\*?\s*:/i.test(texto));

    if (fueraDeJornada) {
      if (esReporte || esComandoEliminar) {
        console.log(`[INFO] Reporte o acción recibida fuera de jornada laboral (${horaStr} VET). Rechazando con alerta.`);
        await reaccionar(ctx, "👎");
        const tipoAccion = esEdicion ? "Edición rechazada" : "Reporte rechazado";
        const startTotalMin = (config.app.workStartHour ?? 6) * 60 + (config.app.workStartMinute ?? 0);
        let detalleHorario = "";
        if (infoAhora.minutosDelDia < startTotalMin) {
          detalleHorario = `La recepción de reportes de hoy inicia a las 06:00 AM VET. Por favor, envía tu reporte a partir de las 06:00 AM.`;
        } else {
          detalleHorario = `La jornada laboral de hoy finalizó a las 06:00 PM VET. El corte de las 6:00 pm ya fue consolidado y enviado a Gerencia. No se admiten nuevos reportes ni modificaciones hasta la siguiente jornada laboral (06:00 AM).`;
        }

        const mensajeFuera =
          `⚠️ *${tipoAccion}: Fuera de jornada laboral*\n\n` +
          `Hola *${remitente}*, ${detalleHorario}\n\n` +
          `• *Horario de recepción:* 06:00 AM – 06:00 PM VET.\n` +
          `• *Hora actual:* \`${infoAhora.horaStr}\` VET.`;

        try {
          await ctx.reply(mensajeFuera, {
            parse_mode: "Markdown",
            reply_parameters: { message_id: messageId }
          });
        } catch (err: any) {
          console.error("[ERROR] No se pudo enviar el mensaje de rechazo fuera de jornada:", err.message);
        }
      } else {
        console.log(`[INFO] Mensaje general recibido fuera de jornada laboral (${horaStr} VET). Ignorando silenciosamente.`);
      }
      return;
    }

    if (REGEX_ELIMINAR.test(texto)) {
      await manejarEliminacion(ctx, messageId);
      return;
    }

    if (!texto.toLowerCase().includes(config.app.reportKeyword.toLowerCase())) {
      if (esEdicion) {
        await marcarFilaParaRevision(null, messageId);
      }
      return;
    }

    const reporte = parsearReporte(texto);
    if (!reporte) {
      console.warn("[ADVERTENCIA] Palabra clave encontrada pero no se pudo parsear el reporte.");
      if (esEdicion) {
        await marcarFilaParaRevision(null, messageId);
      }
      await reaccionar(ctx, "👎");

      const tieneMunicipio = /(?:Municipio|municipio)\*?\s*:/i.test(texto);
      const tieneNodo      = /(?:Nodo|nodo)\*?\s*:/i.test(texto);

      let mensajeError = "";
      if (!tieneMunicipio && !tieneNodo) {
        mensajeError =
          `⚠️ Reporte Rechazado: Formato inválido\n\n` +
          `Hola ${remitente}, no he podido leer los datos de tu reporte. Asegúrate de incluir el Municipio y el número de Nodo.\n\n` +
          `👉 Ejemplo de formato correcto:\n` +
          `1. Municipio: Punceres\n` +
          `2. Nodo: 16039\n` +
          `3. Total de Verificadores en el nodo: 1\n` +
          `➡️Bloque (1) 9am: 0\n` +
          `➡️Bloque (2) 2pm: 0\n` +
          `➡️Bloque (3) 6pm: 1`;
      } else if (!tieneMunicipio) {
        mensajeError =
          `⚠️ Reporte Rechazado: Falta de Municipio\n\n` +
          `Hola ${remitente}, tu reporte no incluye la línea de municipio (ej. Municipio: Punceres).\n\n` +
          `👉 Por favor, edita tu mensaje o envíalo de nuevo incluyendo el municipio correspondiente.`;
      } else if (!tieneNodo) {
        mensajeError =
          `⚠️ Reporte Rechazado: Falta de Nodo\n\n` +
          `Hola ${remitente}, tu reporte no incluye la línea de nodo (ej. Nodo: 16039).\n\n` +
          `👉 Por favor, edita tu mensaje o envíalo de nuevo indicando el número del nodo correspondiente.`;
      }

      if (mensajeError) {
        try {
          await ctx.reply(mensajeError, {
            reply_parameters: { message_id: messageId }
          });
        } catch (err: any) {
          console.error("[ERROR] No se pudo enviar el mensaje de alerta de formato:", err.message);
        }
      }
      return;
    }

    const tiempo = convertirTimestamp(mensajeObj.date);
    console.log("[INFO] Reporte parseado:", { ...reporte, ...tiempo, remitente });

    try {
      const creationTimestamp = mensajeObj.date || Math.floor(Date.now() / 1000);
      const editTimestamp = (mensajeObj as any).edit_date || null;

      const resultado = await procesarYGuardarReporte({
        reporte,
        tiempo,
        remitente,
        messageId,
        chatId: ctx.chat.id,
        creationTimestamp,
        editTimestamp,
        esEdicion,
      });

      if (!resultado.valido) {
        await reaccionar(ctx, "👎");

        let mensajeRespuesta = "";

        if (resultado.razon === "FUERA_DE_HORARIO") {
          mensajeRespuesta =
            `⚠️ *Reporte Rechazado: Fuera de jornada laboral*\n\n` +
            `Hola *${remitente}*, la jornada laboral de hoy ha finalizado (horario de atención: 06:00 AM a 06:00 PM VET).\n\n` +
            `• *Hora registrada:* \`${horaStr}\` VET\n\n` +
            `👉 El corte de las 6:00 pm ya fue consolidado y enviado a Gerencia. No se aceptan más reportes por hoy.`;
        } else if (resultado.razon === "MUNICIPIO_INCORRECTO") {
          mensajeRespuesta =
            `⚠️ *Reporte Rechazado: Municipio no reconocido*\n\n` +
            `Hola *${remitente}*, el municipio *${resultado.municipioParseado}* no se encuentra registrado en la base de datos oficial.\n\n` +
            `• *¿Qué pudo pasar?* Es posible que haya un error de ortografía.\n` +
            `• *Municipios válidos (ejemplos):* Acosta, Caripe, Maturín, Cedeño, Piar, Libertador, etc.\n\n` +
            `👉 *¿Cómo solucionarlo?* Por favor, edita tu mensaje o vuelve a enviar el reporte corregido.`;
        } else if (resultado.razon === "NODO_INCORRECTO") {
          mensajeRespuesta =
            `⚠️ *Reporte Rechazado: Nodo no reconocido*\n\n` +
            `Hola *${remitente}*, en el municipio *${resultado.municipioOficial}* no existe el nodo *${resultado.nodoParseado}* en la base de datos oficial.\n\n` +
            `• *¿Qué pudo pasar?* El número de nodo ingresado no corresponde a este municipio.\n\n` +
            `👉 *¿Cómo solucionarlo?* Por favor, edita tu mensaje o vuelve a enviar el reporte corregido.`;
        } else if (resultado.razon === "EXCESO_VERIFICADORES") {
          mensajeRespuesta =
            `⚠️ *Reporte Rechazado: Límite de verificadores superado*\n\n` +
            `Hola *${remitente}*, el reporte para el nodo *${reporte.nodo}* de *${resultado.municipioOficial}* supera el cupo máximo de personal permitido para hoy.\n\n` +
            `• *Límite oficial permitido:* \`${resultado.limiteVerificadores}\` verificadores.\n` +
            `• *Total acumulado proyectado:* \`${resultado.totalFinal}\` (Suma de hoy: B1: \`${resultado.b1Final}\` | B2: \`${resultado.b2Final}\` | B3: \`${resultado.b3Final}\`)\n\n` +
            `👉 *¿Cómo solucionarlo?* Por favor, edita tu mensaje o vuelve a enviar el reporte corregido con la cantidad de personal ajustada.`;
        } else if (resultado.razon === "ERROR_CONEXION_SHEETS") {
          mensajeRespuesta =
            `⚠️ *Aviso de servicio: Conexión temporalmente no disponible*\n\n` +
            `Hola *${remitente}*, no pudimos registrar tu reporte en este momento debido a una indisponibilidad temporal en los servidores de Google Sheets (Error 503).\n\n` +
            `👉 *¿Cómo solucionarlo?* Por favor, espera 1 o 2 minutos y reenvía tu reporte.`;
        }

        if (mensajeRespuesta) {
          try {
            await ctx.reply(mensajeRespuesta, {
              parse_mode: "Markdown",
              reply_parameters: { message_id: messageId },
            });
          } catch (err: any) {
            console.error("[ERROR] No se pudo enviar el mensaje de rechazo:", err.message);
          }
        }
        return;
      }

      // El reporte fue aceptado exitosamente
      await reaccionar(ctx, "👍");

      // Si se aplicó degradación graciosa (guardado en BD, pero Sheets no respondió tras reintentos):
      if (resultado.sincronizadoSheets === false) {
        console.warn(`[ADVERTENCIA] Reporte guardado en Base de Datos pero sincronización en Sheets diferida por 503 (Mensaje ID: ${messageId}).`);
        try {
          await ctx.reply(
            `ℹ️ *Reporte resguardado en base de datos*\n\n` +
            `Hola *${remitente}*, tu reporte fue registrado exitosamente en el sistema central. La sincronización visual en Google Sheets se reflejará en breve debido a demoras temporales del servicio de Google.`,
            {
              parse_mode: "Markdown",
              reply_parameters: { message_id: messageId },
            }
          );
        } catch (warnErr: any) {
          console.warn("[ADVERTENCIA] No se pudo enviar el aviso informativo de sincronización diferida:", warnErr.message);
        }
      }
    } catch (error: any) {
      console.error("[ERROR] Error procesando reporte en message handler:", error?.message ?? error);
      try {
        await reaccionar(ctx, "👎");
      } catch (_) {}

      try {
        await ctx.reply(
          `⚠️ *Aviso de servicio*\n\n` +
          `Hola *${remitente}*, ocurrió un inconveniente técnico temporal al procesar tu reporte. Por favor, reenvía tu mensaje en unos instantes.`,
          {
            parse_mode: "Markdown",
            reply_parameters: { message_id: messageId },
          }
        );
      } catch (replyErr: any) {
        console.error("[ERROR] No se pudo enviar mensaje de error al usuario:", replyErr.message);
      }
      // NUNCA ejecutar "throw error" para evitar que el fallo escale a bot.catch
    }
  });
}
```

---

### 4.4 Implementation Blueprint: `src/jobs/cleanup.ts`

```typescript
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

export async function ejecutarLimpieza(api: Api, limiteFilas: number = 15, force: boolean = false): Promise<void> {
  if (!force && !esHorarioLaboral()) {
    console.log("[INFO] Limpieza periódica en pausa (fuera del horario laboral de monitoreo).");
    return;
  }

  return sheetsMutex.runExclusive(async () => {
    console.log(`[INFO] Iniciando limpieza de mensajes eliminados en Telegram (límite: ${limiteFilas} filas)...`);
    try {
      const doc = await obtenerHojaDeCalculo();
      const hoja = doc.sheetsByTitle["registros_telegram"];
      if (!hoja) return;

      const filas = await ejecutarConReintento(
        () => hoja.getRows(),
        { contexto: "Lectura de filas en ejecutarLimpieza", maxIntentos: 3, delayInicialMs: 300 }
      );

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
          chatId    = parseInt(obj[COLUMNAS.ID_CHAT], 10);

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

            // Reseteo de fila contenido con reintento por fila
            await ejecutarConReintento(
              () => resetearFila(fila),
              {
                contexto: `Reseteo fila mensaje ID ${messageId}`,
                maxIntentos: 3,
                delayInicialMs: 300,
              }
            );
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

  const jobCortes = new Cron("0 9,14,18 * * *", { timezone: "America/Caracas" }, () => ejecutarLimpieza(api, 60));

  // Reseteo diario de medianoche con reintentos a nivel de job (3 intentos con espera de 15s)
  new Cron("0 0 * * *", { timezone: "America/Caracas" }, async () => {
    console.log("[INFO] Iniciando trabajo programado de reseteo diario de medianoche...");
    const maxIntentosJob = 3;
    const delayEntreIntentosMs = 15000;

    for (let intento = 1; intento <= maxIntentosJob; intento++) {
      try {
        await sheetsMutex.runExclusive(async () => {
          console.log(`[INFO] Ejecutando reseteo diario de medianoche (intento ${intento}/${maxIntentosJob})...`);
          const doc = await obtenerHojaDeCalculo();
          await resetearFilasDeDiasAnteriores(doc);
          await ordenarYLimpiarHojaPrincipal(doc);
          console.log("[INFO] Reseteo diario de medianoche completado exitosamente.");
        });
        break; // Éxito: salir del bucle de reintento
      } catch (err: any) {
        console.error(`[ERROR] Intento ${intento}/${maxIntentosJob} del reseteo diario de medianoche falló:`, err?.message ?? err);
        if (intento < maxIntentosJob) {
          console.log(`[INFO] Reintentando reseteo diario de medianoche en ${delayEntreIntentosMs / 1000}s...`);
          await new Promise((r) => setTimeout(r, delayEntreIntentosMs));
        } else {
          console.error("[FATAL] Se agotaron todos los reintentos para el reseteo diario de medianoche.");
        }
      }
    }
  });

  const jobReporte9am = new Cron("5 9 * * *",  { timezone: "America/Caracas" }, () => enviarReporteDiario(api, 1));
  new Cron("5 14 * * *", { timezone: "America/Caracas" }, () => enviarReporteDiario(api, 2));
  new Cron("5 18 * * *", { timezone: "America/Caracas" }, () => enviarReporteDiario(api, 3));

  new Cron("0 9 * * *",  { timezone: "America/Caracas" }, () => enviarAvisoCierre(api, 1));
  new Cron("0 14 * * *", { timezone: "America/Caracas" }, () => enviarAvisoCierre(api, 2));
  new Cron("0 18 * * *", { timezone: "America/Caracas" }, () => enviarAvisoCierre(api, 3));

  new Cron("6 18 * * *", { timezone: "America/Caracas" }, () => enviarAvisoNodosFaltantes(api));

  // Resguardo diario de historial (11:00 PM VET) con reintentos a nivel de job
  const jobHistorico = new Cron("0 23 * * *", { timezone: "America/Caracas" }, async () => {
    console.log("[INFO] Iniciando trabajo programado de resguardo de historial diario (11:00 PM VET)...");
    const maxIntentosJob = 3;
    const delayEntreIntentosMs = 15000;

    for (let intento = 1; intento <= maxIntentosJob; intento++) {
      try {
        await sheetsMutex.runExclusive(async () => {
          console.log(`[INFO] Ejecutando resguardo de historial diario (intento ${intento}/${maxIntentosJob})...`);
          const doc = await obtenerHojaDeCalculo();
          await guardarHistoricoDiario(doc);
          console.log("[INFO] Resguardo de historial diario completado exitosamente.");
        });
        break; // Éxito: salir del bucle de reintento
      } catch (err: any) {
        console.error(`[ERROR] Intento ${intento}/${maxIntentosJob} del resguardo de historial diario falló:`, err?.message ?? err);
        if (intento < maxIntentosJob) {
          console.log(`[INFO] Reintentando resguardo de historial diario en ${delayEntreIntentosMs / 1000}s...`);
          await new Promise((r) => setTimeout(r, delayEntreIntentosMs));
        } else {
          console.error("[FATAL] Se agotaron todos los reintentos para el resguardo de historial diario.");
        }
      }
    }
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
```

---

## 5. Verification Method

### 5.1 Verification Commands
1. **Type Checking**:
   ```bash
   npm run build
   ```
   Ensures `tsc --noEmit` validates the blueprints and new `ResultadoProcesamiento` fields without type errors.

2. **Existing Unit Tests**:
   ```bash
   npm test
   ```
   Ensures the current 18 tests in `tests/` pass with zero regressions.

### 5.2 Independent Verification Tests for M1-3
The implementer or verification engineer can validate these behaviors using the automated test suite specified for Milestone M1-3:
1. **`tests/resilience.reportProcessor.test.ts`**:
   - **Scenario 1 (Transient 503 Recovery)**: Mock `filaExistente.save()` to fail on attempt 1 with 503 and succeed on attempt 2. Assert `procesarYGuardarReporte` resolves with `{ valido: true, sincronizadoSheets: true }` and `marcarReporteSincronizadoDB` is called.
   - **Scenario 2 (Exhausted 503 with DB Active)**: Mock `filaExistente.save()` to fail 3 consecutive times with 503 while `esDBActiva()` is true. Assert `procesarYGuardarReporte` resolves `{ valido: true, sincronizadoSheets: false, persistidoDB: true }` without throwing.
   - **Scenario 3 (Exhausted 503 with DB Inactive)**: Mock `filaExistente.save()` to fail 3 consecutive times with 503 while `esDBActiva()` is false. Assert `procesarYGuardarReporte` resolves `{ valido: false, razon: "ERROR_CONEXION_SHEETS", sincronizadoSheets: false, persistidoDB: false }` without throwing.
2. **`tests/resilience.cleanup.test.ts`**:
   - **Row-Level Containment**: Mock `resetearFila` on row 1 to fail with 503, while rows 2 and 3 succeed. Assert that all 3 rows are evaluated (`analizados === 3`), rows 2 and 3 are reset (`eliminados === 2`), and the loop does not abort.
3. **`tests/resilience.message.test.ts`**:
   - Test that message handler catches `ERROR_CONEXION_SHEETS` and sends a user rejection without invoking `bot.catch`.

### 5.3 Invalidation Conditions
This blueprint would be invalidated if:
- `sheetsMutex` was converted to a re-entrant mutex implementation.
- Dual-persistence in PostgreSQL was permanently decoupled from the Telegram bot runtime.
- Google Sheets persistence was removed entirely in favor of direct Supabase DB access.
