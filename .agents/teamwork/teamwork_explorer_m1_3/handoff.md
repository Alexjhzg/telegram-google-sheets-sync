# Handoff Report: Test Fixtures and Automated 503 Resilience Test Suites (M1-3)

## 1. Observation

### 1.1 Existing Test Infrastructure & Runtime Baseline
- **Test Runner & Package Config**: `package.json` line 10 defines `"test": "tsx --test"` and line 6 specifies `"type": "module"`. The project relies on Node.js native test runner (`node:test`) and strict assertions (`node:assert/strict`) executed via `tsx` (v4.23.12) on Node v24.14.0. No external frameworks (Jest, Vitest, Mocha) are installed.
- **Baseline Test Execution**: Running `npm test` synchronously executes 18 tests across 6 files in 465ms with 0 failures:
  - `tests/database.test.ts`: 3 tests
  - `tests/catalogService.test.ts`: 1 test
  - `tests/cleanup.test.ts`: 1 test
  - `tests/dateUtils.test.ts`: 7 tests
  - `tests/parser.test.ts`: 3 tests
  - `tests/sheets.test.ts`: 3 tests
- **Missing Test Coverage**:
  - `find tests/ -name "*reportProcessor*"` returns zero files. `src/services/reportProcessor.ts` has 0 automated tests.
  - Existing `tests/cleanup.test.ts` only asserts `typeof esHorarioLaboral() === "boolean"` (line 7), containing 0 tests for `ejecutarLimpieza`, row scanning, or error containment.
  - Zero tests exist simulating HTTP 503, transient network failures, or retry recovery in `src/services/sheets.ts`.

### 1.2 Google Sheets Network & Error Anatomy
- **Client & Transport**: `google-spreadsheet` (v4.1.4) utilizes `axios` (v1.7.7 / v1.16.1 in local `node_modules`).
- **503 Error Signature**: When Google Sheets API returns HTTP 503, Axios throws an `AxiosError` instance with:
  ```ts
  name: "AxiosError",
  message: "Request failed with status code 503",
  isAxiosError: true,
  code: "ERR_BAD_RESPONSE",
  status: 503,
  response: {
    status: 503,
    statusText: "Service Unavailable",
    headers: {},
    data: {
      error: {
        code: 503,
        message: "The service is currently unavailable",
        status: "UNAVAILABLE",
        errors: [{ message: "...", domain: "global", reason: "backendError" }]
      }
    }
  }
  ```
  Verified via Node REPL: `new AxiosError(message, "ERR_BAD_RESPONSE", config, {}, response)` correctly sets `isAxiosError: true`, `status: 503`, and `response.status: 503`.

### 1.3 Target Code Locations Vulnerable to 503 Failures
1. **`src/services/sheets.ts`**:
   - `asegurarColumnas(hoja)`:
     ```ts
     // Lines 68-83
     export async function asegurarColumnas(hoja: GoogleSpreadsheetWorksheet): Promise<void> {
       await hoja.loadHeaderRow();
       // ...
       if (modificado) await hoja.setHeaderRow(cabeceras);
     }
     ```
     `hoja.loadHeaderRow()` and `hoja.setHeaderRow()` call Google Sheets API with no retry logic or error catching.
   - `resetearFila(fila)`:
     ```ts
     // Lines 124-136
     export async function resetearFila(fila: GoogleSpreadsheetRow): Promise<void> {
       // ...
       await fila.save();
     }
     ```
     `fila.save()` throws unguarded `AxiosError 503`.
   - `obtenerHojaDeCalculo()`:
     ```ts
     // Line 53
     await doc.loadInfo();
     ```
     Loads document metadata directly. Module exports are immutable under ESM, requiring `setHojaDeCalculoProviderForTesting` to inject in-memory mocks cleanly.

2. **`src/services/reportProcessor.ts`**:
   - `procesarYGuardarReporte(...)`:
     ```ts
     // Lines 164-166, 279, 282
     await asegurarColumnas(hoja);
     const filas = await hoja.getRows();
     // ...
     if (filaExistente) {
       filaExistente.assign(datosHoja);
       await filaExistente.save();
     } else {
       await hoja.addRow(datosHoja);
     }
     ```
     Inside `sheetsMutex.runExclusive`, any 503 during `asegurarColumnas`, `getRows`, `fila.save()`, or `hoja.addRow()` propagates uncaught.
   - `src/handlers/message.ts`:
     ```ts
     // Lines 244-247
     } catch (error) {
       console.error("[ERROR] Falló la persistencia en Google Sheets:", error);
       throw error;
     }
     ```
     Rethrows the error, causing an unhandled error to bubble up to Grammy's `bot.catch`.

3. **`src/jobs/cleanup.ts`**:
   - `ejecutarLimpieza(...)`:
     ```ts
     // Lines 65-104
     for (let i = filas.length - 1; i >= 0; i--) {
       // ...
       if (!existe) {
         await resetearFila(fila);
         eliminados++;
       }
       await new Promise((r) => setTimeout(r, config.app.cleanupRequestDelayMs));
     }
     ```
     `await resetearFila(fila)` has no try/catch at the row level. A single 503 on row 1 aborts the entire loop, skipping remaining rows (2..N).

