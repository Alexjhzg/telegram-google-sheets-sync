# Handoff Report — Testing Infrastructure, Baseline Health & 503 Simulation Strategy

## 1. Observation

### 1.1 Tooling, Dependencies, and Scripts
- **`package.json`**:
  - Module format: `"type": "module"` (native ES Modules).
  - Node engine: `node: ">=20.0.0"`. Active environment runtime: Node `v24.14.0`.
  - Scripts:
    - `"build": "tsc --noEmit"`
    - `"test": "tsx --test"`
    - `"start": "tsx bot.ts"`
  - Testing Framework: No third-party test framework (Jest, Vitest, Mocha) is installed. The repository relies strictly on the Node.js native test runner (`node:test`) and assertion library (`node:assert`, `node:assert/strict`) executed directly by `tsx` (`^4.23.12`).
  - Google API clients in `package.json`:
    - `"google-spreadsheet": "^4.1.4"` (internally depends on `axios: "^1.7.7"`)
    - `"google-auth-library": "^9.11.0"` (internally depends on `gaxios`)
  - Telegram bot framework: `"grammy": "^1.27.0"`.
  - Database: `"@supabase/supabase-js": "^2.45.4"`.
- **`tsconfig.json`**:
  - `"target": "ES2022"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"types": ["node"]`, `"strict": false`.
  - Test files import application modules using explicit `.js` extensions (e.g., `import { ... } from "../src/services/sheets.js"`).

### 1.2 Baseline Health and Test Execution
- Executing `npm test` (`tsx --test`):
  ```
  ✔ database - reconciliarCatalogoNodosDB maneja BD inactiva retornando error adecuado (0.441744ms)
  ✔ catalogService - sincronizarCatalogoDesdeSheets expone propiedad eliminados en resultado con DB inactiva (0.08526ms)
  ✔ cleanup - esHorarioLaboral retorna un valor booleano válido (9.264912ms)
  ✔ database - esDBActiva retorna un booleano sin fallar (0.472431ms)
  ✔ database - obtenerClienteDB retorna null si no están configuradas las variables de BD (0.079906ms)
  ▶ Pruebas de estandarización de fechas (dateUtils)
    ✔ Debe estandarizar formato D/M/YYYY y DD/MM/YYYY a DD/MM/YYYY (1.040544ms)
    ✔ Debe estandarizar formato ISO YYYY-MM-DD y YYYY/MM/DD a DD/MM/YYYY (0.117726ms)
    ✔ Debe estandarizar formato guiones DD-MM-YYYY a DD/MM/YYYY (0.07934ms)
    ✔ Debe estandarizar cadenas con timestamp o ISO completas (0.070825ms)
    ✔ Debe estandarizar número de serie de Excel/Google Sheets (0.136827ms)
    ✔ Debe retornar null para valores vacíos o inválidos (0.08838ms)
    ✔ obtenerFechaHoyEstandar debe retornar formato DD/MM/YYYY válido (16.402901ms)
  ✔ Pruebas de estandarización de fechas (dateUtils) (18.655557ms)
  ✔ parser - parsearReporte extrae correctamente todos los datos (1.467096ms)
  ✔ parser - parsearReporte devuelve null si falta municipio o nodo (0.458493ms)
  ✔ parser - obtenerBloqueYHoraActivo determina correctamente bloques según horario (12.382215ms)
  ✔ sheets - normalizarTexto elimina tildes, mayúsculas y espacios extra (0.535638ms)
  ✔ sheets - buscarFilaPorNodo encuentra la fila independientemente de tildes o mayúsculas (0.178912ms)
  ✔ sheets - obtenerUltimosValores recupera correctamente los valores acumulados (0.15966ms)
  ℹ tests 18
  ℹ suites 1
  ℹ pass 18
  ℹ fail 0
  ℹ duration_ms 444.714804
  ```
- Executing `npm run build` (`tsc --noEmit`): Exits cleanly with code 0.

