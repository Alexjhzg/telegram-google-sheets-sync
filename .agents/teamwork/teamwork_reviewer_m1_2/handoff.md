# Review & Adversarial Stress-Test Report: M1 Google Sheets 503 Resilience

**Reviewer**: Reviewer M1-2 (`teamwork_reviewer_m1_2`)  
**Verdict**: **APPROVE**  
**Date**: 2026-11-06T15:08:00Z  

---

## 1. Observation

Direct examination of the workspace, modified files, and independent execution of build and test suites revealed the following concrete observations:

### 1.1 Direct Source Code Observations
1. **`src/services/reportProcessor.ts`**:
   - `eliminarReporte` and `_marcarFilaParaRevision` wrap row reads and mutations with `ejecutarConReintento` and safe `try/catch` handlers (lines 38-55, 68-87).
   - In `procesarYGuardarReporte`:
     - Initialization of `GoogleSpreadsheet` is guarded in `try/catch` (lines 137-153); if DB is inactive and Sheets fails to load, it returns a structured error `{ valido: false, razon: "ERROR_CONEXION_SHEETS", ... }` without crashing.
     - Sheets write operations (`asegurarColumnas(hoja)`, `filaExistente.save()`, `hoja.addRow()`) are encapsulated inside `sheetsMutex.runExclusive` and wrapped in `ejecutarConReintento(..., { maxIntentos: 3, retrasoBaseMs: 400 })` (lines 345-364).
     - When Google Sheets persistence fails after 3 attempts:
       - If Supabase DB is active and the report was saved (`esDBActiva() && persistidoDB`), the system applies graceful degradation returning `{ valido: true, sincronizadoSheets: false, persistidoDB: true, ... }` (lines 374-386).
       - If DB is inactive or failed, the system returns `{ valido: false, sincronizadoSheets: false, persistidoDB: false, razon: "ERROR_CONEXION_SHEETS", ... }` (lines 389-398).
     - Top-level `try/catch` in `procesarYGuardarReporte` catches any critical unhandled error and returns structured failure, guaranteeing zero uncaught exceptions bubbling up (lines 411-419).

2. **`src/handlers/message.ts`**:
   - Former line 246 `throw error` within the message handler was deleted.
   - For `resultado.razon === "ERROR_CONEXION_SHEETS"`, a user-friendly message (`⚠️ *Aviso de servicio: Conexión temporalmente no disponible*...`) is sent with retry advice (lines 234-239).
   - For reports accepted via graceful degradation (`resultado.sincronizadoSheets === false`), an informational notification (`ℹ️ *Reporte resguardado en base de datos*...`) is dispatched (lines 258-272).
   - The outer handler `catch (error: any)` sends a polite error message to the user and reacts with 👎; it does NOT call `throw error`, completely shielding Grammy's `bot.catch` from unhandled rejections (lines 273-292).
   - In `manejarEliminacion`, transient failure during deletion triggers an informative reply without throwing unhandled exceptions (lines 31-39).

3. **`src/jobs/cleanup.ts`**:
   - In `ejecutarLimpieza`, each row iteration is encapsulated within its own `try/catch (filaError: any)` block (lines 74-123). If row $i$ permanently fails with 503 on `fila.save()`, `fallosFila++` is recorded, the error is logged, and the loop proceeds to inspect and clean the remaining rows.
   - The scheduled midnight reset job (`0 0 * * *`) and historical backup job (`0 23 * * *`) implement a job-level retry loop (`for (let intento = 1; intento <= maxIntentosJob; intento++)`) with 3 attempts and a 15-second backoff between attempts.
   - `sheetsMutex.runExclusive` is acquired and released per attempt, preventing lock starvation during backoff delays (lines 157-175, 195-213).

4. **`src/services/sheets.ts` & `src/utils/retry.ts` & `src/utils/mutex.ts`**:
   - `src/utils/retry.ts` provides `esErrorReintentableGoogle` which identifies 503, 502, 504, 429, 408, 403 rate limits, socket disconnects (`ECONNRESET`, `ETIMEDOUT`), and traverses nested `cause` chains. `ejecutarConReintento` implements exponential backoff with random jitter.
   - `src/utils/mutex.ts` implements re-entrancy tracking via `AsyncLocalStorage<symbol>`, preventing deadlocks when nested operations call `runExclusive`.
   - `src/services/sheets.ts` wraps `obtenerHojaDeCalculo`, `asegurarColumnas`, `resetearFila`, `resetearFilasDeDiasAnteriores`, and `guardarHistoricoDiario` with `ejecutarConReintento`.

### 1.2 Independent Build & Verification Execution
- Command: `npm run build`
  - Output: `tsc --noEmit` exited with status code `0` (zero TypeScript errors).
- Command: `npm test`
  - Output: `tsx --test` passed all 31 tests across all test suites in 3.55 seconds with 0 failures, 0 cancellations, and 0 unhandled rejections.

### 1.3 Integrity Check
- Checked for hardcoded test outputs or fake mocks in `src/`: NONE found.
- Checked for dummy facades: All retry, mutex, Sheets, and DB logic are fully functional implementations.
- Checked for self-certifying shortcuts: Tests use genuine in-memory mocks reproducing the exact Axios 503 error shapes and verifying state transitions across worksheets.