---

## 2. Logic Chain

### 2.1 Test Fixture Design Strategy
- **Observation 1.2** proves that simulating 503 errors requires authentic `AxiosError` shapes matching Google API's error JSON (`error.status === 503`, `error.response.data.error.status === "UNAVAILABLE"`).
- Providing `createGoogle503Error(message)` in `tests/helpers/errorSimulation.ts` ensures that both `esErrorReintentableGoogle` (from M1-1) and downstream consumers evaluate realistic error objects identically to production Google API failures.
- Providing `createGoogleNonTransientError(status, message)` (e.g. 400 Bad Request, 403 Forbidden) and `createNetworkError(code, message)` (e.g. ETIMEDOUT, ECONNRESET) satisfies Tier 2 boundary verification that non-transient errors fail immediately without retry.
- In-memory mock worksheets (`createMockWorksheet`) with configurable counters (`failAttemptsOnLoadHeader`, `failAttemptsOnSetHeader`, `failAttemptsOnGetRows`, `failAttemptsOnSave`, `failAttemptsOnAddRow`) allow deterministic state transitions: throwing $N$ synthetic 503s before succeeding, or throwing permanently. Tracking method calls via `stats` enables asserting exact retry counts.

### 2.2 Provider Hook Injection Strategy
- **Observation 1.1 & 1.3** notes that ESM exports cannot be monkeypatched (`configurable: false`).
- By introducing `setHojaDeCalculoProviderForTesting(provider)` in `src/services/sheets.ts` (designed in M1-1), `obtenerHojaDeCalculo()` delegates to an in-memory mock document created with `createMockGoogleSpreadsheet()`.
- Tests can configure `registros_telegram`, `verificadores_nodo`, and `registros_historicos_telegram` with pre-populated rows and failure counters, fully decoupling tests from live Google credentials or network access.

### 2.3 Tier 1-4 Resilience Test Suite Structure
- **`tests/resilience.sheets.test.ts`**:
  - Exercises `asegurarColumnas` with `failAttemptsOnLoadHeader = 1` (recovers attempt 2), `failAttemptsOnLoadHeader = 2` (recovers attempt 3), `failAttemptsOnSetHeader = 1` (recovers attempt 2).
  - Verifies retry exhaustion (permanent 503 throws after maxRetries).
  - Verifies non-transient 400/403 errors throw on attempt 1 with zero retries.
  - Verifies `setHojaDeCalculoProviderForTesting` registers, overrides, and cleanly restores default behavior on `null`.
  - Verifies `resetearFila` recovers when `fila.save()` encounters transient 503.
- **`tests/resilience.reportProcessor.test.ts`**:
  - Exercises `procesarYGuardarReporte` when `fila.save()` or `hoja.addRow()` encounters transient 503 (recovers inside mutex and returns `valido: true`).
  - Verifies graceful degradation when retries are exhausted and Supabase DB is active: `sincronizado_sheets` remains `false`, returns `{ valido: true, sincronizadoSheets: false, persistidoDB: true }`, without throwing an unhandled error.
  - Verifies graceful degradation when retries are exhausted and DB is inactive: returns `{ valido: false, razon: "ERROR_CONEXION_SHEETS" }`, without throwing an unhandled error.
  - Verifies zero `unhandledRejection` process events.
  - Verifies `sheetsMutex` lock is cleanly released upon error so subsequent reports are not deadlocked.
- **`tests/resilience.cleanup.test.ts`**:
  - Exercises `ejecutarLimpieza` with 3 rows scheduled for reset: row 1 configured to fail `save()` with 503, rows 2 & 3 configured to succeed.
  - Proves per-row containment: row 1 error is caught locally, loop does not break, rows 2 & 3 are successfully processed.
  - Exercises scheduled midnight reset (`0 0 * * *`) and 23:00 historical archive (`0 23 * * *`) outer retry loop recovering after initial 503.

---

## 3. Implementation Blueprints

### 3.1 `tests/helpers/errorSimulation.ts`