### 1.3 Inspection of Existing Tests for `sheets.ts`, `reportProcessor.ts`, and `cleanup.ts`
- **`tests/sheets.test.ts`**:
  - Tests only 3 pure helper functions: `normalizarTexto`, `buscarFilaPorNodo`, `obtenerUltimosValores` (lines 5-65).
  - Uses hardcoded in-memory arrays of mock row objects (`{ get: (col) => ..., toObject: () => ... }`).
  - Completely lacks tests for:
    - `asegurarColumnas(hoja)`
    - `obtenerHojaDeCalculo()`
    - `resetearFila(fila)`
    - `guardarHistoricoDiario(doc, fecha)`
    - `resetearFilasDeDiasAnteriores(doc)`
  - Zero async calls or network simulation.
- **`tests/cleanup.test.ts`**:
  - Only contains 8 lines testing `esHorarioLaboral()` (lines 5-8):
    ```ts
    test("cleanup - esHorarioLaboral retorna un valor booleano válido", () => {
      const enHorario = esHorarioLaboral();
      assert.equal(typeof enHorario, "boolean");
    });
    ```
  - Completely lacks tests for `ejecutarLimpieza(api, ...)` or `programarLimpieza(api)`.
- **`reportProcessor.ts`**:
  - **No test file exists.** Searching for `reportProcessor` across `tests/` yielded 0 matches.
  - Core functions `procesarYGuardarReporte`, `eliminarReporte`, and `marcarFilaParaRevision` have 0% test coverage.

### 1.4 How Dependencies Are Currently Handled in Tests
- **Google Sheets**: Only simple JavaScript plain objects are passed to synchronous row search helpers in `tests/sheets.test.ts`. `GoogleSpreadsheet` and `GoogleSpreadsheetWorksheet` instances are not instantiated or mocked.
- **Telegram Bot (`grammy`)**: Not mocked anywhere in existing tests.
- **Database (`@supabase/supabase-js`)**: Tests in `tests/database.test.ts` and `tests/catalogService.test.ts` use conditional branching `if (!esDBActiva())` rather than mocking the Supabase client.
- **ESM Mocking Constraint**:
  - Attempting to monkeypatch or spy on exported module functions via `mock.method(sheetsModule, "obtenerHojaDeCalculo")` fails in Node.js ESM with:
    `The argument 'methodName' must be a method. Received undefined`.
  - Directly verifying the property descriptor of `sheets.obtenerHojaDeCalculo` confirmed:
    `{ get: [Function: get], set: undefined, enumerable: true, configurable: false }`.
  - In native ESM, module namespace exports are immutable getter bindings.

### 1.5 Codebase Crash Points Under 503 Errors
- **`src/services/sheets.ts` (`asegurarColumnas`)**:
  - Lines 69-83: `await hoja.loadHeaderRow()` and `await hoja.setHeaderRow(cabeceras)` have no try/catch or retry logic. If Google Sheets returns 503, an AxiosError is thrown directly to the caller.
- **`src/services/reportProcessor.ts`**:
  - Line 164: Calls `await asegurarColumnas(hoja)` without error handling.
  - Line 166: Calls `await hoja.getRows()`.
  - Lines 279-282: Calls `await filaExistente.save()` or `await hoja.addRow(datosHoja)`.
  - Any 503 exception thrown here bubbles up to `src/handlers/message.ts` (lines 244-247):
    ```ts
    } catch (error) {
      console.error("[ERROR] Falló la persistencia en Google Sheets:", error);
      throw error;
    }
    ```
    This rethrow causes an unhandled rejection in the Telegram update handler.
- **`src/jobs/cleanup.ts` (`ejecutarLimpieza`)**:
  - Line 60: Calls `await hoja.getRows()`.
  - Line 99: Calls `await resetearFila(fila)`.
  - While lines 111-113 catch errors with `console.error`, a single 503 on `getRows()` or `fila.save()` terminates the entire cleanup cycle prematurely without retrying or processing subsequent rows.

---

## 2. Logic Chain

1. **Test Runner Selection**:
   - Observations 1.1 and 1.2 demonstrate that `tsx --test` runs Node.js built-in `node:test` and `node:assert/strict` with full TypeScript support, executing all 18 existing tests in 444ms without any external dependencies.
   - Therefore, introducing Jest, Vitest, or Mocha is unnecessary, would add dependency bloat, and would complicate ESM module resolution. The project should standardize on `node:test` + `tsx --test`.

