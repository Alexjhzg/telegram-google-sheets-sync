Resolve Google Sheets API 503 "The service is currently unavailable" errors during persistence (`src/services/sheets.ts`), report processing (`src/services/reportProcessor.ts`), and cleanup (`src/jobs/cleanup.ts`).

Working directory: /home/seem/Documentos/_proyectos/bot-telegram
Integrity mode: development

## Requirements

### R1. Resilient Google Sheets API Interaction
Handle Google API 503 "The service is currently unavailable" errors during Google Sheets interactions—specifically in `asegurarColumnas` (`src/services/sheets.ts`), report processing (`src/services/reportProcessor.ts`), and the cleanup job (`src/jobs/cleanup.ts`)—ensuring transient API unavailability does not cause unhandled crashes, global update failures, or interrupted cleanup cycles.

### R2. Error Handling and Resilience
Implement an error handling and retry strategy for transient Google Sheets API errors so operations can recover or degrade gracefully when the external service is temporarily unavailable.

### R3. Automated Verification
Provide automated tests or verification mechanisms that simulate Google Sheets API 503 errors and validate that retry, recovery, and graceful failure behaviors operate as expected without crashing the application.

## Acceptance Criteria

### Error Handling & Resilience
- [ ] Google Sheets operations in `src/services/sheets.ts` (including `asegurarColumnas`), `src/services/reportProcessor.ts`, and `src/jobs/cleanup.ts` handle 503 errors gracefully rather than throwing unhandled AxiosError exceptions.
- [ ] When a 503 service unavailable response is encountered, transient error handling is triggered and logs the condition without crashing the update handler or cleanup process.

### Verification
- [ ] Automated tests simulate Google API 503 responses and pass, confirming recovery or graceful failure behavior.
- [ ] Existing functionality in `src/services/sheets.ts`, `src/services/reportProcessor.ts`, and `src/jobs/cleanup.ts` continues to pass and operate correctly under normal (non-error) API conditions.