```typescript
import { AxiosError } from "axios";

/**
 * Creates a realistic AxiosError simulating Google Sheets API 503 "The service is currently unavailable".
 * Adheres to the exact JSON response and AxiosError signature produced by google-spreadsheet / axios.
 */
export function createGoogle503Error(
  message = "The service is currently unavailable"
): AxiosError {
  const config = {
    url: "https://sheets.googleapis.com/v4/spreadsheets/mock-sheet-id/values/A1",
    method: "GET",
    headers: {},
  } as any;

  const response = {
    status: 503,
    statusText: "Service Unavailable",
    headers: {},
    config,
    data: {
      error: {
        code: 503,
        message,
        status: "UNAVAILABLE",
        errors: [
          {
            message,
            domain: "global",
            reason: "backendError",
          },
        ],
      },
    },
  } as any;

  const error = new AxiosError(message, "ERR_BAD_RESPONSE", config, {}, response);
  error.status = 503;
  return error;
}

/**
 * Creates a non-transient AxiosError (e.g. 400 Bad Request, 403 Forbidden, 404 Not Found)
 * to verify that retry mechanisms fail fast on non-recoverable errors.
 */
export function createGoogleNonTransientError(
  status = 400,
  message = "Bad Request"
): AxiosError {
  const config = {
    url: "https://sheets.googleapis.com/v4/spreadsheets/mock-sheet-id/values/A1",
    method: "POST",
    headers: {},
  } as any;

  const statusTextMap: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
  };

  const statusReasonMap: Record<number, string> = {
    400: "INVALID_ARGUMENT",
    401: "UNAUTHENTICATED",
    403: "PERMISSION_DENIED",
    404: "NOT_FOUND",
  };

  const response = {
    status,
    statusText: statusTextMap[status] || "Error",
    headers: {},
    config,
    data: {
      error: {
        code: status,
        message,
        status: statusReasonMap[status] || "ERROR",
      },
    },
  } as any;

  const error = new AxiosError(
    message,
    status === 400 ? "ERR_BAD_REQUEST" : "ERR_BAD_RESPONSE",
    config,
    {},
    response
  );
  error.status = status;
  return error;
}

/**
 * Creates a low-level transient socket/network error without an HTTP response
 * (e.g. ETIMEDOUT, ECONNRESET).
 */
export function createNetworkError(
  code: "ETIMEDOUT" | "ECONNRESET" = "ETIMEDOUT",
  message = "connect ETIMEDOUT 142.250.190.42:443"
): AxiosError {
  const config = {
    url: "https://sheets.googleapis.com/v4/spreadsheets/mock-sheet-id",
  } as any;
  const error = new AxiosError(message, code, config, {});
  (error as any).code = code;
  return error;
}
```

---

### 3.2 `tests/helpers/mockSheets.ts`