2. **Root Cause of Test Gaps**:
   - Observation 1.3 shows `reportProcessor.ts` has 0 tests, `cleanup.ts` only tests a pure boolean function, and `sheets.ts` only tests string/row filtering.
   - Because `obtenerHojaDeCalculo()` (Observation 1.1) throws a fatal error when environment variables (`GOOGLE_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`) are missing, any test calling functions that invoke `obtenerHojaDeCalculo()` directly would fail without mocks.
   - Therefore, the lack of an injection or provider mechanism for `obtenerHojaDeCalculo` is the primary blocker that previously prevented integration and error tests.

3. **ESM Mocking Strategy**:
   - Observation 1.4 confirms that native Node.js ESM exports cannot be monkeypatched via `mock.method(module, "exportName")` due to immutable getter descriptors.
   - However, functions like `asegurarColumnas(hoja)` accept `hoja` as a parameter directly.
   - Furthermore, in `sheets.ts`, exposing a lightweight test provider hook (e.g. `setHojaDeCalculoProviderForTesting(provider)`) allows `obtenerHojaDeCalculo()` to return a mock document during tests without modifying external API signatures.
   - Once a mock object (`mockHoja`, `mockDoc`) is passed or provided, its methods (`loadHeaderRow`, `getRows`, `save`) are standard mutable object methods that can be spied on, mocked, or configured to throw synthetic 503 errors.

4. **503 Simulation Fidelity**:
   - Observation 1.1 identifies `google-spreadsheet` v4.1.4 as using `axios` v1.7.7, and `google-auth-library` as using `gaxios`.
   - Google API 503 responses surface as `AxiosError` or `GaxiosError` instances with `status: 503`, `code: "ERR_BAD_RESPONSE"` or `"503"`, and message `"The service is currently unavailable"`.
   - Simulating these exact error shapes via a helper `createGoogle503Error(message)` guarantees 100% realistic fault injection during unit, component, resilience, and E2E testing.

5. **Multi-Tiered Testing Strategy**:
   - A single tier of tests cannot simultaneously verify arithmetic edge cases and end-to-end bot fault tolerance.
   - Establishing a 4-Tier test taxonomy (Unit -> Component -> Fault Injection / 503 Resilience -> E2E Lifecycle) directly aligns with project milestones and guarantees both baseline correctness and resilient recovery.

---

## 3. Caveats

- **No live Google credentials in CI / local test environment**: Automated tests must never depend on real Google Sheets network connections or live service accounts. All automated 503 simulation tests must execute against mock sheets/worksheets.
- **Mutex serialization during retries**: Because `sheetsMutex.runExclusive` wraps operations in `reportProcessor.ts` and `cleanup.ts`, retry delays in test environments must be configured to low values (e.g., 1ms-5ms) to prevent tests from timing out or blocking test runners.
- **Dual persistence**: In `reportProcessor.ts`, Supabase DB is updated before Google Sheets. When Sheets throws 503, the test harness must verify whether the DB write succeeded and whether `marcarReporteSincronizadoDB` is skipped appropriately.

---

## 4. Conclusion & Recommendations

### 4.1 Development and Testing Tooling Recommendations
- **Maintain `node:test` + `tsx --test`**: Retain `"test": "tsx --test"` in `package.json`. It executes quickly, natively supports TypeScript via `tsx`, and requires no additional dependencies.
- **Add Test Script Variations in `package.json`**:
  - `"test": "tsx --test"` (runs all tests)
  - `"test:unit": "tsx --test tests/**/*.test.ts"`
  - `"test:watch": "tsx --test --watch"`

### 4.2 Document Provider Hook for Test Mocking
In `src/services/sheets.ts`, implement a non-intrusive provider hook to allow test suites to supply mock spreadsheets:
```ts
// src/services/sheets.ts
let testDocProvider: (() => Promise<GoogleSpreadsheet>) | null = null;

export function setHojaDeCalculoProviderForTesting(
  provider: (() => Promise<GoogleSpreadsheet>) | null
): void {
  testDocProvider = provider;
}

export async function obtenerHojaDeCalculo(): Promise<GoogleSpreadsheet> {
  if (testDocProvider) {
    return testDocProvider();
  }
  if (docPromise) {
    return docPromise;
  }
  // existing production initialization...
}
```

