# Handoff Report — Investigation of Google Sheets Integration & 503 Error Handling

## 1. Observation

Direct observations from codebase inspection, package manifests, and dependency sources:

### 1.1 Architecture & Dependencies
- `package.json` (lines 19-30) shows the project dependencies:
  ```json
  "dependencies": {
    "@supabase/supabase-js": "^2.45.4",
    "croner": "^10.0.1",
    "dotenv": "^16.4.5",
    "google-auth-library": "^9.11.0",
    "google-spreadsheet": "^4.1.4",
    "grammy": "^1.27.0",
    "pino": "^10.3.1",
    "pino-pretty": "^13.1.3",
    "tsx": "^4.23.12",
    "typescript": "^7.0.2"
  }
  ```
- `node_modules/google-spreadsheet/package.json` (lines 62-65):
  ```json
  "dependencies": {
    "axios": "^1.7.7",
    "lodash": "^4.17.21"
  }
  ```
  `google-spreadsheet` internally uses `axios` for all its HTTP transport to Google Sheets API (`https://sheets.googleapis.com/v4/spreadsheets/`).
- `node_modules/google-spreadsheet/src/lib/GoogleSpreadsheet.ts` (lines 120-142):
  ```ts
  this.sheetsApi = Axios.create({
    baseURL: `${SHEETS_API_BASE_URL}/${spreadsheetId}`,
    paramsSerializer: axiosParamsSerializer,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  this.sheetsApi.interceptors.request.use(this._setAxiosRequestAuth.bind(this));
  this.sheetsApi.interceptors.response.use(
    this._handleAxiosResponse.bind(this),
    this._handleAxiosErrors.bind(this)
  );
  ```
- `node_modules/google-spreadsheet/src/lib/GoogleSpreadsheet.ts` error handler interceptor (lines 171-190):
  ```ts
  async _handleAxiosErrors(error: AxiosError) {
    const errorData = error.response?.data as any;

    if (errorData) {
      if (!errorData.error) throw error;

      const { code, message } = errorData.error;
      error.message = `Google API error - [${code}] ${message}`;
      throw error;
    }

    if (_.get(error, 'response.status') === 403) {
      if ('apiKey' in this.auth) {
        throw new Error('Sheet is private. Use authentication or make public. ...');
      }
    }
    throw error;
  }
  ```

### 1.2 Inspection of `src/services/sheets.ts`
All functions and Google Sheets API calls in `src/services/sheets.ts`:

1. **`obtenerHojaDeCalculo()`** (lines 33-62):
   - Signature: `export async function obtenerHojaDeCalculo(): Promise<GoogleSpreadsheet>`
   - API Call: `await doc.loadInfo();` (line 53).
   - Error handling:
     ```ts
     })().catch((err) => {
       docPromise = null;
       throw err;
     });
     ```
     Resets `docPromise = null` and rethrows. No retry, no backoff.

2. **`asegurarColumnas(hoja: GoogleSpreadsheetWorksheet)`** (lines 68-83):
   - Signature: `export async function asegurarColumnas(hoja: GoogleSpreadsheetWorksheet): Promise<void>`
   - Code verbatim:
     ```ts
     export async function asegurarColumnas(hoja: GoogleSpreadsheetWorksheet): Promise<void> {
       await hoja.loadHeaderRow();

       const cabeceras = [...hoja.headerValues];
       let modificado  = false;

       for (const col of [COLUMNAS.ID_MENSAJE, COLUMNAS.ID_CHAT, COLUMNAS.ESTADO]) {
         if (!cabeceras.includes(col)) {
           console.log(`[INFO] Columna '${col}' no encontrada. Añadiéndola...`);
           cabeceras.push(col);
           modificado = true;
         }
       }

       if (modificado) await hoja.setHeaderRow(cabeceras);
     }
     ```
   - API Calls:
     - `await hoja.loadHeaderRow();` (line 69) -> loads cells in row 1 via `sheetsApi.get`.
     - `await hoja.setHeaderRow(cabeceras);` (line 82) -> updates row 1 via `sheetsApi.post`.
   - Error handling: **None**. Zero try/catch, zero retry logic. Any 503 instantly rejects and bubbles up.