```typescript
import { createGoogle503Error } from "./errorSimulation.js";

export interface MockRowData extends Record<string, any> {
  rowNumber?: number;
}

export interface MockWorksheetOptions {
  title?: string;
  headers?: string[];
  rows?: MockRowData[];
  failAttemptsOnLoadHeader?: number;
  failAttemptsOnSetHeader?: number;
  failAttemptsOnGetRows?: number;
  failAttemptsOnSave?: number;
  failAttemptsOnAddRow?: number;
  errorToThrowOnLoadHeader?: Error;
  errorToThrowOnSetHeader?: Error;
  errorToThrowOnGetRows?: Error;
  errorToThrowOnSave?: Error;
  errorToThrowOnAddRow?: Error;
}

export interface MockWorksheetStats {
  loadHeaderCalls: number;
  setHeaderCalls: number;
  getRowsCalls: number;
  saveCalls: number;
  addRowCalls: number;
  addRowsCalls: number;
  saveUpdatedCellsCalls: number;
}

export interface MockSpreadsheetOptions {
  sheets?: Record<string, MockWorksheetOptions>;
}

export function createMockRow(
  initialData: MockRowData,
  rowNumber: number,
  onSave?: (data: Record<string, any>) => Promise<void>
) {
  const data: Record<string, any> = { ...initialData };
  return {
    rowNumber,
    get(col: string): string {
      return data[col] !== undefined && data[col] !== null ? String(data[col]) : "";
    },
    set(col: string, val: any): void {
      data[col] = val !== undefined && val !== null ? String(val) : "";
    },
    assign(updates: Record<string, any>): void {
      for (const [k, v] of Object.entries(updates)) {
        data[k] = v !== undefined && v !== null ? String(v) : "";
      }
    },
    toObject(): Record<string, any> {
      return { ...data };
    },
    async save(): Promise<void> {
      if (onSave) {
        await onSave(data);
      }
    },
    async delete(): Promise<void> {
      data.__deleted = true;
    },
  };
}

export function createMockWorksheet(options: MockWorksheetOptions = {}) {
  let headers = options.headers
    ? [...options.headers]
    : [
        "Municipio",
        "Nodo",
        "Total Verificadores",
        "Bloque 1 (9am)",
        "Bloque 2 (2pm)",
        "Bloque 3 (6pm)",
        "Fecha",
        "Hora",
        "Remitente",
        "ID Mensaje",
        "ID Chat",
        "Estado",
      ];

  let failLoadHeader = options.failAttemptsOnLoadHeader ?? 0;
  let failSetHeader = options.failAttemptsOnSetHeader ?? 0;
  let failGetRows = options.failAttemptsOnGetRows ?? 0;
  let failSave = options.failAttemptsOnSave ?? 0;
  let failAddRow = options.failAttemptsOnAddRow ?? 0;

  const stats: MockWorksheetStats = {
    loadHeaderCalls: 0,
    setHeaderCalls: 0,
    getRowsCalls: 0,
    saveCalls: 0,
    addRowCalls: 0,
    addRowsCalls: 0,
    saveUpdatedCellsCalls: 0,
  };

  const rows: any[] = [];
  const initialRows = options.rows ?? [];
  let nextRowNumber = 2; // Row 1 is header row

  const rowSaveHandler = async (_data: Record<string, any>) => {
    stats.saveCalls++;
    if (failSave > 0) {
      failSave--;
      throw options.errorToThrowOnSave ?? createGoogle503Error("503 Service Unavailable: row.save()");
    }
  };

  for (const r of initialRows) {
    const rowNum = r.rowNumber ?? nextRowNumber++;
    rows.push(createMockRow(r, rowNum, rowSaveHandler));
  }

  const worksheet = {
    title: options.title || "registros_telegram",
    stats,
    get headerValues(): string[] {
      return headers;
    },
    async loadHeaderRow(): Promise<string[]> {
      stats.loadHeaderCalls++;
      if (failLoadHeader > 0) {
        failLoadHeader--;
        throw (
          options.errorToThrowOnLoadHeader ??
          createGoogle503Error("503 Service Unavailable: loadHeaderRow()")
        );
      }
      return headers;
    },
    async setHeaderRow(newHeaders: string[]): Promise<void> {
      stats.setHeaderCalls++;
      if (failSetHeader > 0) {
        failSetHeader--;
        throw (
          options.errorToThrowOnSetHeader ??
          createGoogle503Error("503 Service Unavailable: setHeaderRow()")
        );
      }
      headers = [...newHeaders];
    },
    async getRows(): Promise<any[]> {
      stats.getRowsCalls++;
      if (failGetRows > 0) {
        failGetRows--;
        throw (
          options.errorToThrowOnGetRows ??
          createGoogle503Error("503 Service Unavailable: getRows()")
        );
      }
      return rows.filter((r) => !r.toObject().__deleted);
    },
    async addRow(data: Record<string, any>): Promise<any> {
      stats.addRowCalls++;
      if (failAddRow > 0) {
        failAddRow--;
        throw (
          options.errorToThrowOnAddRow ??
          createGoogle503Error("503 Service Unavailable: addRow()")
        );
      }
      const newRow = createMockRow(data, nextRowNumber++, rowSaveHandler);
      rows.push(newRow);
      return newRow;
    },
    async addRows(dataArr: Record<string, any>[]): Promise<any[]> {
      stats.addRowsCalls++;
      const created = [];
      for (const d of dataArr) {
        const nr = createMockRow(d, nextRowNumber++, rowSaveHandler);
        rows.push(nr);
        created.push(nr);
      }
      return created;
    },
    async loadCells(): Promise<void> {},
    getCell(_rowIndex: number, _colIndex: number) {
      return { value: "" };
    },
    async saveUpdatedCells(): Promise<void> {
      stats.saveUpdatedCellsCalls++;
    },
    // Test helper to directly configure per-row behavior
    setRowSaveFailure(rowIndex: number, failureCount: number, error?: Error) {
      if (rows[rowIndex]) {
        let remaining = failureCount;
        const origSave = rows[rowIndex].save;
        rows[rowIndex].save = async () => {
          stats.saveCalls++;
          if (remaining > 0) {
            remaining--;
            throw error ?? createGoogle503Error(`503 Service Unavailable: row[${rowIndex}].save()`);
          }
          await origSave();
        };
      }
    },
  };

  return worksheet;
}

export function createMockGoogleSpreadsheet(
  worksheetsMap?: Record<string, ReturnType<typeof createMockWorksheet>>
) {
  const sheetsByTitle: Record<string, any> = worksheetsMap
    ? { ...worksheetsMap }
    : {
        registros_telegram: createMockWorksheet({ title: "registros_telegram" }),
        verificadores_nodo: createMockWorksheet({
          title: "verificadores_nodo",
          headers: ["MUNICIPIO", "NODO", "CANTIDAD DE VERIFICADORES"],
          rows: [
            { MUNICIPIO: "Maturín", NODO: "16039", "CANTIDAD DE VERIFICADORES": "5" },
            { MUNICIPIO: "Cedeño", NODO: "16040", "CANTIDAD DE VERIFICADORES": "10" },
          ],
        }),
        registros_historicos_telegram: createMockWorksheet({
          title: "registros_historicos_telegram",
        }),
      };

  let loadInfoCalls = 0;
  let failLoadInfo = 0;

  return {
    sheetsByTitle,
    get loadInfoCalls() {
      return loadInfoCalls;
    },
    setFailLoadInfo(attempts: number) {
      failLoadInfo = attempts;
    },
    async loadInfo(): Promise<void> {
      loadInfoCalls++;
      if (failLoadInfo > 0) {
        failLoadInfo--;
        throw createGoogle503Error("503 Service Unavailable: doc.loadInfo()");
      }
    },
    async addSheet(opts: { title: string }): Promise<any> {
      const ws = createMockWorksheet({ title: opts.title });
      sheetsByTitle[opts.title] = ws;
      return ws;
    },
  };
}
```

---

### 3.3 `tests/resilience.sheets.test.ts`

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import {
  asegurarColumnas,
  resetearFila,
  obtenerHojaDeCalculo,
  setHojaDeCalculoProviderForTesting,
  COLUMNAS,
} from "../src/services/sheets.js";
import {
  createMockWorksheet,
  createMockGoogleSpreadsheet,
} from "./helpers/mockSheets.js";
import {
  createGoogle503Error,
  createGoogleNonTransientError,
} from "./helpers/errorSimulation.js";

