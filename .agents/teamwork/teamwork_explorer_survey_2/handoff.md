# Handoff Report — Survey Explorer 2: Report Processor & Cleanup Jobs

**Date**: 2026-11-06T14:48:00Z  
**Author**: Survey Explorer 2 (`teamwork_explorer_survey_2`)  
**Scope**: In-depth investigation of `src/services/reportProcessor.ts` and `src/jobs/cleanup.ts`, interaction tracing with Google Sheets (`sheets.ts`), 503 error propagation analysis, and formulation of resilient recovery patterns.

---

## 1. Observation

Direct code examination of `src/services/reportProcessor.ts`, `src/jobs/cleanup.ts`, and related call sites revealed the following exact implementation details and error propagation paths:

### 1.1 `src/services/reportProcessor.ts` Google Sheets Interactions & Error Handling

1. **`eliminarReporte(messageId)` (Lines 29–42)**:
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
   - **Google Sheets API Operations**:
     - `obtenerHojaDeCalculo()` -> calls `doc.loadInfo()` (Axios GET request).
     - `hoja.getRows()` -> fetches all rows from `registros_telegram` (Axios GET request).
     - `resetearFila(fila)` -> calls `fila.save()` (Axios POST/PUT batchUpdate request).
   - **Error Handling**: **None.** No `try/catch` exists inside `eliminarReporte`. Any 503 error rejects the promise and bubbles directly to the caller (`src/handlers/message.ts:17`).
   - **Caller Impact**: In `manejarEliminacion` (`src/handlers/message.ts:14-34`), the error is caught and logged (`console.error("[ERROR] No se pudo resetear el registro de Google Sheets:", error)`), but:
     - No retry is attempted.
     - Deletion fails silently on the sheet.
     - The Telegram message is not deleted, and no user feedback is provided.

2. **`_marcarFilaParaRevision` & `marcarFilaParaRevision` (Lines 47–75)**:
   ```typescript
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
           await fila.save();
           console.log(`[INFO] Fila marcada para revisión (Mensaje ID: ${messageId}).`);
         }
       }
     } catch (error) {
       console.error("[ERROR] No se pudo marcar la fila para revisión:", error);
     }
   }
   ```
   - **Error Handling**: Contains a coarse `try/catch` that logs to `console.error`.
   - **Limitation**: Swallows the error without retry. If Google Sheets is unavailable (503), the row is never marked for review, which prevents `cleanup.ts` from resetting invalid edits after the 5-minute grace period.

3. **`procesarYGuardarReporte` (Lines 80–298)**:
   - **Phase 1: Pre-Mutex Google Sheets API Calls**:
     - Line 113: `const doc = await obtenerHojaDeCalculo();` (calls `doc.loadInfo()`).
     - Lines 134, 141, 144: Calls `validarMunicipioNodo(doc, municipio, nodo)` in `src/services/validation.ts:25`, which executes:
       ```typescript
       const filasNodos = await hojaNodos.getRows();
       ```
     - **Observation**: If DB is inactive or DB validation throws, fallback to Sheets executes `hojaNodos.getRows()`. There is **no try/catch or retry** around this call. A 503 error here throws immediately out of `procesarYGuardarReporte`.
   - **Phase 2: Inside `sheetsMutex.runExclusive`**:
     - Line 164: `await asegurarColumnas(hoja);`
       - Executes `hoja.loadHeaderRow()` and conditionally `hoja.setHeaderRow(cabeceras)`.
       - Has **no error handling or retry**.
     - Line 166: `const filas = await hoja.getRows();`
       - Has **no error handling or retry**.
     - Lines 245–260: Dual-persistence in Supabase DB:
       - Handled in `try { ... } catch (errDb: any) { console.error("[ERROR] Falló guardado en Base de Datos:", errDb.message); }`.
       - Database errors do NOT throw; execution proceeds.
     - Lines 278–284: Persistence in Google Sheets:
       ```typescript
       if (filaExistente) {
         filaExistente.assign(datosHoja);
         await filaExistente.save();
       } else {
         await hoja.addRow(datosHoja);
       }
       ```
       - Has **zero error handling or retry**.
     - Lines 286–288: Mark DB as synchronized:
       ```typescript
       if (esDBActiva()) {
         await marcarReporteSincronizadoDB(nodo, fecha);
       }
       ```
       - **State Inconsistency**: If `filaExistente.save()` or `hoja.addRow(datosHoja)` throws 503:
         1. The database record is already written (`guardarOActualizarReporteDB`), but remains with `sincronizado_sheets = false`.
         2. The Google Sheet is never updated.
         3. `marcarReporteSincronizadoDB` is skipped.
         4. The unhandled 503 exception escapes `sheetsMutex.runExclusive`.