3. **`normalizarTexto(txt: string | undefined | null): string`** (lines 88-95):
   - In-memory string manipulation. No API calls.

4. **`buscarFilaPorMensaje(filas: GoogleSpreadsheetRow[], messageId: number | string): GoogleSpreadsheetRow | null`** (lines 100-104):
   - In-memory array search. No API calls.

5. **`buscarFilaPorNodo(filas: GoogleSpreadsheetRow[], municipioOficial: string, nodo: number | string): GoogleSpreadsheetRow | null`** (lines 109-118):
   - In-memory array search. No API calls.

6. **`resetearFila(fila: GoogleSpreadsheetRow): Promise<void>`** (lines 124-136):
   - Signature: `export async function resetearFila(fila: GoogleSpreadsheetRow): Promise<void>`
   - API Call: `await fila.save();` (line 135) -> updates cells via `sheetsApi.request`.
   - Error handling: **None**. Zero try/catch, zero retry.

7. **`resetearFilasDeDiasAnteriores(doc: GoogleSpreadsheet): Promise<number>`** (lines 141-181):
   - Signature: `export async function resetearFilasDeDiasAnteriores(doc: GoogleSpreadsheet): Promise<number>`
   - API Calls:
     - `await hoja.getRows();` (line 144)
     - `await guardarHistoricoDiario(doc, fechaAnterior);` (line 160)
     - `await resetearFila(fila);` (line 170) -> `fila.save()`
   - Error handling: **None**. Zero try/catch, zero retry.