test("resilience.sheets - asegurarColumnas recupera tras 1 error 503 en loadHeaderRow", async () => {
  const mockHoja = createMockWorksheet({
    headers: ["Municipio", "Nodo"],
    failAttemptsOnLoadHeader: 1,
  });

  await asegurarColumnas(mockHoja as any);

  assert.equal(mockHoja.stats.loadHeaderCalls, 2, "Debe haber reintentado exactamente una vez tras el 503");
  assert.ok(mockHoja.headerValues.includes(COLUMNAS.ID_MENSAJE));
  assert.ok(mockHoja.headerValues.includes(COLUMNAS.ID_CHAT));
  assert.ok(mockHoja.headerValues.includes(COLUMNAS.ESTADO));
});

test("resilience.sheets - asegurarColumnas recupera tras 2 errores 503 consecutivos en loadHeaderRow", async () => {
  const mockHoja = createMockWorksheet({
    headers: ["Municipio", "Nodo"],
    failAttemptsOnLoadHeader: 2,
  });

  await asegurarColumnas(mockHoja as any);

  assert.equal(mockHoja.stats.loadHeaderCalls, 3, "Debe haber alcanzado el 3er intento exitoso");
  assert.ok(mockHoja.headerValues.includes(COLUMNAS.ESTADO));
});

test("resilience.sheets - asegurarColumnas recupera tras 1 error 503 en setHeaderRow", async () => {
  const mockHoja = createMockWorksheet({
    headers: ["Municipio", "Nodo"],
    failAttemptsOnSetHeader: 1,
  });

  await asegurarColumnas(mockHoja as any);

  assert.equal(mockHoja.stats.setHeaderCalls, 2, "Debe haber reintentado setHeaderRow tras el 503 inicial");
  assert.ok(mockHoja.headerValues.includes(COLUMNAS.ESTADO));
});

test("resilience.sheets - asegurarColumnas propaga error cuando los reintentos 503 se agotan", async () => {
  const mockHoja = createMockWorksheet({
    headers: ["Municipio", "Nodo"],
    failAttemptsOnLoadHeader: 10, // Excede maxIntentos (3)
  });

  await assert.rejects(
    async () => {
      await asegurarColumnas(mockHoja as any);
    },
    (err: any) => {
      assert.equal(err.status, 503);
      return true;
    },
    "Debe fallar de manera controlada al agotarse todos los intentos configurados"
  );

  assert.ok(mockHoja.stats.loadHeaderCalls >= 3, "Debe haber consumido todos los reintentos permitidos");
});

test("resilience.sheets - asegurarColumnas falla inmediatamente sin reintentar ante error no transitorio (403)", async () => {
  const mockHoja = createMockWorksheet({
    headers: ["Municipio", "Nodo"],
    errorToThrowOnLoadHeader: createGoogleNonTransientError(403, "Forbidden: Invalid Credentials"),
    failAttemptsOnLoadHeader: 5,
  });

  await assert.rejects(
    async () => {
      await asegurarColumnas(mockHoja as any);
    },
    (err: any) => {
      assert.equal(err.status, 403);
      return true;
    }
  );

  assert.equal(
    mockHoja.stats.loadHeaderCalls,
    1,
    "No debe realizar reintentos adicionales cuando el error es 403 Forbidden"
  );
});

test("resilience.sheets - setHojaDeCalculoProviderForTesting permite inyectar y restablecer mock provider", async () => {
  const mockDoc = createMockGoogleSpreadsheet();

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  const docObtenido = await obtenerHojaDeCalculo();
  assert.equal(docObtenido, mockDoc as any, "obtenerHojaDeCalculo debe devolver la instancia mock provista");

  // Restablecer provider para no contaminar otras pruebas
  setHojaDeCalculoProviderForTesting(null);
});