4. **Caller Propagation in `src/handlers/message.ts`**:
   - Lines 186–195:
     ```typescript
     const resultado = await procesarYGuardarReporte({ ... });
     ```
   - Lines 244–247:
     ```typescript
     } catch (error) {
       console.error("[ERROR] Falló la persistencia en Google Sheets:", error);
       throw error;
     }
     ```
   - **Observation**: `message.ts` catches the error only to log and re-throw it (`throw error`).
   - In `bot.ts` (lines 30–33):
     ```typescript
     bot.catch((err) => {
       const updateId = err.ctx?.update?.update_id ?? "desconocida";
       console.error(`[ERROR GLOBAL] Error en actualización ${updateId}:`, err.error);
     });
     ```
   - **Direct Consequence**: The re-thrown error hits Grammy's `bot.catch`. The Telegram update fails globally. The bot does not react (neither 👍 nor 👎), does not notify the user, and leaves the report dropped from Google Sheets.

---

### 1.2 `src/jobs/cleanup.ts` Interactions & Error Handling

1. **`ejecutarLimpieza(api, limiteFilas, force)` (Lines 48–115)**:
   ```typescript
   return sheetsMutex.runExclusive(async () => {
     try {
       const doc   = await obtenerHojaDeCalculo();
       const hoja  = doc.sheetsByTitle["registros_telegram"];
       if (!hoja) return;
       const filas = await hoja.getRows();

       let eliminados = 0;
       let analizados = 0;

       for (let i = filas.length - 1; i >= 0; i--) {
         const fila      = filas[i];
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
   });
   ```
   - **Google Sheets API Operations**:
     - `obtenerHojaDeCalculo()` -> `doc.loadInfo()`
     - `hoja.getRows()`
     - Inside loop: `resetearFila(fila)` -> `fila.save()`
   - **Vulnerability — Interrupted Cleanup Cycle**:
     The `try/catch` block surrounds the **entire** function. There is **no row-level error containment**.
     If row $i$ encounters a 503 error on `resetearFila(fila)`:
     1. The exception jumps out of the `for` loop to line 111.
     2. The loop terminates immediately.
     3. All remaining rows ($i-1, i-2, \dots, 0$) are never inspected or cleaned.
     4. The cleanup cycle is aborted mid-batch.

