# BRIEFING — 2026-11-06T14:45:00Z

## Mission
Investigate and design the exact implementation blueprints for `src/utils/retry.ts` and `src/services/sheets.ts` with exponential backoff, Google API transient error classification, test injection hooks, error handling in `asegurarColumnas`, and mutex re-entrancy safety.

## 🔒 My Identity
- Archetype: teamwork_explorer
- Roles: explorer, investigator, synthesizer
- Working directory: /home/seem/Documentos/_proyectos/bot-telegram/.agents/teamwork/teamwork_explorer_m1_1
- Original parent: 9974c7fe-4879-428c-9b7b-a6cf1f36cd93
- Milestone: M1-1

## 🔒 Key Constraints
- Read-only investigation — do NOT implement in source files (only write to our own folder)
- Base recommendations on exact current codebase inspection and verification
- Self-contained 5-component handoff report

## Current Parent
- Conversation ID: 9974c7fe-4879-428c-9b7b-a6cf1f36cd93
- Updated: 2026-11-06T14:45:00Z

## Investigation State
- **Explored paths**:
  - `ORIGINAL_REQUEST.md`, `PROJECT.md`, `package.json`
  - `src/services/sheets.ts`, `src/services/reportProcessor.ts`, `src/jobs/cleanup.ts`, `src/services/sheets.business.ts`
  - `src/utils/mutex.ts`
  - `node_modules/google-spreadsheet/package.json` (verified axios v1.7.7 transport)
  - `tests/` directory and test suite (verified 18 passing tests with `tsx --test`)
- **Key findings**:
  - Google Sheets API errors surface as AxiosErrors (`err.response.status === 503`), GaxiosErrors, socket disconnects (`ECONNRESET`, `ETIMEDOUT`), or descriptive messages.
  - `sheetsMutex` is a promise-chained non-reentrant mutex. Calls from `reportProcessor.ts` and `cleanup.ts` already wrap large blocks with `sheetsMutex.runExclusive`. If internal sheets methods acquired `sheetsMutex`, deadlocks would occur. Upgrading `Mutex` with `AsyncLocalStorage` resolves re-entrancy safely.
  - `asegurarColumnas` currently performs unguarded `loadHeaderRow()` and `setHeaderRow()`, throwing unhandled AxiosError on 503. A retry wrapper with graceful fallback to cached headers or warning log avoids application crashes.
  - Test provider hook `setHojaDeCalculoProviderForTesting` allows dependency injection of mock spreadsheets without mutating ESM module namespaces.
- **Unexplored areas**: Downstream milestones (M2 reportProcessor, M3 cleanup containment) belong to later tasks.

## Key Decisions Made
- Designed `src/utils/retry.ts` with comprehensive `esErrorReintentableGoogle` (HTTP 503/502/504/429, socket codes, Google JSON payloads, nested error causes) and `ejecutarConReintento` with exponential backoff, jitter, and test-mode acceleration.
- Designed `src/services/sheets.ts` integration with `setHojaDeCalculoProviderForTesting`, retry wrapping for `doc.loadInfo()`, `resetearFila()`, and graceful error containment in `asegurarColumnas()`.
- Identified `AsyncLocalStorage`-based re-entrant `Mutex` solution for `src/utils/mutex.ts` to guard against `sheetsMutex` deadlocks.

## Artifact Index
- `DISPATCH.md` — incoming dispatch instructions
- `BRIEFING.md` — working memory and identity
- `progress.md` — liveness heartbeat
- `handoff.md` — 5-component handoff report and implementation blueprints