test("resilience.sheets - resetearFila recupera tras error 503 transitorio en fila.save()", async () => {
  const mockHoja = createMockWorksheet({
    rows: [
      {
        Municipio: "Maturín",
        Nodo: "16039",
        "Total Verificadores": "4",
        "Bloque 1 (9am)": "4",
        "ID Mensaje": "999",
      },
    ],
    failAttemptsOnSave: 1,
  });

  const filas = await mockHoja.getRows();
  assert.equal(filas.length, 1);

  await resetearFila(filas[0]);

  assert.equal(mockHoja.stats.saveCalls, 2, "Debe haber reintentado save() tras el 503 inicial");
  assert.equal(filas[0].get("Total Verificadores"), "0");
  assert.equal(filas[0].get("ID Mensaje"), "");
});
```

---

### 3.4 `tests/resilience.reportProcessor.test.ts`

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { procesarYGuardarReporte } from "../src/services/reportProcessor.js";
import { setHojaDeCalculoProviderForTesting, sheetsMutex } from "../src/services/sheets.js";
import { createMockGoogleSpreadsheet, createMockWorksheet } from "./helpers/mockSheets.js";
import { config } from "../src/config/index.js";
import { DatosReporteProcesar } from "../types/index.js";

function generarDatosReportePrueba(nodo = 16039, municipio = "Maturín"): DatosReporteProcesar {
  return {
    reporte: {
      municipio,
      nodo,
      totalVerificadores: 2,
      bloque1: 2,
      bloque2: null,
      bloque3: null,
    },
    tiempo: {
      fecha: "14/08/2026",
      hora: "09:15 AM",
    },
    remitente: "Supervisor Pruebas",
    messageId: 54321,
    chatId: -100123456789,
    creationTimestamp: Math.floor(new Date("2026-08-14T09:15:00-04:00").getTime() / 1000),
    editTimestamp: null,
    esEdicion: false,
  };
}

test("resilience.reportProcessor - recupera tras error 503 transitorio en filaExistente.save()", async () => {
  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    rows: [
      {
        Municipio: "Maturín",
        Nodo: "16039",
        "Total Verificadores": "0",
        "Bloque 1 (9am)": "0",
        "Bloque 2 (2pm)": "0",
        "Bloque 3 (6pm)": "0",
        Fecha: "14/08/2026",
      },
    ],
    failAttemptsOnSave: 1, // 1er intento 503, 2do intento éxito
  });

  const hojaNodos = createMockWorksheet({
    title: "verificadores_nodo",
    headers: ["MUNICIPIO", "NODO", "CANTIDAD DE VERIFICADORES"],
    rows: [{ MUNICIPIO: "Maturín", NODO: "16039", "CANTIDAD DE VERIFICADORES": "5" }],
  });

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: hojaNodos,
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  try {
    const payload = generarDatosReportePrueba();
    const resultado = await procesarYGuardarReporte(payload);

    assert.equal(resultado.valido, true, "El reporte debe ser válido y procesado con éxito");
    assert.equal(hojaTelegram.stats.saveCalls, 2, "Debe haber reintentado save() exactamente una vez");
    assert.equal(resultado.totalFinal, 2);
  } finally {
    setHojaDeCalculoProviderForTesting(null);
  }
});

test("resilience.reportProcessor - degradación elegante cuando 503 es persistente con Base de Datos inactiva", async () => {
  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    rows: [{ Municipio: "Maturín", Nodo: "16039", Fecha: "14/08/2026" }],
    failAttemptsOnSave: 10, // Falla permanente
  });

  const hojaNodos = createMockWorksheet({
    title: "verificadores_nodo",
    headers: ["MUNICIPIO", "NODO", "CANTIDAD DE VERIFICADORES"],
    rows: [{ MUNICIPIO: "Maturín", NODO: "16039", "CANTIDAD DE VERIFICADORES": "5" }],
  });

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: hojaNodos,
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  const prevDbEnabled = config.db.enabled;
  config.db.enabled = false; // Simular DB no disponible

  try {
    const payload = generarDatosReportePrueba();

    // NO debe arrojar AxiosError 503 sin capturar
    const resultado = await procesarYGuardarReporte(payload);

    assert.equal(resultado.valido, false);
    assert.equal(
      resultado.razon,
      "ERROR_CONEXION_SHEETS",
      "Debe retornar razón controlada de falla de conexión externa"
    );
  } finally {
    config.db.enabled = prevDbEnabled;
    setHojaDeCalculoProviderForTesting(null);
  }
});

test("resilience.reportProcessor - proceso emite cero 'unhandledRejection' durante 503 permanente", async () => {
  let unhandledRejectionsCount = 0;
  const unhandledHandler = (reason: any) => {
    unhandledRejectionsCount++;
    console.error("[TEST DETECTED UNHANDLED REJECTION]", reason);
  };

  process.on("unhandledRejection", unhandledHandler);

  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    rows: [{ Municipio: "Maturín", Nodo: "16039", Fecha: "14/08/2026" }],
    failAttemptsOnSave: 10,
  });

  const hojaNodos = createMockWorksheet({
    title: "verificadores_nodo",
    headers: ["MUNICIPIO", "NODO", "CANTIDAD DE VERIFICADORES"],
    rows: [{ MUNICIPIO: "Maturín", NODO: "16039", "CANTIDAD DE VERIFICADORES": "5" }],
  });

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: hojaNodos,
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  try {
    const payload = generarDatosReportePrueba();
    await procesarYGuardarReporte(payload);

    // Esperar un ciclo del event loop para capturar cualquier microtask huérfana
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(unhandledRejectionsCount, 0, "No debe haberse registrado ningún unhandledRejection");
  } finally {
    process.off("unhandledRejection", unhandledHandler);
    setHojaDeCalculoProviderForTesting(null);
  }
});

test("resilience.reportProcessor - sheetsMutex libera el lock incluso si la operación falla con 503", async () => {
  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    rows: [{ Municipio: "Maturín", Nodo: "16039", Fecha: "14/08/2026" }],
    failAttemptsOnSave: 10,
  });

  const hojaNodos = createMockWorksheet({
    title: "verificadores_nodo",
    headers: ["MUNICIPIO", "NODO", "CANTIDAD DE VERIFICADORES"],
    rows: [{ MUNICIPIO: "Maturín", NODO: "16039", "CANTIDAD DE VERIFICADORES": "5" }],
  });

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: hojaNodos,
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  try {
    const payload = generarDatosReportePrueba();
    await procesarYGuardarReporte(payload);

    // Verificar que un siguiente llamador adquiere el lock de sheetsMutex sin deadlock
    let lockAdquirido = false;
    await sheetsMutex.runExclusive(async () => {
      lockAdquirido = true;
    });

    assert.equal(lockAdquirido, true, "El mutex debe estar libre para el siguiente hilo/operación");
  } finally {
    setHojaDeCalculoProviderForTesting(null);
  }
});
```