2. **Scheduled Crons in `programarLimpieza` (Lines 117–180)**:
   - **Startup & Periodic Limpieza (`*/5 * * * *`)**:
     Calls `ejecutarLimpieza(api, 60)`. If 503 occurs, logs and exits until next 5-minute trigger.
   - **Midnight Reset Cron (`0 0 * * *`) (Lines 124–135)**:
     ```typescript
     new Cron("0 0 * * *", { timezone: "America/Caracas" }, async () => {
       await sheetsMutex.runExclusive(async () => {
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
     - Executes upwards of 50–100 sequential Sheets API calls (`getRows`, `loadCells`, `saveUpdatedCells`, loop of `fila.save()`, loop of `fila.delete()`, reordering `fila.save()`).
     - **Catastrophic Failure Mode**: If ANY 503 error occurs anywhere in this chain, the coarse `try/catch` logs the error and the job terminates. Because the cron expression is `0 0 * * *`, it runs **only once per day**. No automatic retry is scheduled. The spreadsheet is left in an un-reset, un-archived, or partially-cleared state for the entire operating day.
   - **Daily Historical Backup (`0 23 * * *`) (Lines 147–157)**:
     ```typescript
     new Cron("0 23 * * *", { timezone: "America/Caracas" }, async () => {
       await sheetsMutex.runExclusive(async () => {
         try {
           const doc = await obtenerHojaDeCalculo();
           await guardarHistoricoDiario(doc);
         } catch (err) {
           console.error("[ERROR] Fallo al guardar el historial diario:", err);
         }
       });
     });
     ```
     - If `guardarHistoricoDiario(doc)` hits a 503 error, the backup is aborted without retry. That day's historical archive is permanently missed.
   - **Reporting & Notifications (`enviarReporteDiario`, `enviarAvisoNodosFaltantes`)**:
     Scheduled at 9:05am, 2:05pm, 6:05pm, 6:06pm. Both read and write to Sheets (`obtenerConsolidadoGeneral`, `obtenerDesgloseFaltantes`, `nodos_sin_reportes`). A 503 error aborts report generation with no retry, leaving managers without scheduled operational reports.

### 1.3 Existing Test Suite & Tooling

- Test runner: `tsx --test` (Node.js native test runner via `node:test` and `node:assert/strict`).
- `tests/cleanup.test.ts` contains only 8 lines testing the pure synchronous function `esHorarioLaboral()`.
- **Zero tests exist for `reportProcessor.ts`**.
- **Zero tests exist for `ejecutarLimpieza` or Google Sheets 503 error handling**.

---

## 2. Logic Chain

1. **Premise 1 (Network reality)**: Google Sheets API periodically returns HTTP 503 "The service is currently unavailable" due to transient backend load spikes or maintenance windows.
2. **Premise 2 (Library behavior)**: `google-spreadsheet@4.1.5` relies on `axios@^1.7.7`. When a 503 response arrives, Axios throws an `AxiosError`, which is intercepted and re-thrown by `google-spreadsheet` without automatic retry.
3. **Chain in `reportProcessor.ts`**:
   - `procesarYGuardarReporte` executes 5 separate Sheets API operations: `obtenerHojaDeCalculo`, `hojaNodos.getRows` (validation fallback), `asegurarColumnas`, `hoja.getRows`, and `filaExistente.save()` / `hoja.addRow()`.
   - None of these calls possess retry wrappers or localized try/catch blocks.
   - When a 503 occurs, the error propagates to `src/handlers/message.ts:246`, which executes `throw error;`.
   - The error reaches `bot.catch`, terminating the Telegram update pipeline.
   - Therefore, a transient 503 error during report submission inevitably causes an unhandled crash of the update handler, drops the user's report without notification, and creates partial state synchronization where DB has data but Sheets does not.
4. **Chain in `cleanup.ts`**:
   - In `ejecutarLimpieza`, a single `try/catch` surrounds the outer loop over rows.
   - When `resetearFila(fila)` hits a 503 on row $i$, the loop immediately breaks.
   - Therefore, a single transient 503 on one row aborts the entire cleanup batch, leaving all subsequent rows uninspected.
   - In midnight cleanup (`0 0 * * *`) and 23:00 historical backup (`0 23 * * *`), single daily cron schedules have no retry logic. A transient 503 permanently aborts daily maintenance and historical preservation.

---

## 3. Caveats

1. **Non-Reentrant Mutex**:
   `sheetsMutex` (`src/utils/mutex.ts`) is a promise queue that is **not re-entrant**. A function running inside `sheetsMutex.runExclusive` must NEVER call another function that also calls `sheetsMutex.runExclusive`, as this causes a permanent deadlock. Any retry mechanism inside `reportProcessor.ts` and `cleanup.ts` must operate within the existing lock context without re-acquiring the mutex.
2. **Lock Duration During Retries**:
   Holding `sheetsMutex` while executing long retry backoffs (e.g., 5s + 10s) blocks all other Telegram report submissions in the mutex queue. Retry backoffs inside mutex-protected blocks must use short, jittered delays (e.g., 500ms, 1000ms, 2000ms; max total $\approx 3.5\text{s}$).
3. **Dual-Persistence Consistency**:
   The system supports dual persistence (PostgreSQL/Supabase + Google Sheets). When PostgreSQL is enabled, DB writes occur before Sheets writes. A graceful degradation strategy can leverage PostgreSQL as a buffer when Sheets is temporarily down. However, when PostgreSQL is disabled (`config.db.enabled === false`), Google Sheets is the sole persistence store, requiring explicit user notification if retries are exhausted.

---

## 4. Conclusion & Recommendations

### 4.1 Structural Assessment

| Component | Current State | Vulnerability to 503 | Recommended Fix |
|---|---|---|---|
| `reportProcessor.ts:procesarYGuardarReporte` | No retries; throws unhandled | Crashes update handler; DB/Sheets desync; user report lost | Add transient retry wrapper; graceful degradation via DB sync marker; return structured error instead of throwing |
| `reportProcessor.ts:eliminarReporte` | No retries; throws to caller | Deletion silently lost in Sheets; Telegram message remains | Add transient retry wrapper; return success/failure boolean without throwing |
| `reportProcessor.ts:marcarFilaParaRevision` | Swallows error with no retry | Invalid edit never flagged for cleanup | Add retry on `fila.save()` |
| `cleanup.ts:ejecutarLimpieza` | Coarse try/catch around whole loop | Aborts entire cleanup cycle on first 503 row | Per-row `try/catch` containment; row-level retry; continue scanning remaining rows |
| `cleanup.ts:midnightReset` (`0 0 * * *`) | Single execution daily; coarse catch | Permanent daily data corruption / stale data | Retry loop with backoff (up to 3 attempts); row-level containment in `resetearFilasDeDiasAnteriores` |
| `cleanup.ts:guardarHistoricoDiario` (`0 23 * * *`) | Single execution daily; coarse catch | Permanent loss of daily historical backup | Automatic retry with backoff |

---

### 4.2 Concrete Implementation Specifications

#### A. Transient Error Predicate & Retry Utility
Create a shared helper in `src/utils/retry.ts` or `src/services/sheets.ts`:
```typescript
export function esErrorReintentable(error: any): boolean {
  if (!error) return false;
  const status = error.response?.status ?? error.status ?? error.code;
  if (status === 503 || status === 429 || status === 500 || status === 502 || status === 504) {
    return true;
  }
  const msg = String(error.message || "").toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("service is currently unavailable") ||
    msg.includes("the service is currently unavailable") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout")
  );
}

