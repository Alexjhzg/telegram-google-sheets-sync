## 2026-11-06T14:50:12Z
Your identity: Worker M1 (teamwork_worker)
Your working directory: /home/seem/Documentos/_proyectos/bot-telegram/.agents/teamwork/teamwork_worker_m1
Original request file: /home/seem/Documentos/_proyectos/bot-telegram/.agents/teamwork/ORIGINAL_REQUEST.md
Scope document: /home/seem/Documentos/_proyectos/bot-telegram/PROJECT.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

You MUST read /home/seem/Documentos/_proyectos/bot-telegram/.agents/teamwork/ORIGINAL_REQUEST.md first.

Review the blueprints provided by the Explorers:
- Explorer M1-1 blueprint (retry engine, sheets.ts, re-entrant mutex): `/home/seem/Documentos/_proyectos/bot-telegram/.agents/teamwork/teamwork_explorer_m1_1/handoff.md`
- Explorer M1-2 blueprint (reportProcessor.ts, message.ts, cleanup.ts, types): `/home/seem/Documentos/_proyectos/bot-telegram/.agents/teamwork/teamwork_explorer_m1_2/handoff.md`
- Explorer M1-3 blueprint (errorSimulation.ts, mockSheets.ts, resilience test suites): `/home/seem/Documentos/_proyectos/bot-telegram/.agents/teamwork/teamwork_explorer_m1_3/handoff.md`

Your Exclusive Write Ownership:
- `src/utils/retry.ts`
- `src/utils/mutex.ts`
- `src/types/index.ts`
- `src/services/sheets.ts`
- `src/services/reportProcessor.ts`
- `src/handlers/message.ts`
- `src/jobs/cleanup.ts`
- `tests/helpers/errorSimulation.ts`
- `tests/helpers/mockSheets.ts`
- `tests/resilience.sheets.test.ts`
- `tests/resilience.reportProcessor.test.ts`
- `tests/resilience.cleanup.test.ts`

Implementation Tasks:
1. Create `src/utils/retry.ts` with `esErrorReintentableGoogle`, `ejecutarConReintento`, `configurarModoPruebasRetry`, and `RetryOptions` per Explorer M1-1's blueprint.
2. Upgrade `src/utils/mutex.ts` to support safe re-entrancy via `AsyncLocalStorage` per Explorer M1-1's blueprint.
3. Update `src/types/index.ts` adding `sincronizadoSheets?: boolean` and `persistidoDB?: boolean` to `ResultadoProcesamiento`.
4. Update `src/services/sheets.ts`:
   - Add `setHojaDeCalculoProviderForTesting(provider)`.
   - Protect `obtenerHojaDeCalculo` with `ejecutarConReintento`.
   - Wrap `asegurarColumnas(hoja)` with retry on `loadHeaderRow()` / `setHeaderRow()`, and handle persistent 503 gracefully.
   - Wrap `resetearFila` and historical/batch row operations with retry logic.
5. Update `src/services/reportProcessor.ts`:
   - Wrap Sheets operations inside `sheetsMutex.runExclusive` with `ejecutarConReintento`.
   - Implement graceful degradation: if Supabase DB is active, keep `sincronizado_sheets: false` and return `{ valido: true, sincronizadoSheets: false, persistidoDB: true, ... }` without throwing unhandled error. If DB is inactive, return `{ valido: false, razon: "ERROR_CONEXION_SHEETS", ... }` without throwing unhandled error.
   - Update `eliminarReporte` and `_marcarFilaParaRevision` with retries and safe error handling.
6. Update `src/handlers/message.ts`:
   - Handle `resultado.razon === "ERROR_CONEXION_SHEETS"` with friendly feedback.
   - Handle `resultado.sincronizadoSheets === false` with informative notice.
   - Remove `throw error` to prevent crashing the global update handler (`bot.catch`).
7. Update `src/jobs/cleanup.ts`:
   - Implement per-row try/catch containment and retry around `resetearFila` inside `ejecutarLimpieza` so a single 503 on row $i$ does NOT abort the cleanup cycle.
   - Add job-level retry loop to midnight reset (`0 0 * * *`) and 23:00 historical archive (`0 23 * * *`).
8. Create test fixtures and automated test suites:
   - `tests/helpers/errorSimulation.ts`
   - `tests/helpers/mockSheets.ts`
   - `tests/resilience.sheets.test.ts`
   - `tests/resilience.reportProcessor.test.ts`
   - `tests/resilience.cleanup.test.ts`
9. Run build and tests:
   - Run `npm run build` (`tsc --noEmit`) to verify 0 type errors.
   - Run `npm test` (`tsx --test`) to verify all existing and new tests pass cleanly with 0 unhandled rejections.