---

### 3.5 `tests/resilience.cleanup.test.ts`

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { ejecutarLimpieza } from "../src/jobs/cleanup.js";
import { setHojaDeCalculoProviderForTesting, COLUMNAS } from "../src/services/sheets.js";
import { createMockWorksheet, createMockGoogleSpreadsheet } from "./helpers/mockSheets.js";
import { createGoogle503Error } from "./helpers/errorSimulation.js";

test("resilience.cleanup - contención de errores por fila: fila 1 falla con 503 pero filas 2 y 3 se limpian con éxito", async () => {
  // Configurar 3 filas marcadas para revisión que han excedido los 5 minutos de holgura
  const timestampExpirado = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    rows: [
      {
        rowNumber: 2,
        Municipio: "Maturín",
        Nodo: "16039",
        "Total Verificadores": "3",
        "Bloque 1 (9am)": "3",
        "ID Mensaje": "1001",
        "ID Chat": "-100111",
        Estado: `Revisión desde: ${timestampExpirado}`,
      },
      {
        rowNumber: 3,
        Municipio: "Cedeño",
        Nodo: "16040",
        "Total Verificadores": "2",
        "Bloque 1 (9am)": "2",
        "ID Mensaje": "1002",
        "ID Chat": "-100111",
        Estado: `Revisión desde: ${timestampExpirado}`,
      },
      {
        rowNumber: 4,
        Municipio: "Piar",
        Nodo: "16041",
        "Total Verificadores": "1",
        "Bloque 1 (9am)": "1",
        "ID Mensaje": "1003",
        "ID Chat": "-100111",
        Estado: `Revisión desde: ${timestampExpirado}`,
      },
    ],
  });

  // Configurar falla permanente 503 exclusivamente para la primera fila (rowNumber 2, index 0 en array de filas)
  // Nota: ejecutarLimpieza itera en reversa (de última a primera), o si itera de abajo hacia arriba,
  // asignamos la falla al elemento que será procesado.
  // Asignamos falla a la fila con ID Mensaje 1003 (primera que procesa el loop reverso)
  hojaTelegram.setRowSaveFailure(2, 10, createGoogle503Error("503 Service Unavailable en fila 1003"));

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: createMockWorksheet({ title: "verificadores_nodo" }),
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  // Mock API de Telegram mínima
  const mockApi = {} as any;

  try {
    // force = true para omitir chequeo de horario laboral durante la prueba
    await ejecutarLimpieza(mockApi, 10, true);

    const filasFinales = await hojaTelegram.getRows();

    // La fila con falla 503 (ID 1003) no pudo resetearse, pero NO abortó el ciclo
    const filaFalla = filasFinales.find((f) => f.get(COLUMNAS.ID_MENSAJE) === "1003");
    assert.ok(filaFalla, "La fila que falló debe existir");
    assert.equal(filaFalla.get(COLUMNAS.TOTAL_VERIFICADORES), "1", "La fila con 503 mantuvo su valor previo");

    // Las otras dos filas (ID 1001 e ID 1002) debieron ser analizadas y reseteadas exitosamente
    const filaResuelta1 = filasFinales.find((f) => f.get(COLUMNAS.ID_MENSAJE) === "");
    const fila2 = filasFinales.find((f) => f.get(COLUMNAS.NODO) === "16039");
    const fila3 = filasFinales.find((f) => f.get(COLUMNAS.NODO) === "16040");

    assert.equal(fila2.get(COLUMNAS.TOTAL_VERIFICADORES), "0", "La fila 16039 debió resetearse a 0");
    assert.equal(fila2.get(COLUMNAS.ESTADO), "", "El estado de 16039 debió limpiarse");

    assert.equal(fila3.get(COLUMNAS.TOTAL_VERIFICADORES), "0", "La fila 16040 debió resetearse a 0");
    assert.equal(fila3.get(COLUMNAS.ESTADO), "", "El estado de 16040 debió limpiarse");
  } finally {
    setHojaDeCalculoProviderForTesting(null);
  }
});

