# BRIEFING — 2026-11-06T14:42:00Z

## Mission
Investigate Google Sheets integration in `src/services/sheets.ts` with focus on `asegurarColumnas`, 503 transient errors, error handling, call sites, and retry/backoff strategies.

## 🔒 My Identity
- Archetype: teamwork_explorer
- Roles: Survey Explorer 1, investigation, read-only analysis
- Working directory: /home/seem/Documentos/_proyectos/bot-telegram/.agents/teamwork/teamwork_explorer_survey_1
- Original parent: 9974c7fe-4879-428c-9b7b-a6cf1f36cd93
- Milestone: Investigation and Survey Analysis

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Strictly follow Teamwork communication guidelines and file workspace conventions
- Never place source code or tests in .agents/teamwork/

## Current Parent
- Conversation ID: 9974c7fe-4879-428c-9b7b-a6cf1f36cd93
- Updated: 2026-11-06T14:42:00Z

## Investigation State
- **Explored paths**:
  - `src/services/sheets.ts`
  - `src/services/reportProcessor.ts`
  - `src/jobs/cleanup.ts`
  - `src/services/sheets.business.ts`
  - `src/services/syncService.ts`
  - `src/services/catalogService.ts`
  - `src/services/database.ts`
  - `src/handlers/message.ts`
  - `src/handlers/commands.ts`
  - `bot.ts`
  - `node_modules/google-spreadsheet/src/lib/GoogleSpreadsheet.ts`
  - `package.json`
  - `tests/`
- **Key findings**:
  - `google-spreadsheet@4.1.5` uses `axios@^1.7.7` under the hood.
  - When Google Sheets API returns HTTP 503, Axios intercepts and rejects with `AxiosError`, which `GoogleSpreadsheet._handleAxiosErrors` formats as `Google API error - [503] The service is currently unavailable` and re-throws the AxiosError instance.
  - `asegurarColumnas` in `src/services/sheets.ts` performs `hoja.loadHeaderRow()` and `hoja.setHeaderRow()`. It currently has ZERO error handling and ZERO retry logic.
  - `src/services/sheets.ts` across all its methods (`obtenerHojaDeCalculo`, `asegurarColumnas`, `resetearFila`, `resetearFilasDeDiasAnteriores`, `guardarHistoricoDiario`) has NO retry/backoff strategy.
  - In `src/services/reportProcessor.ts:procesarYGuardarReporte`, `asegurarColumnas` is called directly inside `sheetsMutex.runExclusive(...)`. Unhandled 503 throws up to `src/handlers/message.ts:246` which rethrows, triggering `bot.catch`, crashing the update handling and failing message confirmation without saving to Sheets.
  - If Supabase DB is enabled, data is already persisted in `reportes_diarios` with `sincronizado_sheets: false` before Sheets write, opening the door for graceful degradation.
  - In `src/jobs/cleanup.ts`, 503 errors cause `ejecutarLimpieza`, midnight cleanup, and 23:00 historical backups to fail.
- **Unexplored areas**: None for survey scope. Ready to draft handoff report.

## Key Decisions Made
- Fully document 503 error shapes (AxiosError with response status 503 and message `Google API error - [503]...`).
- Detail call sites and caller impact across all modules.
- Formulate concrete retry/backoff specification (exponential backoff with jitter and configurable retries) and graceful degradation mechanisms.

## Artifact Index
- DISPATCH.md — record of incoming dispatch messages
- BRIEFING.md — working memory and identity
- progress.md — liveness heartbeat
- handoff.md — structured survey report following 5-component protocol