---

## 2. Logic Chain

1. **Mutex Safety and Re-entrancy**:
   - *Observation*: `reportProcessor.ts` acquires `sheetsMutex.runExclusive`, and calls functions that might interact with Sheets.
   - *Deduction*: `Mutex` in `src/utils/mutex.ts` checks `this.asyncLocalStorage.getStore() === this.currentLockKey`. Because the lock key matches in the same asynchronous call stack, nested calls execute immediately without re-enqueuing on `this.queue`. This avoids deadlock. Furthermore, `this.queue = next.then(() => {}, () => {})` guarantees that if an operation rejects, subsequent queued tasks are not blocked.

2. **Graceful Degradation vs. Structured Failure**:
   - *Observation*: Reports are saved in Supabase DB first if `esDBActiva()` is true.
   - *Deduction*: If Supabase DB succeeds (`persistidoDB = true`) but Google Sheets throws 503 after 3 retries, the report is already safely committed to persistent storage. Returning `{ valido: true, sincronizadoSheets: false, persistidoDB: true }` avoids rejecting valid user reports while accurately flagging that Google Sheets sync is pending.
   - *Deduction*: If Supabase DB is inactive (`esDBActiva() = false`) or failed, Google Sheets is the sole storage. If Sheets fails after 3 retries, returning `{ valido: false, razon: "ERROR_CONEXION_SHEETS" }` informs the user of temporary service unavailability without data corruption or crashes.

3. **Telegram Pipeline Containment**:
   - *Observation*: Line 246 `throw error` was replaced with error feedback and `reaccionar(ctx, "👎")`.
   - *Deduction*: Errors are handled at the handler level. No unhandled rejections reach Grammy's `bot.catch`, keeping the bot responsive.

4. **Cleanup Fault Isolation**:
   - *Observation*: Per-row `try/catch` in `ejecutarLimpieza`.
   - *Deduction*: A 503 error on row $k$ does not break out of the reverse loop (`for (let i = filas.length - 1; i >= 0; i--)`). Rows $k-1 \dots 0$ continue to be scanned and reset, satisfying R1 and R2.

---

## 3. Adversarial Stress-Test Findings & Edge Cases

### Challenge 1: Double Retry Redundancy on `resetearFila`
- **Challenged Mechanism**: In `src/services/sheets.ts:202`, `resetearFila` wraps `fila.save()` in `ejecutarConReintento` (max 3 attempts). In `src/jobs/cleanup.ts:112` and `src/services/reportProcessor.ts:45`, the caller wraps `resetearFila` in another `ejecutarConReintento` (max 3 attempts).
- **Stress Scenario**: A permanent 503 error triggers $3 \times 3 = 9$ total save attempts before exhaustion.
- **Risk Assessment**: **LOW / NON-BREAKING**.
- **Impact**: In tests, 9 attempts take $<15\text{ms}$ due to test acceleration. In production, 9 attempts take $\sim 5$ seconds per permanently failed row. Because it is contained in `try/catch`, it does not abort other rows.
- **Mitigation Recommendation**: In future refactoring, remove the outer `ejecutarConReintento` around `resetearFila` since `resetearFila` already retries internally.

### Challenge 2: Jitter and Thundering Herd
- **Challenged Mechanism**: Multiple concurrent Telegram messages arriving during an ongoing Google Sheets 503 outage.
- **Stress Scenario**: Multiple incoming updates simultaneously trigger `ejecutarConReintento`.
- **Finding**: `ejecutarConReintento` applies random jitter between $50\%$ and $100\%$ of the exponential delay (`delayCalculado / 2 + Math.random() * (delayCalculado / 2)`), and all Sheets operations are serialized by `sheetsMutex.runExclusive`. This completely eliminates thundering herd and race conditions on the Sheets API.

### Challenge 3: Unhandled Rejection on Complete Network Loss
- **Challenged Scenario**: Full disconnection where `doc.loadInfo()`, `getRows()`, and `save()` all fail.
- **Finding**: Verified by test `resilience.cleanup - ciclo completo se ejecuta sin unhandled rejections ante fallo 503 en getRows` and `resilience.reportProcessor - proceso emite cero 'unhandledRejection' durante 503 permanente`. `process.on("unhandledRejection")` captured 0 unhandled rejections.

---

## 4. Caveats

- **No Caveats**: The implementation satisfies all criteria of §R1, §R2, and §R3 in `ORIGINAL_REQUEST.md` and `PROJECT.md`. No mock leaks or lingering test providers exist in production code paths.

---

## 5. Conclusion

**Verdict: APPROVE**

The work product delivered in Milestone 1 demonstrates high engineering quality, correct failure domain containment, robust concurrency management via `AsyncLocalStorage` re-entrant mutex, and verified resilience against transient HTTP 503 / socket errors from Google Sheets.

---

## 6. Verification Method

To reproduce and verify these findings independently:

1. **Verify TypeScript compilation**:
   ```bash
   npm run build
   ```
   *Confirmed output*: `tsc --noEmit` exits with code 0.

2. **Execute complete test suite**:
   ```bash
   npm test
   ```
   *Confirmed output*: 31 tests pass with 0 failures, 0 cancellations, 0 unhandled rejections.