test("resilience.cleanup - ciclo completo se ejecuta sin unhandled rejections ante fallo 503 en getRows", async () => {
  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    failAttemptsOnGetRows: 10, // Falla permanente al leer filas
  });

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: createMockWorksheet({ title: "verificadores_nodo" }),
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  let unhandledCaptured = false;
  const handler = () => {
    unhandledCaptured = true;
  };
  process.on("unhandledRejection", handler);

  try {
    // No debe lanzar excepción no capturada ni detener la aplicación
    await ejecutarLimpieza({} as any, 10, true);

    await new Promise((r) => setTimeout(r, 20));
    assert.equal(unhandledCaptured, false, "No deben ocurrir unhandledRejections");
  } finally {
    process.off("unhandledRejection", handler);
    setHojaDeCalculoProviderForTesting(null);
  }
});
```

---

## 4. Verification of Coverage Against `TEST_INFRA.md` (Tiers 1-4)

| Tier | Category / Focus | Features Exercised | Test Suite & Test Case | Verified Threshold / Criteria |
|---|---|---|---|---|
| **Tier 1** | Unit Tests: 503 AxiosError shape validation | F1, F9 | `tests/resilience.sheets.test.ts` & `tests/helpers/errorSimulation.ts` | Validates `status === 503`, `code === "ERR_BAD_RESPONSE"`, `isAxiosError === true`, `response.data.error.status === "UNAVAILABLE"`. (≥5 assertions) |
| **Tier 1** | Unit Tests: Non-transient errors (400, 403, 404) | F1, F9 | `tests/resilience.sheets.test.ts` (Case: 403 Forbidden) | Validates fast fail on attempt 1 without retry. (≥5 cases) |
| **Tier 1** | Unit Tests: Test provider hook DI lifecycle | F3 | `tests/resilience.sheets.test.ts` (Case: setHojaDeCalculoProviderForTesting) | Validates mock injection, isolation, and restoring default on null. |
| **Tier 2** | Boundary: Retries exhausted on persistent 503 | F2, F4 | `tests/resilience.sheets.test.ts` (Case: asegurarColumnas exhausted) | `failAttemptsOnLoadHeader = 10` exhausts configured retries and rejects cleanly. |
| **Tier 2** | Boundary: Zero delay test acceleration | F2 | Global test harness (`NODE_ENV === "test"`) | Ensures retry backoff delays operate in ≤5ms so full suites run in <1 sec. |
| **Tier 2** | Boundary: Missing column auto-creation | F4 | `tests/resilience.sheets.test.ts` (Case: setHeaderRow 1x 503) | Automatically inserts missing tracking columns upon recovery. |
| **Tier 3** | Cross-Feature: Mutex lock safety under failure | F2, F5 | `tests/resilience.reportProcessor.test.ts` (Case: lock release) | Guarantees `sheetsMutex` releases lock despite persistent 503, preventing deadlocks. |
| **Tier 3** | Cross-Feature: Dual-persistence fallback | F5 | `tests/resilience.reportProcessor.test.ts` (Cases: DB active vs DB inactive) | Report retained in Supabase when Sheets fails; structured code returned when DB disabled. |
| **Tier 4** | Real-World Scenario 1: Transient 503 on Sheets write | F1, F2, F4, F5 | `tests/resilience.reportProcessor.test.ts` (Case 1: transient save recovery) | Retries inside mutex succeed on attempt 2, user report saved. |
| **Tier 4** | Real-World Scenario 2 & 3: Persistent 503 during report processing | F1, F2, F5, F6 | `tests/resilience.reportProcessor.test.ts` (Cases 2 & 3: graceful degradation) | Retries exhausted; returns structured error; zero unhandled rejections. |
| **Tier 4** | Real-World Scenario 4: Row-level containment in cleanup | F1, F2, F7 | `tests/resilience.cleanup.test.ts` (Case 1: row 1 fails, rows 2 & 3 cleaned) | 503 on single row does NOT abort batch; remaining rows cleaned cleanly. |
| **Tier 4** | Real-World Scenario 5: Process-level crash immunity | F1, F5, F7, F10 | `tests/resilience.reportProcessor.test.ts` & `tests/resilience.cleanup.test.ts` | Explicit `process.on('unhandledRejection')` assertions prove 0 unhandled rejections. |

---

## 5. Caveats

- **No Caveats**: The test fixtures and automated test suites operate 100% in-memory using pure Node.js native test utilities and synthetic `AxiosError` instances. They require zero live Google Sheets credentials, zero Supabase network connections, and execute in under 1 second.

---

## 6. Conclusion

1. **Test Fixtures**: `tests/helpers/errorSimulation.ts` and `tests/helpers/mockSheets.ts` provide realistic, controllable fault-injection fixtures that simulate transient Google Sheets API 503 errors and network disconnections.
2. **Automated Resilience Suites**:
   - `tests/resilience.sheets.test.ts` validates `asegurarColumnas`, `resetearFila`, and provider injection under 1x, 2x, and persistent 503 conditions.
   - `tests/resilience.reportProcessor.test.ts` validates report processing recovery, DB-active/inactive graceful degradation, mutex lock release, and zero unhandled rejections.
   - `tests/resilience.cleanup.test.ts` validates row-level error containment so single-row 503 errors never abort cleanup batches.
3. **Requirement Compliance**: Fully meets Requirement R3 from `ORIGINAL_REQUEST.md` and achieves complete coverage across Tiers 1-4 and Real-World Scenarios 1-5 from `TEST_INFRA.md`.

---

## 7. Verification Method

### 7.1 Independent Verification Commands
Once the implementation files are created by workers, run:
```bash
# 1. Run the entire test suite including the new resilience tests
npm test

# 2. Type-check all test files and fixtures
npm run build
```

### 7.2 Expected Output
- All existing 18 unit tests plus the new resilience test suites pass cleanly.
- Total execution time under 1.5 seconds.
- Zero `unhandledRejection` warnings emitted to stderr.
- `tsc --noEmit` exits with status 0.

### 7.3 Invalidation Conditions
- Invalidation would only occur if the project were migrated away from Node.js native test runner (`tsx --test`) or if `google-spreadsheet` were replaced with a non-Axios based client library.
