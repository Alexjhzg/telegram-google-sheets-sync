# Project: Google Sheets 503 Resilience

## Architecture

- **Transport & Client**: `google-spreadsheet` (v4.1.4) over `axios` (v1.7.7).
- **Core Abstraction Layer**: `src/utils/retry.ts` introduces `esErrorReintentableGoogle` and `ejecutarConReintento` with exponential backoff and jitter.
- **Service Layer (`src/services/sheets.ts`)**: Wraps Sheets network operations (`loadHeaderRow`, `setHeaderRow`, `getRows`, `save`, `loadInfo`) with retry logic; exposes non-intrusive test provider hook `setHojaDeCalculoProviderForTesting`.
- **Consumer Services**:
  - `src/services/reportProcessor.ts`: Wraps Google Sheets persistence inside mutex with retries. On persistent 503, degrades gracefully if Supabase DB is active, queues sync, and prevents unhandled rejections from bubbling to `bot.catch`.
  - `src/handlers/message.ts`: Handles Sheets connection warnings gracefully instead of re-throwing unhandled errors.
  - `src/jobs/cleanup.ts`: Introduces per-row error containment in `ejecutarLimpieza`, preventing a single 503 from aborting the entire cleanup batch; adds retry loops for daily midnight reset and historical backup.
- **Testing Layer**: Node.js native test runner (`tsx --test`) with realistic 503 `AxiosError` / `GaxiosError` simulation fixtures across 4 tiers.

## Feature Inventory

| #   | Feature                                            | Description                                                                                    | Milestone | Source                    |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------- | ------------------------- |
| 1   | F1: Transient Error Classifier                     | `esErrorReintentableGoogle` detects 503, 502, 504, 429, ECONNRESET, ETIMEDOUT                  | M1        | Survey E1, E2, E3         |
| 2   | F2: Exponential Backoff & Retry Engine             | `ejecutarConReintento` with configurable attempts, backoff, jitter, and non-blocking delays    | M1        | Survey E1, E2, E3         |
| 3   | F3: Test Provider Hook                             | `setHojaDeCalculoProviderForTesting` for non-invasive mock injection without monkeypatching    | M1        | Survey E3                 |
| 4   | F4: Resilient `asegurarColumnas` & Core Sheets API | Retry on `loadHeaderRow`, `setHeaderRow`, `resetearFila`, `obtenerHojaDeCalculo`               | M1        | ORIGINAL_REQUEST §R1      |
| 5   | F5: Resilient Report Processing                    | Mutex-contained retries for Sheets writes, DB sync fallback, structured error return           | M1        | ORIGINAL_REQUEST §R1, §R2 |
| 6   | F6: Safe Message Update Handler                    | `message.ts` avoids re-throwing 503 to `bot.catch`; provides graceful user feedback            | M1        | Survey E1, E2             |
| 7   | F7: Per-Row Cleanup Containment                    | `ejecutarLimpieza` catches per-row errors so 503 on row $i$ does not abort subsequent rows     | M1        | ORIGINAL_REQUEST §R1      |
| 8   | F8: Resilient Daily Cleanup Jobs                   | Retries for midnight reset and 23:00 historical archive                                        | M1        | Survey E1, E2             |
| 9   | F9: 503 Simulation Fixtures & Error Helpers        | `createGoogle503Error` and mock worksheet helpers                                              | M1        | ORIGINAL_REQUEST §R3      |
| 10  | F10: Automated Multi-Tier Verification Suite       | Tiers 1-4 automated tests validating recovery, graceful failure, and zero unhandled rejections | M1        | ORIGINAL_REQUEST §R3      |

## Milestones

| #   | Name                                                  | Scope                                                                                                                                                                           | Dependencies | Status |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| 1   | M1: Google Sheets 503 Resilience & Verification Suite | `src/utils/retry.ts`, `src/services/sheets.ts`, `src/services/reportProcessor.ts`, `src/jobs/cleanup.ts`, `src/handlers/message.ts`, automated 503 simulation tests in `tests/` | none         | DONE   |

## Interface Contracts

### `src/utils/retry.ts` ↔ All Callers

- `esErrorReintentableGoogle(error: unknown): boolean`
  - Returns `true` if error represents HTTP 503, 502, 504, 429, or network socket disconnects.
- `ejecutarConReintento<T>(operacion: () => Promise<T>, opciones?: RetryOptions): Promise<T>`
  - Retries transient errors up to `maxIntentos` (default 3), with exponential backoff and jitter. Non-transient errors throw immediately.

### `src/services/sheets.ts` ↔ Consumers

- `asegurarColumnas(hoja: GoogleSpreadsheetWorksheet): Promise<void>`
  - Guarantees header columns exist using retry mechanism; handles transient errors gracefully.
- `setHojaDeCalculoProviderForTesting(provider: (() => Promise<GoogleSpreadsheet>) | null): void`
  - Allows tests to inject mock spreadsheets without mutating ESM module namespaces.

### `src/services/reportProcessor.ts` ↔ `src/handlers/message.ts`

- `procesarYGuardarReporte(...)`:
  - Returns `{ valido: boolean, sincronizadoSheets?: boolean, persistidoDB?: boolean, razon?: string, ... }`
  - Does NOT throw unhandled AxiosError 503.

## Code Layout

- `src/utils/retry.ts`: Core retry logic and transient error classifier
- `src/services/sheets.ts`: Google Sheets API client, header management, row operations
- `src/services/reportProcessor.ts`: Report parsing, DB persistence, Sheets persistence
- `src/handlers/message.ts`: Telegram message handling and error containment
- `src/jobs/cleanup.ts`: Row scanning, cleanup, daily resets, historical archiving
- `tests/helpers/errorSimulation.ts`: Synthetic Axios 503 error factory
- `tests/helpers/mockSheets.ts`: In-memory mock worksheet/spreadsheet with failure injectors
- `tests/resilience.sheets.test.ts`: Automated tests for sheets retry & `asegurarColumnas`
- `tests/resilience.reportProcessor.test.ts`: Automated tests for reportProcessor 503 recovery
- `tests/resilience.cleanup.test.ts`: Automated tests for cleanup row containment & recovery