8. **`guardarHistoricoDiario(doc: GoogleSpreadsheet, fechaEspecifica: string | null = null): Promise<void>`** (lines 186-434):
   - Signature: `export async function guardarHistoricoDiario(doc: GoogleSpreadsheet, fechaEspecifica: string | null = null): Promise<void>`
   - API Calls:
     - `await hojaPrincipal.getRows();` (line 191)
     - `await doc.addSheet({ title: "registros_historicos_telegram" });` (line 212)
     - `await sheetHistorica.loadHeaderRow();` (line 218)
     - `await sheetHistorica.setHeaderRow([...]);` (line 221)
     - `await sheetHistorica.getRows();` (line 237)
     - `await sobrantes[i].delete();` (line 249)
     - `await sheetHistorica.loadCells({...});` (line 297)
     - `await sheetHistorica.loadHeaderRow();` (line 304)
     - `await sheetHistorica.saveUpdatedCells();` (line 370)
     - `await sheetHistorica.addRows(filasDatos);` (line 432)
   - Error handling:
     - Lines 217-219 catch header loading only to fallback to `setHeaderRow` (assuming headers didn't exist). If 503 occurred, it immediately fails again.
     - All other API calls have zero retry or 503 error handling.

9. **`obtenerUltimosValores(...)`** (lines 439-470):
   - In-memory calculation over rows. No API calls.

### 1.3 Caller Modules & Impact of 503 Errors

1. **`src/services/reportProcessor.ts`**:
   - `procesarYGuardarReporte` (lines 80-298):
     - Line 113: `const doc = await obtenerHojaDeCalculo();`
     - Line 134/141/144: `await validarMunicipioNodo(doc, ...)` (calls `hojaNodos.getRows()`)
     - Line 161: `return sheetsMutex.runExclusive(async () => {`
     - Line 164: `await asegurarColumnas(hoja);`
     - Line 166: `const filas = await hoja.getRows();`
     - Line 279: `await filaExistente.save();`
     - Line 282: `await hoja.addRow(datosHoja);`
   - Flow in `src/handlers/message.ts` (lines 186-248):
     ```ts
     try {
       const resultado = await procesarYGuardarReporte({...});
       ...
       await reaccionar(ctx, "👍");
     } catch (error) {
       console.error("[ERROR] Falló la persistencia en Google Sheets:", error);
       throw error;
     }
     ```
   - When 503 occurs in `asegurarColumnas` or during row saving:
     - The error is re-thrown by `message.ts:246`.
     - In `bot.ts` (lines 30-33):
       ```ts
       bot.catch((err) => {
         const updateId = err.ctx?.update?.update_id ?? "desconocida";
         console.error(`[ERROR GLOBAL] Error en actualización ${updateId}:`, err.error);
       });
       ```
     - Telegram update fails completely. The user gets no feedback, no reaction ("👍"), and the row is not persisted to Google Sheets.
     - Note: If database is active, Supabase upsert happens at lines 245-260 before the Sheets row save, but `marcarReporteSincronizadoDB` is never reached.

2. **`src/jobs/cleanup.ts`**:
   - `ejecutarLimpieza(api, ...)` (lines 48-115):
     - Line 57: `const doc = await obtenerHojaDeCalculo();`
     - Line 60: `const filas = await hoja.getRows();`
     - Line 99: `await resetearFila(fila);`
     - Lines 111-113: `catch (error) { console.error("[ERROR] Falló la ejecución de la limpieza:", error); }`
     - If 503 occurs, the entire cleanup loop is aborted for that cycle.
   - Midnight cron (lines 124-135):
     - Calls `resetearFilasDeDiasAnteriores(doc)` and `ordenarYLimpiarHojaPrincipal(doc)`.
     - 503 aborts the daily reset, leaving stale rows in the primary sheet for the next working day.
   - 23:00 cron (lines 147-157):
     - Calls `guardarHistoricoDiario(doc)`.
     - 503 aborts historical persistence; daily history snapshot is omitted.

3. **`src/services/sheets.business.ts`**:
   - `inicializarHojaConNodos` (line 26): calls `await asegurarColumnas(hoja);`, `hojaNodos.getRows()`, `hoja.getRows()`, `hoja.addRow()`.
   - `ordenarYLimpiarHojaPrincipal`: calls `hojaNodos.getRows()`, `hojaPrincipal.getRows()`, `fila.delete()`, `fila.save()`.

4. **`src/services/syncService.ts`**:
   - `sincronizarReporteAGoogleSheets` (lines 13-56):
     - Calls `obtenerHojaDeCalculo()`, `asegurarColumnas(hoja)`, `hoja.getRows()`, `filaExistente.save()` / `hoja.addRow()`.
     - Has `catch (error: any) { console.error('[SYNC ERROR]...', error.message); }`, but does NOT retry and leaves `sincronizado_sheets` as `false`.

5. **`src/services/catalogService.ts`**:
   - `sincronizarCatalogoDesdeSheets` (lines 9-55):
     - Calls `obtenerHojaDeCalculo()`, `hojaNodos.getRows()`. Catches and returns `{ exitoso: false, error }`.

6. **`src/handlers/commands.ts`**:
   - Admin commands `/reporte`, `/lista`, `/estado`: Call `obtenerHojaDeCalculo()`, `hoja.getRows()`, `generarReporteRealTime(doc)`.
   - 503 triggers generic error response to user (`❌ Ocurrió un error al...`).

---

## 2. Logic Chain

1. **Premise 1 (Transport & Error Class)**:
   Google Sheets calls in this codebase are performed via `google-spreadsheet` v4.1.5, which instantiates `axios` (v1.7.7). When the Google Sheets API server returns HTTP status 503 (`UNAVAILABLE`), Axios throws an `AxiosError`. The `GoogleSpreadsheet._handleAxiosErrors` interceptor extracts `code = 503` and `message = 'The service is currently unavailable'` from the response body and rewrites `error.message` to:
   `Google API error - [503] The service is currently unavailable`
   while re-throwing the `AxiosError` instance.

2. **Premise 2 (Vulnerability in `asegurarColumnas`)**:
   `asegurarColumnas` in `src/services/sheets.ts` is invoked at line 164 of `src/services/reportProcessor.ts` on every valid report message, as well as in `syncService.ts:21` and `sheets.business.ts:26`.
   Because `asegurarColumnas` contains two network calls (`hoja.loadHeaderRow()` and `hoja.setHeaderRow()`) without any `try/catch` or retry logic, any transient 503 response from Google's servers results in an immediate rejected Promise.

3. **Premise 3 (Vulnerability in Global Ingestion & Cleanup)**:
   In `src/services/reportProcessor.ts:procesarYGuardarReporte`, this rejection escapes `sheetsMutex.runExclusive(...)` and reaches `src/handlers/message.ts:246`, which executes `throw error;`. In grammY, this triggers `bot.catch`, terminating the update processing pipeline. The sender receives no Telegram confirmation, and the report is never saved to the active Google Sheet.
   Similarly, in `src/jobs/cleanup.ts`, a 503 error during `hoja.getRows()` or `fila.save()` halts the cleanup cycle or skips the midnight reset/backup.

4. **Premise 4 (Lack of Retry Infrastructure)**:
   There is currently zero retry or backoff infrastructure in `src/services/sheets.ts` or `src/utils/`. Neither linear delays, exponential backoffs, nor jitter mechanisms exist for external Google Sheets calls.

5. **Premise 5 (Potential for Graceful Degradation)**:
   `src/services/reportProcessor.ts` already integrates Supabase via `guardarOActualizarReporteDB`. In lines 245-260, the report is saved into `reportes_diarios` with `sincronizado_sheets = false`. When Google Sheets is temporarily unavailable (503), the data is already safe in the database. With proper graceful degradation, the bot can acknowledge the report (or alert with warning), leave `sincronizado_sheets = false`, and avoid throwing an unhandled exception to `bot.catch`.

---

## 3. Caveats

1. **Transient vs Non-Transient Status Codes**:
   Not all Google API errors should be retried. Non-transient errors (e.g. 400 Bad Request, 401 Unauthorized, 403 Forbidden/Permission Denied, 404 Not Found) must fail immediately without retry. Only transient errors (503 Service Unavailable, 502 Bad Gateway, 504 Gateway Timeout, 429 Rate Limit/Resource Exhausted, and network socket disconnections like ECONNRESET/ETIMEDOUT) should be retried.
2. **Interactive Latency Constraints**:
   Telegram bot users expect responses within 1-3 seconds. Backoff schedules for report processing must not exceed total delays of 2-4 seconds (e.g. 3 retries: 250ms, 500ms, 1000ms with jitter) so that the user does not experience a stuck bot. Background jobs (`cleanup.ts`) can tolerate slightly higher backoff windows.
3. **Idempotency of Sheets Operations**:
   - `hoja.loadHeaderRow()` and `hoja.getRows()` are idempotent reads: completely safe to retry.
   - `asegurarColumnas`: idempotent check and set: safe to retry.
   - `fila.save()` and `fila.assign(...)`: updates the specific row by row index: safe to retry.
   - `hoja.addRow()`: appending a new row if done repeatedly on network timeout could potentially duplicate rows if the previous attempt reached the server but the response dropped. However, the system uses fixed rows per node (`buscarFilaPorNodo` + `fila.save()`), with `addRow` only as an exceptional fallback.

---

## 4. Conclusion

1. **Problem Root Cause**:
   Google Sheets API calls throughout `src/services/sheets.ts`—most critically in `asegurarColumnas`, `obtenerHojaDeCalculo`, and row operations—lack transient error detection, exponential backoff, and retry handling. When Google Sheets returns HTTP 503 ("The service is currently unavailable"), `google-spreadsheet`'s internal Axios instance throws an `AxiosError`, which crashes the report processing flow in `src/handlers/message.ts` and interrupts scheduled cleanup jobs in `src/jobs/cleanup.ts`.

2. **Error Shape Identification**:
   - Instance of: `AxiosError` (from `axios`) or `GaxiosError` (if during OAuth auth).
   - Identification properties:
     - `error.response?.status === 503`
     - `error.status === 503`
     - `error.response?.data?.error?.code === 503`
     - `error.message` matching `/503/i` or `/service is currently unavailable/i` or `Google API error - [503]`
     - Transient network error codes: `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`.

3. **Recommended Solution Architecture**:
   - **Component A: Dedicated Retry Engine (`src/utils/retry.ts` or within `sheets.ts`)**:
     A robust `ejecutarConReintento<T>(fn: () => Promise<T>, opciones?: RetryOptions): Promise<T>` supporting:
     - Configurable `maxRetries` (default 3).
     - Configurable `initialDelayMs` (default 300ms) with exponential factor (2.0) and random jitter (±20%).
     - Predicate `esErrorReintentableGoogle(error: any): boolean` targeting 503, 502, 504, 429, and transient socket errors.
   - **Component B: Resilient `asegurarColumnas` & Core Functions in `sheets.ts`**:
     Wrap `hoja.loadHeaderRow()`, `hoja.setHeaderRow()`, `doc.loadInfo()`, `fila.save()`, and row batch operations with the retry mechanism.
     In `asegurarColumnas`, if repeated 503 errors occur after retries, log a descriptive warning and gracefully degrade (e.g., if columns cannot be verified due to transient 503, allow existing headers if present or log and handle).
   - **Component C: Graceful Degradation in `reportProcessor.ts`**:
     Wrap the Google Sheets persistence step in `procesarYGuardarReporte` so that if 503 persists after all retries:
     - If Supabase DB is active, the report is preserved with `sincronizado_sheets: false`. Return `{ valido: true, sincronizadoSheets: false, ... }` instead of throwing unhandled error.
     - Log a clear transient warning: `[ADVERTENCIA] Google Sheets no disponible (503). Reporte resguardado en BD; sincronización diferida.`
   - **Component D: Resilient `cleanup.ts`**:
     In `ejecutarLimpieza` and cron handlers, wrap Sheets operations with retry and catch persistent 503 errors with structured warnings, ensuring cleanup does not terminate prematurely or crash the node runtime.

---

## 5. Verification Method

### 5.1 Verification Commands
1. **Existing Test Suite**:
   ```bash
   npm test
   ```
   Ensures all 18 existing tests pass without regressions.

2. **TypeScript Compilation Check**:
   ```bash
   npm run build
   ```
   Confirms strict type compliance (`tsc --noEmit`).

### 5.2 Automated Simulation of 503 Errors
To verify recovery and graceful failure behaviors:
1. **Simulation of `AxiosError` 503**:
   Construct an error matching `google-spreadsheet`'s exact error structure:
   ```ts
   function crearError503Google(): any {
     const error: any = new Error("Google API error - [503] The service is currently unavailable");
     error.name = "AxiosError";
     error.isAxiosError = true;
     error.response = {
       status: 503,
       statusText: "Service Unavailable",
       data: {
         error: {
           code: 503,
           message: "The service is currently unavailable",
           status: "UNAVAILABLE",
         },
       },
     };
     return error;
   }
   ```
2. **Test Cases to Implement**:
   - **Recovery Test**: Mock `hoja.loadHeaderRow()` rejecting with 503 twice, then resolving successfully on attempt 3. Verify `asegurarColumnas` succeeds and retry count equals 2.
   - **Exhaustion / Graceful Failure Test**: Mock `hoja.loadHeaderRow()` rejecting with 503 continuously. Verify that `asegurarColumnas` handles the condition without throwing an unhandled exception or crashing callers.
   - **Report Processing Graceful Degradation Test**: Simulate Google Sheets 503 during `procesarYGuardarReporte`. Verify it does not throw unhandled to `message.ts`, and correctly leaves database record queued for sync.
   - **Cleanup Job Fault Tolerance**: Simulate 503 in `ejecutarLimpieza`. Verify the job logs the warning, retries, and finishes gracefully without throwing unhandled rejection.
   - **Non-Transient Error Test**: Mock 400 or 403 error. Verify it does NOT enter infinite retries.

### 5.3 Invalidation Conditions
- If any test throws an unhandled `AxiosError` or `UnhandledPromiseRejection`.
- If a 503 error during Telegram message processing crashes the bot update handler.
- If existing functionality under normal (200 OK) API conditions fails.
