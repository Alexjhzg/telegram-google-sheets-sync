## 2026-11-06T14:39:53Z
Your identity: Explorer M1-1 (teamwork_explorer)
Your working directory: /home/seem/Documentos/_proyectos/bot-telegram/.agents/teamwork/teamwork_explorer_m1_1
Original request file: /home/seem/Documentos/_proyectos/bot-telegram/.agents/teamwork/ORIGINAL_REQUEST.md
Scope document: /home/seem/Documentos/_proyectos/bot-telegram/PROJECT.md

Scope of investigation:
1. Provide the exact implementation blueprint for `src/utils/retry.ts`:
   - `esErrorReintentableGoogle(error: unknown): boolean` (handling 503, 502, 504, 429, ECONNRESET, ETIMEDOUT, AxiosError, GaxiosError, and custom message formats).
   - `ejecutarConReintento<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>` (exponential backoff, jitter, configurable retries and delays, test-mode acceleration).
2. Provide the exact implementation blueprint for `src/services/sheets.ts`:
   - Expose `setHojaDeCalculoProviderForTesting(provider: (() => Promise<GoogleSpreadsheet>) | null): void`.
   - Update `asegurarColumnas(hoja: GoogleSpreadsheetWorksheet): Promise<void>` to wrap `loadHeaderRow()` and `setHeaderRow()` with retry and graceful error handling.
   - Wrap `resetearFila`, `obtenerHojaDeCalculo` info loading, and relevant Sheets API calls with retry logic.
   - Guard against `sheetsMutex` re-entrancy issues.

Write your complete recommendations and implementation blueprint to `/home/seem/Documentos/_proyectos/bot-telegram/.agents/teamwork/teamwork_explorer_m1_1/handoff.md` and send a message when done.