### 4.3 Google Sheets 503 Error Simulation Helper
Create `tests/helpers/errorSimulation.ts` to generate realistic Axios / Gaxios 503 errors:
```ts
// tests/helpers/errorSimulation.ts
export function createGoogle503Error(
  message = "The service is currently unavailable"
): Error {
  const error = new Error(message) as any;
  error.name = "AxiosError";
  error.isAxiosError = true;
  error.code = "ERR_BAD_RESPONSE";
  error.status = 503;
  error.response = {
    status: 503,
    statusText: "Service Unavailable",
    data: {
      error: {
        code: 503,
        message,
        status: "UNAVAILABLE",
      },
    },
  };
  return error;
}

export function isTransientGoogleError(error: any): boolean {
  if (!error) return false;
  const status = error.status || error.response?.status || error.code;
  if (status === 503 || status === "503" || status === 429 || status === "429" || status === 500 || status === 502 || status === 504) {
    return true;
  }
  const msg = String(error.message || "").toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("service is currently unavailable") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout")
  );
}
```

### 4.4 In-Memory Mock Worksheet & Spreadsheet Fixtures
Create `tests/helpers/mockSheets.ts` to provide fake worksheets that simulate intermittent 503 failures:
```ts
// tests/helpers/mockSheets.ts
import { createGoogle503Error } from "./errorSimulation.js";

export interface MockWorksheetOptions {
  headers?: string[];
  rows?: any[];
  failAttemptsOnLoadHeader?: number;
  failAttemptsOnSetHeader?: number;
  failAttemptsOnGetRows?: number;
  failAttemptsOnSave?: number;
}

export function createMockWorksheet(options: MockWorksheetOptions = {}) {
  let headerRowLoaded = false;
  let headers = options.headers ? [...options.headers] : ["Municipio", "Nodo"];
  let rows = options.rows ? [...options.rows] : [];
  
  let loadHeaderFails = options.failAttemptsOnLoadHeader || 0;
  let setHeaderFails = options.failAttemptsOnSetHeader || 0;
  let getRowsFails = options.failAttemptsOnGetRows || 0;
  let saveFails = options.failAttemptsOnSave || 0;

  return {
    get headerValues() {
      return headers;
    },
    async loadHeaderRow() {
      if (loadHeaderFails > 0) {
        loadHeaderFails--;
        throw createGoogle503Error("503 Service Unavailable: loadHeaderRow");
      }
      headerRowLoaded = true;
      return headers;
    },
    async setHeaderRow(newHeaders: string[]) {
      if (setHeaderFails > 0) {
        setHeaderFails--;
        throw createGoogle503Error("503 Service Unavailable: setHeaderRow");
      }
      headers = [...newHeaders];
    },
    async getRows() {
      if (getRowsFails > 0) {
        getRowsFails--;
        throw createGoogle503Error("503 Service Unavailable: getRows");
      }
      return rows;
    },
    async addRow(data: any) {
      const mockRow = {
        toObject: () => ({ ...data }),
        get: (col: string) => data[col] || "",
        set: (col: string, val: any) => { data[col] = val; },
        assign: (updates: any) => Object.assign(data, updates),
        save: async () => {
          if (saveFails > 0) {
            saveFails--;
            throw createGoogle503Error("503 Service Unavailable: save");
          }
        },
      };
      rows.push(mockRow);
      return mockRow;
    },
  };
}
```

### 4.5 Recommended Retry Utility for Production Code
Create `src/utils/retry.ts`:
```ts
export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable?: (error: any) => boolean;
  onRetry?: (error: any, attempt: number, delayMs: number) => void;
}

export async function ejecutarConReintento<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? (process.env.NODE_ENV === "test" ? 5 : 500);
  const maxDelayMs = options.maxDelayMs ?? (process.env.NODE_ENV === "test" ? 20 : 3000);
  const isRetryable = options.isRetryable ?? isTransientGoogleError;

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      if (attempt > maxRetries || !isRetryable(error)) {
        throw error;
      }
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      if (options.onRetry) {
        options.onRetry(error, attempt, delay);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
```

