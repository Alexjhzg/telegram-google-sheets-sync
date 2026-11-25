# E2E Test Infra: Google Sheets 503 Resilience

## Test Philosophy
- Requirement-driven verification based on `ORIGINAL_REQUEST.md` (§R1, §R2, §R3).
- Dual Track: automated verification of normal API operations and simulated transient 503 errors.
- Methodologies: Category-Partition, Boundary Value Analysis, Pairwise Interaction, and Real-World Failure Scenarios.

## Feature Inventory Mapping
| # | Feature | Requirement | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---------|-------------|:------:|:------:|:------:|:------:|
| 1 | F1: Transient Error Classifier | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 2 | F2: Backoff & Retry Engine | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 3 | F3: Test Provider Hook | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 4 | F4: Resilient `asegurarColumnas` | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 5 | F5: Resilient Report Processing | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 6 | F6: Safe Message Update Handler | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 7 | F7: Per-Row Cleanup Containment | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 8 | F8: Resilient Daily Cleanup Jobs | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 9 | F9: 503 Error Simulation Fixtures | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 10 | F10: Automated Multi-Tier Verification | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |

## Test Architecture
- **Test Runner**: Node.js native test runner via `tsx --test`
- **Invocation Command**: `npm test`
- **Error Simulation**: Synthetic AxiosError instances created via `tests/helpers/errorSimulation.ts`
- **Mock Sheets Fixtures**: `tests/helpers/mockSheets.ts` provides configurable failure injection (fail N times then succeed, fail permanently)

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Expected Outcome |
|---|----------|--------------------|------------------|
| 1 | Inbound report message encounters 503 on `asegurarColumnas` | F1, F2, F4, F5, F6 | Retries succeed on attempt 2, report is saved to Sheets, user gets confirmation |
| 2 | Inbound report encounters persistent 503 during row save (DB active) | F1, F2, F5, F6 | Retries exhausted; DB holds report with `sincronizado_sheets: false`; no crash in update handler |
| 3 | Inbound report encounters persistent 503 during row save (DB inactive) | F1, F2, F5, F6 | Retries exhausted; returns structured error; bot warns user gracefully; zero unhandled rejections |
| 4 | Cleanup job encounters 503 on row 1 of 5-row batch | F1, F2, F7 | Row 1 logs transient error; loop continues; rows 2-5 are checked and cleaned |
| 5 | Midnight reset encounters 503 on first sheet call | F1, F2, F8 | Job-level retry recovers; full reset and archive complete |

## Coverage Thresholds
- **Tier 1 (Unit)**: ≥5 test cases per feature (status checks, error parsing, delay calculations, normalizer, etc.)
- **Tier 2 (Boundary & Corner)**: Zero delays, max retries exhausted, non-transient errors (400, 401, 403, 404), empty sheets, missing headers
- **Tier 3 (Cross-Feature & Pairwise)**: Concurrent reports during 503, retry inside mutex without deadlock, DB fallback + Sheets recovery
- **Tier 4 (Real-World Lifecycle)**: End-to-end report flow and cleanup cycle under transient failures with zero crashes