export interface OpcionesReintento {
  maxIntentos?: number;
  delayInicialMs?: number;
  factorExponencial?: number;
  jitter?: boolean;
}

export async function ejecutarConReintento<T>(
  operacion: () => Promise<T>,
  contexto: string = "Operación Google Sheets",
  opciones: OpcionesReintento = {}
): Promise<T> {
  const { maxIntentos = 3, delayInicialMs = 800, factorExponencial = 2, jitter = true } = opciones;
  let ultimoError: any;

  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      return await operacion();
    } catch (error: any) {
      ultimoError = error;
      if (!esErrorReintentable(error) || intento === maxIntentos) {
        throw error;
      }
      const backoff = delayInicialMs * Math.pow(factorExponencial, intento - 1);
      const delay = jitter ? Math.round(backoff * (0.8 + Math.random() * 0.4)) : backoff;
      console.warn(
        `[REINTENTO ${intento}/${maxIntentos}] ${contexto} falló con error transitorio (${error.message}). Reintentando en ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw ultimoError;
}
```

#### B. Refactoring `src/services/reportProcessor.ts`
1. **Wrap Sheets writes with `ejecutarConReintento`**:
   ```typescript
   await ejecutarConReintento(
     async () => {
       if (filaExistente) {
         filaExistente.assign(datosHoja);
         await filaExistente.save();
         console.log(`[INFO] Fila fija actualizada en Google Sheets...`);
       } else {
         await hoja.addRow(datosHoja);
         console.log(`[INFO] Fila nueva creada en Google Sheets...`);
       }
     },
     `Guardado en Google Sheets (Nodo ${nodo})`,
     { maxIntentos: 3, delayInicialMs: 600 }
   );
   ```
2. **Graceful Degradation when DB is active**:
   If Sheets write fails after all 3 retries:
   - If `esDBActiva()`: Log warning, keep `sincronizado_sheets = false` in DB, do NOT throw unhandled error, and return `{ valido: true, persistidoEnDB: true, pendienteSincronizacionSheets: true, ... }`.
   - If DB is inactive: Catch the 503 error and return `{ valido: false, razon: "ERROR_CONEXION_SHEETS", error: error.message, ... }`.
3. **Update `src/handlers/message.ts`**:
   Handle `resultado.razon === "ERROR_CONEXION_SHEETS"` by replying to the user:
   `"⚠️ El servicio de Google Sheets está experimentando demoras o indisponibilidad temporal (Error 503). Por favor reenvía tu reporte en unos minutos."`
   Remove `throw error` in `message.ts:246` or wrap it to prevent updating failure crashes.

#### C. Refactoring `src/jobs/cleanup.ts`
1. **Per-Row Error Containment in `ejecutarLimpieza`**:
   ```typescript
   for (let i = filas.length - 1; i >= 0; i--) {
     const fila = filas[i];
     try {
       ...
       if (!existe) {
         await ejecutarConReintento(
           () => resetearFila(fila),
           `Reseteo fila mensaje ${messageId}`,
           { maxIntentos: 2, delayInicialMs: 500 }
         );
         eliminados++;
       }
     } catch (filaErr) {
       console.error(`[ERROR] No se pudo procesar la fila del mensaje ${messageId} en la limpieza:`, filaErr);
       // Contain error to this row, CONTINUE the loop
     }
     await new Promise((r) => setTimeout(r, config.app.cleanupRequestDelayMs));
   }
   ```
2. **Job-Level Retry for Midnight Reset & Historical Backup**:
   Wrap the midnight reset invocation with a retry loop (e.g., 3 attempts spaced by 10s–30s).
   In `resetearFilasDeDiasAnteriores`, contain errors per row so one 503 row does not block remaining rows from being reset.

---

## 5. Verification Method

### 5.1 Verification Commands
Run the existing test suite:
```bash
npm test
```
*Current status*: 18/18 passing.

### 5.2 Automated Simulation of 503 Errors
To verify the fixes against Requirement R3, unit and integration tests should be added in `tests/`:
1. **`tests/reportProcessor.503.test.ts`**:
   - Mock `google-spreadsheet` worksheet `save()` and `addRow()` to throw an `AxiosError` with `response: { status: 503, statusText: "Service Unavailable" }` on the 1st attempt and succeed on the 2nd attempt.
   - Assert that `ejecutarConReintento` catches the 503, logs the retry, recovers on attempt 2, and resolves `{ valido: true }`.
   - Test exhausted retries (3 consecutive 503s): verify that DB fallback activates or returns structured `ERROR_CONEXION_SHEETS` without throwing unhandled exceptions.
2. **`tests/cleanup.503.test.ts`**:
   - Mock `resetearFila` to reject with 503 on the 1st row of a 3-row batch.
   - Assert that row 1 error is caught and logged, and rows 2 and 3 are successfully processed (cycle NOT aborted).

### 5.3 Invalidation Conditions
This survey's findings and recommendations would be invalidated if:
- Google Sheets API client library was swapped away from `google-spreadsheet` / Axios.
- `sheetsMutex` was eliminated or replaced with a re-entrant concurrency primitive.
- The project moved exclusively to database persistence with no live Sheets syncing.