### 4.6 E2E Testing Track Hierarchy (Tiers 1-4)

| Tier | Name | Target Components | Test Files | Mocking Strategy |
|---|---|---|---|---|
| **Tier 1** | **Unit Tests** | Pure functions: date parser, text normalizer, message parser, accumulation calculator, schedule boolean checks, `isTransientGoogleError` predicate. | `tests/parser.test.ts`, `tests/dateUtils.test.ts`, `tests/sheets.test.ts` (pure functions), `tests/utils/retry.test.ts` | Zero network mocks; pure in-memory inputs and outputs. |
| **Tier 2** | **Component & Integration Tests** | `asegurarColumnas(hoja)` (header check and column addition), `reportProcessor.ts` happy path validation, `cleanup.ts` row scanning and message checking logic. | `tests/sheets.integration.test.ts`, `tests/reportProcessor.test.ts`, `tests/cleanup.integration.test.ts` | `createMockWorksheet()` and `createMockGoogleSpreadsheet()` with in-memory state. |
| **Tier 3** | **Fault Injection & Resilience Tests** | Simulating Google Sheets API 503 on `loadHeaderRow`, `setHeaderRow`, `getRows`, `addRow`, and `fila.save`. Testing 1x failure + recovery, 2x failure + recovery, and persistent failure + graceful degradation in `sheets.ts`, `reportProcessor.ts`, and `cleanup.ts`. | `tests/resilience.sheets.test.ts`, `tests/resilience.reportProcessor.test.ts`, `tests/resilience.cleanup.test.ts` | `createGoogle503Error()` via `failAttempts` in mock worksheets. Assert retry counts, recovery, and lack of unhandled rejections. |
| **Tier 4** | **End-to-End Workflow & Invariant Tests** | Full Telegram update processing lifecycle (`bot.handleUpdate` or invoking handlers) from inbound message text to Sheets and cleanup. Verifying: (a) valid report persists without crash; (b) 503 error logs and alerts without crashing bot; (c) cleanup completes entire batch despite individual 503 row errors; (d) zero `unhandledRejection` events. | `tests/e2e.workflow.test.ts` | Synthetic Grammy Update objects (`createMockContext()`), mock Sheets document injected via `setHojaDeCalculoProviderForTesting`, `process.on('unhandledRejection')` assertions. |

---

## 5. Verification Method

### 5.1 Command to Verify Baseline Health
Run the project test command:
```bash
npm test
```
Expected output:
- 18 tests pass across 6 test suites.
- 0 failures, 0 skipped.
- Total runtime under 1 second.

### 5.2 Command to Verify TypeScript Types
Run the project build command:
```bash
npm run build
```
Expected output:
- `tsc --noEmit` exits with status 0 and no diagnostic errors.

### 5.3 Independent Verification of Test Infrastructure Findings
1. Verify Node and tsx versions:
   ```bash
   node -v && npx tsx -v
   ```
   (Outputs `v24.14.0` and `tsx v4.23.12`).
2. Verify lack of Jest/Vitest/Mocha in dependencies:
   ```bash
   grep -E "jest|vitest|mocha" package.json
   ```
   (Exits with code 1, confirming none installed).
3. Verify lack of existing tests for `reportProcessor.ts`:
   ```bash
   find tests/ -name "*reportProcessor*"
   ```
   (Returns empty).
4. Verify ESM module descriptor immutability:
   ```bash
   npx tsx -e 'import * as s from "./src/services/sheets.ts"; console.log(Object.getOwnPropertyDescriptor(s, "obtenerHojaDeCalculo"));'
   ```
   (Shows `configurable: false`, verifying the need for the provider hook pattern rather than module monkeypatching).

### 5.4 Invalidation Conditions
This report's recommendations would be invalidated if:
1. The project migrates from native ESM (`"type": "module"`) to CommonJS.
2. A third-party test framework (such as Vitest) is explicitly requested and installed by the project maintainers.
3. Google Sheets interaction is refactored away from `google-spreadsheet` to a different client library that does not use Axios/Gaxios.
