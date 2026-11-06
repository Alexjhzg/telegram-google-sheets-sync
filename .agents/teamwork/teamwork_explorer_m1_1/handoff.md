# Handoff Report: Google Sheets Resilience Blueprint (M1-1)

## 1. Observation

### 1.1 Unguarded Google Sheets Network Calls
Direct inspection of `src/services/sheets.ts` revealed multiple unshielded network calls relying on `google-spreadsheet` (v4.1.4) over `axios` (v1.7.7):

1. **`obtenerHojaDeCalculo`** (`src/services/sheets.ts:52-59`):
   ```ts
   const doc = new GoogleSpreadsheet(config.google.spreadsheetId, auth);
   await doc.loadInfo();
   console.log("[INFO] Conexión con Google Sheets establecida con éxito.");
   return doc;
   ```
   *Issue*: If `doc.loadInfo()` encounters an HTTP 503 "The service is currently unavailable", an unhandled `AxiosError` is thrown, poisoning `docPromise` and causing downstream calls to fail.

2. **`asegurarColumnas`** (`src/services/sheets.ts:68-83`):
   ```ts
   export async function asegurarColumnas(hoja: GoogleSpreadsheetWorksheet): Promise<void> {
     await hoja.loadHeaderRow();

     const cabeceras = [...hoja.headerValues];
     let modificado  = false;

     for (const col of [COLUMNAS.ID_MENSAJE, COLUMNAS.ID_CHAT, COLUMNAS.ESTADO]) {
       if (!cabeceras.includes(col)) {
         console.log(`[INFO] Columna '${col}' no encontrada. Añadiéndola...`);
         cabeceras.push(col);
         modificado = true;
       }
     }

     if (modificado) await hoja.setHeaderRow(cabeceras);
   }
   ```
   *Issue*: Both `hoja.loadHeaderRow()` and `hoja.setHeaderRow(cabeceras)` make raw HTTP requests. On a 503 error, an unhandled rejection bubbles up to callers (such as `reportProcessor.ts:164`), aborting report persistence.

3. **`resetearFila`** (`src/services/sheets.ts:124-136`):
   ```ts
   export async function resetearFila(fila: GoogleSpreadsheetRow): Promise<void> {
     ...
     await fila.save();
   }
   ```
   *Issue*: `fila.save()` issues a `PUT /values/...` request. Under Google 503 conditions, the unhandled error halts row resets in both `reportProcessor.ts:37` and `cleanup.ts:99`.

4. **Batch & Historical Operations** (`src/services/sheets.ts:141-434`):
   - `hoja.getRows()` (lines 144, 191, 237)
   - `doc.addSheet()` (line 212)
   - `sheetHistorica.loadCells()` & `saveUpdatedCells()` (lines 297, 370)
   - `sheetHistorica.addRows()` (line 432)
   All lack retry loops and transient error backoff.

### 1.2 `sheetsMutex` Re-Entrancy Hazard
Inspection of `src/utils/mutex.ts:5-24`:
```ts
export class Mutex {
  private queue: Promise<void>;

  constructor() {
    this.queue = Promise.resolve();
  }

  public runExclusive<T>(callback: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(() => callback());
    this.queue = next.then(
      () => {},
      () => {}
    );
    return next;
  }
}
```
Inspection of consumer files:
- `src/services/reportProcessor.ts:161`:
  `return sheetsMutex.runExclusive(async () => { ... await asegurarColumnas(hoja); ... });`
- `src/services/reportProcessor.ts:44-75`:
  An explicit internal helper `_marcarFilaParaRevision` was previously created specifically because calling `marcarFilaParaRevision` inside `runExclusive` deadlocks.
- `src/jobs/cleanup.ts:54`:
  `return sheetsMutex.runExclusive(async () => { ... await resetearFila(fila); ... });`

*Root Cause*: If `src/services/sheets.ts` functions (`resetearFila`, `asegurarColumnas`) were wrapped in `sheetsMutex.runExclusive`, any caller that already acquired `sheetsMutex` would experience a permanent async **DEADLOCK**, because `this.queue` will not resolve until the outer caller completes, while the outer caller awaits the inner function.

### 1.3 Test Provider Hook Deficiency
In `src/services/sheets.ts:27-62`, `docPromise` is private to the module scope. In ESM, imported modules cannot be mutated via `rewire` or simple object monkey-patching. Tests cannot supply a mock `GoogleSpreadsheet` without an explicit provider hook.

---

## 2. Logic Chain

1. **Transient Error Identification (Observation 1.1)**:
   Google Sheets API is an external service accessed through `google-spreadsheet` via `axios`. Transient unavailabilities manifest as:
   - HTTP status codes: 503 (Service Unavailable), 502 (Bad Gateway), 504 (Gateway Timeout), 429 (Too Many Requests / Rate Limit), 408 (Request Timeout).
   - Google API 403 with `rateLimitExceeded` / `userRateLimitExceeded`.
   - Socket and network errors: `ECONNRESET`, `ETIMEDOUT`, `ECONNABORTED`, `ERR_NETWORK`, `ECONNREFUSED`.
   - String messages: `"The service is currently unavailable"`, `"backendError"`, etc.
   Therefore, `esErrorReintentableGoogle(error: unknown): boolean` must inspect `.response.status`, `.response.statusCode`, `.status`, `.statusCode`, `.code`, `.response.data.error`, `.message`, and recursively traverse `.cause`.

2. **Retry Strategy & Test Acceleration (Observation 1.1)**:
   Immediate retries under 503 / 429 conditions worsen server overload (thundering herd). An exponential backoff formula:
   $$\text{delay} = \min(\text{maxDelay}, \text{baseDelay} \times 2^{\text{attempt}-1})$$
   combined with **jitter** (randomizing between $0.5 \times \text{delay}$ and $1.0 \times \text{delay}$) resolves contention.
   In automated tests, real delays (500ms - 2000ms) would slow the suite down. Adding an `acelerarParaPruebas` option (active by default when `process.env.NODE_ENV === "test"`) clamps delays to $\le 5\text{ms}$, allowing tests to run in sub-second times while validating full retry flows.

3. **Graceful Handling in `asegurarColumnas` (Observation 1.1)**:
   In `asegurarColumnas`, header checking is an initialization safeguard.
   - If `loadHeaderRow()` fails with `"No values in the header row"`, it indicates an empty sheet that needs headers initialized.
   - If `loadHeaderRow()` fails with persistent 503 after all retries, throwing an unhandled rejection crashes the entire bot message handler.
   - If `hoja.headerValues` are already loaded in memory, `asegurarColumnas` can reuse them.
   - If no headers are available and 503 persists, `asegurarColumnas` must log a structured `[WARN]` and return gracefully, permitting caller degradation logic (e.g. database persistence and offline sync) rather than crashing the node process.

4. **Deadlock Elimination via Re-Entrant Mutex (Observation 1.2)**:
   To allow functions in `src/services/sheets.ts` to be called safely both inside transactions (e.g., inside `reportProcessor.ts`'s `sheetsMutex.runExclusive`) and outside transactions (direct calls or standalone tests):
   - Upgrade `Mutex` in `src/utils/mutex.ts` using Node.js's built-in `AsyncLocalStorage`.
   - When `runExclusive` is called, check if the current async execution context already holds the lock key. If so, execute the callback immediately (re-entrancy). If not, queue and execute under a new key.
   - This maintains 100% backward compatibility with `sheetsMutex: Mutex`, prevents deadlocks, and removes the need for awkward workaround patterns like `_marcarFilaParaRevision`.

5. **Test Hook Injection (Observation 1.3)**:
   Exposing `setHojaDeCalculoProviderForTesting(provider: (() => Promise<GoogleSpreadsheet>) | null): void` provides a clean dependency injection point:
   - When set, `obtenerHojaDeCalculo()` invokes `provider()`.
   - When set to `null`, `docPromise` is reset and standard production authentication is restored.

---

## 3. Caveats

1. **Scope Boundary**:
   This blueprint strictly defines `src/utils/retry.ts`, `src/services/sheets.ts`, and the re-entrant `src/utils/mutex.ts`. Downstream error handling in `reportProcessor.ts` (fallback to Supabase DB) and `cleanup.ts` (per-row error containment) depends on this foundation and will be implemented in subsequent milestone tasks.
2. **Sheet Caching in `google-spreadsheet`**:
   `GoogleSpreadsheet` caches worksheets in `sheetsByTitle` and `sheetsById` upon `loadInfo()`. Mock implementations in tests must populate these properties so downstream code functions identically.
3. **Node Runtime Requirement**:
   `AsyncLocalStorage` is part of Node.js `node:async_hooks` and is native in Node.js $\ge 12.17$. The project specifies Node $\ge 20.0.0$, making this 100% compatible with no external dependencies.

---

## 4. Conclusion & Implementation Blueprint

### 4.1 Blueprint A: `src/utils/retry.ts`

Create `src/utils/retry.ts` with the following complete, production-ready implementation:

```ts
/**
 * src/utils/retry.ts
 * Motor de reintentos con retroceso exponencial, jitter y clasificador de errores transitorios de Google APIs.
 */

export interface RetryOptions {
  /**
   * Número máximo de intentos totales (incluyendo la ejecución inicial).
   * @default 3
   */
  maxIntentos?: number;

  /**
   * Retraso base inicial en milisegundos para el primer reintento.
   * @default 500
   */
  retrasoBaseMs?: number;

  /**
   * Factor multiplicador para el retroceso exponencial.
   * @default 2
   */
  factorMultiplicador?: number;

  /**
   * Retraso máximo permitido entre reintentos en milisegundos.
   * @default 10000
   */
  retrasoMaximoMs?: number;

  /**
   * Si debe aplicar jitter aleatorio para prevenir thundering herd.
   * @default true
   */
  conJitter?: boolean;

  /**
   * Predicado para determinar si el error capturado amerita reintento.
   * @default esErrorReintentableGoogle
   */
  esReintentable?: (error: unknown) => boolean;

  /**
   * Callback invocado antes de cada reintento, útil para logging y métricas.
   */
  onReintento?: (error: unknown, intento: number, retrasoMs: number) => void;

  /**
   * Acelera los retrasos a <= 5ms para ejecución ultra-rápida en pruebas unitarias.
   * @default true si process.env.NODE_ENV === "test", false en caso contrario.
   */
  acelerarParaPruebas?: boolean;
}

let modoPruebasGlobal = false;

/**
 * Permite activar o desactivar globalmente el modo acelerado para pruebas.
 */
export function configurarModoPruebasRetry(activo: boolean): void {
  modoPruebasGlobal = activo;
}

/**
 * Determina si un error retornado por Google Sheets API, Axios, Gaxios o la red
 * representa una falla transitoria recuperable mediante reintento.
 *
 * Cubre:
 * - HTTP 503 (Service Unavailable)
 * - HTTP 502 (Bad Gateway)
 * - HTTP 504 (Gateway Timeout)
 * - HTTP 429 (Too Many Requests / Rate Limit)
 * - HTTP 408 (Request Timeout)
 * - HTTP 403 con motivo de cuota/rate limit
 * - Errores de socket/red: ECONNRESET, ETIMEDOUT, ECONNABORTED, ENOTFOUND, ERR_NETWORK
 * - Formatos de error anidados (AxiosError, GaxiosError, Error.cause)
 */
export function esErrorReintentableGoogle(error: unknown): boolean {
  if (error == null) return false;

  // Manejo de error como string plano
  if (typeof error === "string") {
    const str = error.toLowerCase();
    return (
      str.includes("503") ||
      str.includes("502") ||
      str.includes("504") ||
      str.includes("429") ||
      str.includes("service is currently unavailable") ||
      str.includes("service unavailable") ||
      str.includes("econnreset") ||
      str.includes("etimedout") ||
      str.includes("socket hang up")
    );
  }

  const err = error as Record<string, any>;

  // 1. HTTP Status Codes directos o en respuesta (Axios / Gaxios / Fetch)
  const status =
    err.response?.status ??
    err.response?.statusCode ??
    err.status ??
    err.statusCode ??
    err.response?.data?.error?.code;

  if (typeof status === "number") {
    if ([503, 502, 504, 429, 408].includes(status)) {
      return true;
    }

    // Caso especial: Google a veces responde 403 con 'rateLimitExceeded' o 'userRateLimitExceeded'
    if (status === 403) {
      const errors = err.response?.data?.error?.errors;
      const reason = Array.isArray(errors) && errors[0]?.reason;
      const msg = String(err.response?.data?.error?.message || err.message || "").toLowerCase();
      if (
        reason === "rateLimitExceeded" ||
        reason === "userRateLimitExceeded" ||
        msg.includes("rate limit") ||
        msg.includes("quota exceeded")
      ) {
        return true;
      }
    }
  }

  // 2. Códigos de error de red y socket (Node.js / Axios)
  const code = String(err.code || "").toUpperCase();
  const codigosRedReintentables = new Set([
    "503",
    "502",
    "504",
    "429",
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNABORTED",
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "EPIPE",
    "ERR_NETWORK",
    "ERR_BAD_RESPONSE",
  ]);

  if (code && codigosRedReintentables.has(code)) {
    if (code === "ERR_BAD_RESPONSE") {
      if (status && [503, 502, 504, 429].includes(Number(status))) {
        return true;
      }
    } else {
      return true;
    }
  }

  // 3. Verificación heurística por mensaje descriptivo
  const mensaje = String(err.message || "").toLowerCase();
  const patronesReintentables = [
    "service is currently unavailable",
    "the service is currently unavailable",
    "service unavailable",
    "backend error",
    "backenderror",
    "rate limit",
    "ratelimit",
    "quota exceeded",
    "quotaexceeded",
    "econnreset",
    "etimedout",
    "socket hang up",
    "network error",
    "503 service unavailable",
    "status code 503",
    "status code 502",
    "status code 504",
    "status code 429",
    "resource_exhausted",
    "unavailable",
  ];

  for (const patron of patronesReintentables) {
    if (mensaje.includes(patron)) {
      return true;
    }
  }

  // 4. Verificación recursiva en cadenas de error anidadas (Error.cause)
  if (err.cause && err.cause !== error) {
    return esErrorReintentableGoogle(err.cause);
  }

  return false;
}

/**
 * Ejecuta una operación asíncrona reintentándola si arroja un error transitorio.
 * Aplica retroceso exponencial, jitter aleatorio y aceleración automática en entornos de prueba.
 */
export async function ejecutarConReintento<T>(
  operacion: () => Promise<T>,
  opciones?: RetryOptions
): Promise<T> {
  const maxIntentos = Math.max(1, opciones?.maxIntentos ?? 3);
  const retrasoBaseMs = opciones?.retrasoBaseMs ?? 500;
  const factorMultiplicador = opciones?.factorMultiplicador ?? 2;
  const retrasoMaximoMs = opciones?.retrasoMaximoMs ?? 10000;
  const conJitter = opciones?.conJitter ?? true;
  const esReintentable = opciones?.esReintentable ?? esErrorReintentableGoogle;
  const acelerar =
    opciones?.acelerarParaPruebas ??
    (modoPruebasGlobal || process.env.NODE_ENV === "test");

  let ultimoError: unknown;

  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      return await operacion();
    } catch (error) {
      ultimoError = error;

      // Si alcanzamos el límite de intentos, romper y propagar
      if (intento >= maxIntentos) {
        break;
      }

      // Si el error no es transitorio/reintentable, fallar inmediatamente
      if (!esReintentable(error)) {
        throw error;
      }

      // Cálculo de retroceso exponencial
      const delayCalculado = Math.min(
        retrasoMaximoMs,
        retrasoBaseMs * Math.pow(factorMultiplicador, intento - 1)
      );

      // Jitter aleatorio: entre 50% y 100% del tiempo calculado
      let delayFinal = conJitter
        ? Math.round((delayCalculado / 2) + Math.random() * (delayCalculado / 2))
        : delayCalculado;

      // Aceleración en modo test
      if (acelerar) {
        delayFinal = Math.min(delayFinal, 5);
      }

      if (opciones?.onReintento) {
        try {
          opciones.onReintento(error, intento, delayFinal);
        } catch {
          // Asegurar que un fallo en el callback de telemetría no impida el reintento
        }
      }

      await new Promise((resolve) => setTimeout(resolve, delayFinal));
    }
  }

  throw ultimoError;
}
```

---

### 4.2 Blueprint B: `src/utils/mutex.ts` (Re-Entrant Upgrade)

Upgrade `src/utils/mutex.ts` to be re-entrant using Node's `AsyncLocalStorage`. This eliminates deadlocks when `sheetsMutex` is held across nested calls:

```ts
/**
 * src/utils/mutex.ts
 * Clase Mutex reentrante para garantizar exclusión mutua en operaciones asíncronas.
 * Permite encolar tareas secuencialmente y soporta reentrancia segura dentro del
 * mismo árbol de ejecución asíncrono sin provocar interbloqueos (deadlocks).
 */
import { AsyncLocalStorage } from "node:async_hooks";

export class Mutex {
  private queue: Promise<void>;
  private asyncLocalStorage: AsyncLocalStorage<symbol>;
  private currentLockKey: symbol | null;

  constructor() {
    this.queue = Promise.resolve();
    this.asyncLocalStorage = new AsyncLocalStorage<symbol>();
    this.currentLockKey = null;
  }

  /**
   * Ejecuta una función asíncrona dentro del bloqueo exclusivo.
   * Si el llamador ya posee el bloqueo en el contexto asíncrono actual,
   * se ejecuta inmediatamente sin encolarse de nuevo (reentrancia segura).
   */
  public async runExclusive<T>(callback: () => Promise<T> | T): Promise<T> {
    const activeKey = this.asyncLocalStorage.getStore();
    if (activeKey && activeKey === this.currentLockKey) {
      return await callback();
    }

    const lockKey = Symbol("mutex-lock");
    const next = this.queue.then(async () => {
      this.currentLockKey = lockKey;
      try {
        return await this.asyncLocalStorage.run(lockKey, () => callback());
      } finally {
        this.currentLockKey = null;
      }
    });

    this.queue = next.then(
      () => {},
      () => {}
    );

    return next;
  }

  public isLocked(): boolean {
    return this.currentLockKey !== null;
  }
}
```

---

### 4.3 Blueprint C: `src/services/sheets.ts`

Update `src/services/sheets.ts` to integrate `ejecutarConReintento`, `esErrorReintentableGoogle`, `setHojaDeCalculoProviderForTesting`, and graceful error handling:

```ts
import { GoogleSpreadsheet, GoogleSpreadsheetWorksheet, GoogleSpreadsheetRow } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { config } from "../config/index.js";
import { Mutex } from "../utils/mutex.js";
import { HistorialAcumulado } from "../types/index.js";
import { estandarizarFecha, obtenerFechaHoyEstandar } from "../utils/dateUtils.js";
import { ejecutarConReintento, esErrorReintentableGoogle } from "../utils/retry.js";

// Lock global para secuenciar todas las operaciones asíncronas sobre Google Sheets
export const sheetsMutex = new Mutex();

// Nombres canónicos de las columnas en la hoja de cálculo
export const COLUMNAS = {
  MUNICIPIO:          "Municipio",
  NODO:               "Nodo",
  TOTAL_VERIFICADORES:"Total Verificadores",
  BLOQUE_1:           "Bloque 1 (9am)",
  BLOQUE_2:           "Bloque 2 (2pm)",
  BLOQUE_3:           "Bloque 3 (6pm)",
  FECHA:              "Fecha",
  HORA:               "Hora",
  REMITENTE:          "Remitente",
  ID_MENSAJE:         "ID Mensaje",
  ID_CHAT:            "ID Chat",
  ESTADO:             "Estado",
} as const;

let docPromise: Promise<GoogleSpreadsheet> | null = null;
let testSpreadsheetProvider: (() => Promise<GoogleSpreadsheet>) | null = null;

/**
 * Permite a las suites de prueba inyectar un proveedor de GoogleSpreadsheet simulado (mock),
 * evitando monkeypatching en módulos ESM nativos.
 * Pasar null para restaurar la conexión por defecto.
 */
export function setHojaDeCalculoProviderForTesting(
  provider: (() => Promise<GoogleSpreadsheet>) | null
): void {
  testSpreadsheetProvider = provider;
  docPromise = null;
}

/**
 * Crea, autentica y carga el cliente de Google Sheets una sola vez,
 * reutilizando la conexión en las llamadas posteriores y protegiendo
 * la carga inicial con reintentos exponenciales.
 */
export async function obtenerHojaDeCalculo(): Promise<GoogleSpreadsheet> {
  if (testSpreadsheetProvider) {
    return testSpreadsheetProvider();
  }

  if (docPromise) {
    return docPromise;
  }

  docPromise = (async () => {
    if (!config.google.spreadsheetId || !config.google.serviceAccountEmail || !config.google.privateKey) {
      throw new Error(
        "[FATAL] Faltan variables de entorno requeridas para Google Sheets (GOOGLE_SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY). Revisa tu archivo .env"
      );
    }

    console.log("[INFO] Conectando y autenticando con Google Sheets...");
    const auth = new JWT({
      email:  config.google.serviceAccountEmail,
      key:    config.google.privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const doc = new GoogleSpreadsheet(config.google.spreadsheetId, auth);

    // Carga inicial de metadatos con reintentos ante 503 / caídas transitorias
    await ejecutarConReintento(
      async () => {
        await doc.loadInfo();
      },
      {
        onReintento: (err, intento, delay) => {
          console.warn(`[WARN] Reintentando doc.loadInfo() (${intento}/3) tras ${delay}ms debido a error transitorio.`);
        },
      }
    );

    console.log("[INFO] Conexión con Google Sheets establecida con éxito.");
    return doc;
  })().catch((err) => {
    docPromise = null;
    throw err;
  });

  return docPromise;
}

/**
 * Asegura que las columnas de rastreo existen en la hoja.
 * Envuelve loadHeaderRow y setHeaderRow con reintentos y degradación elegante ante 503.
 */
export async function asegurarColumnas(hoja: GoogleSpreadsheetWorksheet): Promise<void> {
  let cabeceras: string[] = [];

  try {
    await ejecutarConReintento(
      async () => {
        await hoja.loadHeaderRow();
      },
      {
        onReintento: (err, intento, delay) => {
          console.warn(`[WARN] Reintentando loadHeaderRow (${intento}/3) tras ${delay}ms por error transitorio.`);
        },
      }
    );
    cabeceras = Array.isArray(hoja.headerValues) ? [...hoja.headerValues] : [];
  } catch (error) {
    // Si la hoja no tiene cabeceras aún (caso inicial estándar de google-spreadsheet)
    if (error instanceof Error && error.message.includes("No values in the header row")) {
      console.log("[INFO] La hoja no contiene cabeceras aún. Se inicializarán.");
      cabeceras = [];
    } else if (esErrorReintentableGoogle(error)) {
      // Manejo elegante ante 503 persistente tras agotar reintentos
      console.warn(
        "[WARN] Google Sheets no disponible al verificar cabeceras (503/transitorio). Continuando en modo degradado sin interrumpir la ejecución."
      );
      if (Array.isArray(hoja.headerValues) && hoja.headerValues.length > 0) {
        cabeceras = [...hoja.headerValues];
      } else {
        return;
      }
    } else {
      throw error;
    }
  }

  const columnasRequeridas = [COLUMNAS.ID_MENSAJE, COLUMNAS.ID_CHAT, COLUMNAS.ESTADO];
  let modificado = false;

  for (const col of columnasRequeridas) {
    if (!cabeceras.includes(col)) {
      console.log(`[INFO] Columna '${col}' no encontrada. Añadiéndola...`);
      cabeceras.push(col);
      modificado = true;
    }
  }

  if (modificado) {
    try {
      await ejecutarConReintento(
        async () => {
          await hoja.setHeaderRow(cabeceras);
        },
        {
          onReintento: (err, intento, delay) => {
            console.warn(`[WARN] Reintentando setHeaderRow (${intento}/3) tras ${delay}ms por error transitorio.`);
          },
        }
      );
    } catch (error) {
      if (esErrorReintentableGoogle(error)) {
        console.warn(
          "[WARN] No se pudieron actualizar las cabeceras por indisponibilidad de Google Sheets (503/transitorio). Se continúa degradado."
        );
        return;
      }
      throw error;
    }
  }
}

/**
 * Normaliza cualquier texto removiendo tildes, diacríticos, mayúsculas y espacios extra.
 */
export function normalizarTexto(txt: string | undefined | null): string {
  return (txt || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Busca en la hoja la fila cuyo ID de mensaje coincida.
 */
export function buscarFilaPorMensaje(filas: GoogleSpreadsheetRow[], messageId: number | string): GoogleSpreadsheetRow | null {
  return filas.find(
    (fila) => String(fila.toObject()[COLUMNAS.ID_MENSAJE]) === String(messageId)
  ) ?? null;
}

/**
 * Busca en la hoja la fila fija que corresponde a un municipio+nodo.
 */
export function buscarFilaPorNodo(filas: GoogleSpreadsheetRow[], municipioOficial: string, nodo: number | string): GoogleSpreadsheetRow | null {
  const munBuscado = normalizarTexto(municipioOficial);
  const nodBuscado = parseInt(String(nodo), 10);

  return filas.find((fila) => {
    const munFila = normalizarTexto(fila.get(COLUMNAS.MUNICIPIO));
    const nodFila = parseInt(fila.get(COLUMNAS.NODO) || "0", 10);
    return munFila === munBuscado && nodFila === nodBuscado;
  }) ?? null;
}

/**
 * Resetea los datos de reporte de una fila fija, protegiendo fila.save() con reintentos.
 */
export async function resetearFila(fila: GoogleSpreadsheetRow): Promise<void> {
  fila.set(COLUMNAS.TOTAL_VERIFICADORES, "0");
  fila.set(COLUMNAS.BLOQUE_1,            "0");
  fila.set(COLUMNAS.BLOQUE_2,            "0");
  fila.set(COLUMNAS.BLOQUE_3,            "0");
  fila.set(COLUMNAS.FECHA,               "");
  fila.set(COLUMNAS.HORA,                "");
  fila.set(COLUMNAS.REMITENTE,           "");
  fila.set(COLUMNAS.ID_MENSAJE,          "");
  fila.set(COLUMNAS.ID_CHAT,             "");
  fila.set(COLUMNAS.ESTADO,              "");

  await ejecutarConReintento(
    async () => {
      await fila.save();
    },
    {
      onReintento: (err, intento, delay) => {
        console.warn(`[WARN] Reintentando fila.save() en resetearFila (${intento}/3) tras ${delay}ms.`);
      },
    }
  );
}

/**
 * Resetea todas las filas que tengan una fecha distinta al día de hoy en la zona horaria configurada.
 */
export async function resetearFilasDeDiasAnteriores(doc: GoogleSpreadsheet): Promise<number> {
  const hoja = doc.sheetsByTitle["registros_telegram"];
  if (!hoja) return 0;

  const filas = await ejecutarConReintento(
    async () => await hoja.getRows(),
    {
      onReintento: (err, intento, delay) => {
        console.warn(`[WARN] Reintentando lectura de filas (${intento}/3) en resetearFilasDeDiasAnteriores tras ${delay}ms.`);
      },
    }
  );

  const hoyStr = obtenerFechaHoyEstandar();

  const fechasAnteriores = new Set<string>();
  for (const fila of filas) {
    const rawFecha = (fila.get(COLUMNAS.FECHA) || "").trim();
    const fechaFila = estandarizarFecha(rawFecha) || rawFecha;
    if (fechaFila && fechaFila !== hoyStr) {
      fechasAnteriores.add(fechaFila);
    }
  }

  for (const fechaAnterior of fechasAnteriores) {
    console.log(`[INFO] Detectada fecha de día anterior (${fechaAnterior}) en la hoja principal. Ejecutando resguardo preventivo...`);
    await guardarHistoricoDiario(doc, fechaAnterior);
  }

  let reseteadas = 0;
  for (const fila of filas) {
    const rawFecha = (fila.get(COLUMNAS.FECHA) || "").trim();
    const fechaFila = estandarizarFecha(rawFecha) || rawFecha;
    if (fechaFila && fechaFila !== hoyStr) {
      const municipio = fila.get(COLUMNAS.MUNICIPIO);
      const nodo = fila.get(COLUMNAS.NODO);
      console.log(`[INFO] Reseteando fila del día anterior (${fechaFila}) para ${municipio} (Nodo ${nodo})`);
      await resetearFila(fila);
      reseteadas++;
    }
  }

  if (reseteadas > 0) {
    console.log(`[INFO] Reseteo de registros de días anteriores completado: ${reseteadas} fila(s) reseteada(s).`);
  } else {
    console.log("[INFO] Reseteo de registros de días anteriores completado: no había filas de días anteriores.");
  }
  return reseteadas;
}

/**
 * Guarda todos los registros correspondientes a una fecha específica en la hoja registros_historicos_telegram.
 */
export async function guardarHistoricoDiario(doc: GoogleSpreadsheet, fechaEspecifica: string | null = null): Promise<void> {
  console.log("[INFO] Guardando histórico diario en la hoja 'registros_historicos_telegram'...");
  
  const hojaPrincipal = doc.sheetsByTitle["registros_telegram"];
  if (!hojaPrincipal) return;

  const filas = await ejecutarConReintento(
    async () => await hojaPrincipal.getRows(),
    {
      onReintento: (err, intento, delay) => {
        console.warn(`[WARN] Reintentando hojaPrincipal.getRows() (${intento}/3) tras ${delay}ms.`);
      },
    }
  );

  let fechaReporte = fechaEspecifica ? (estandarizarFecha(fechaEspecifica) || fechaEspecifica) : null;
  if (!fechaReporte) {
    for (const fila of filas) {
      const fVal = (fila.get(COLUMNAS.FECHA) || "").trim();
      if (fVal) {
        fechaReporte = estandarizarFecha(fVal) || fVal;
        break;
      }
    }
  }

  if (!fechaReporte) {
    console.log("[INFO] No se encontraron reportes con fecha para respaldar. Omitiendo histórico.");
    return;
  }

  let sheetHistorica = doc.sheetsByTitle["registros_historicos_telegram"];
  if (!sheetHistorica) {
    console.log("[INFO] Creando la hoja 'registros_historicos_telegram' ya que no existía...");
    sheetHistorica = await ejecutarConReintento(
      async () => await doc.addSheet({ title: "registros_historicos_telegram" }),
      {
        onReintento: (err, intento, delay) => {
          console.warn(`[WARN] Reintentando doc.addSheet() (${intento}/3) tras ${delay}ms.`);
        },
      }
    );
  }

  try {
    await ejecutarConReintento(async () => await sheetHistorica.loadHeaderRow());
  } catch (err) {
    console.log("[INFO] Inicializando cabeceras en 'registros_historicos_telegram'...");
    await ejecutarConReintento(async () => {
      await sheetHistorica.setHeaderRow([
        COLUMNAS.MUNICIPIO,
        COLUMNAS.NODO,
        COLUMNAS.TOTAL_VERIFICADORES,
        COLUMNAS.BLOQUE_1,
        COLUMNAS.BLOQUE_2,
        COLUMNAS.BLOQUE_3,
        COLUMNAS.FECHA,
        COLUMNAS.HORA,
        COLUMNAS.REMITENTE,
        COLUMNAS.ID_MENSAJE,
        COLUMNAS.ID_CHAT,
        COLUMNAS.ESTADO
      ]);
    });
  }

  const filasHistoricas = await ejecutarConReintento(async () => await sheetHistorica.getRows());
  let filasFechaActual = filasHistoricas.filter(f => {
    const rawF = (f.get(COLUMNAS.FECHA) || "").trim();
    const stdF = estandarizarFecha(rawF) || rawF;
    return stdF === fechaReporte;
  });

  // Auto-limpieza de seguridad si existieran filas duplicadas (>46) para la misma fecha
  if (filasFechaActual.length > 46) {
    console.log(`[ADVERTENCIA] Detectadas ${filasFechaActual.length} filas en histórico para la fecha ${fechaReporte}. Limpiando filas duplicadas sobrantes...`);
    const sobrantes = filasFechaActual.slice(46);
    for (let i = sobrantes.length - 1; i >= 0; i--) {
      await ejecutarConReintento(async () => await sobrantes[i].delete());
    }
    filasFechaActual = filasFechaActual.slice(0, 46);
  }

  // Mapear datos desde la base de datos Supabase si está activa (fallback/fuente de verdad)
  const mapaDB = new Map<number, any>();
  try {
    const dbModule = await import("./database.js");
    if (dbModule.esDBActiva()) {
      const client = dbModule.obtenerClienteDB();
      if (client) {
        const partes = fechaReporte.split("/");
        const fechaIso = partes.length === 3 ? `${partes[2]}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}` : fechaReporte;
        const { data } = await client
          .from("reportes_diarios")
          .select("*")
          .or(`fecha.eq.${fechaIso},fecha.eq.${fechaReporte}`);
        if (data) {
          data.forEach((r: any) => {
            const nod = parseInt(String(r.nodo), 10);
            if (nod > 0) mapaDB.set(nod, r);
          });
        }
      }
    }
  } catch (e: any) {
    console.warn("[ADVERTENCIA] No se pudo obtener la base de datos para resguardo histórico:", e.message);
  }

  // Mapear datos de la hoja principal en vivo
  const mapaPrincipal = new Map<number, any>();
  for (const f of filas) {
    const obj = f.toObject();
    const rawFilaFecha = (obj[COLUMNAS.FECHA] || "").trim();
    const stdFilaFecha = estandarizarFecha(rawFilaFecha) || rawFilaFecha;
    if (stdFilaFecha === fechaReporte) {
      const nod = parseInt(obj[COLUMNAS.NODO] || "0", 10);
      if (nod > 0) mapaPrincipal.set(nod, obj);
    }
  }

  if (filasFechaActual.length > 0) {
    console.log(`[INFO] Los registros del día ${fechaReporte} ya están en el histórico. Consolidando y actualizando celdas...`);

    const minRowIndex = Math.min(...filasFechaActual.map(f => f.rowNumber - 1));
    const maxRowIndex = Math.max(...filasFechaActual.map(f => f.rowNumber - 1));

    await ejecutarConReintento(async () => {
      await sheetHistorica.loadCells({
        startRowIndex: minRowIndex,
        endRowIndex: maxRowIndex + 1,
        startColumnIndex: 0,
        endColumnIndex: 12
      });
    });

    await ejecutarConReintento(async () => await sheetHistorica.loadHeaderRow());
    const headers = sheetHistorica.headerValues;
    const colIdx = {
      tot: headers.indexOf(COLUMNAS.TOTAL_VERIFICADORES),
      b1: headers.indexOf(COLUMNAS.BLOQUE_1),
      b2: headers.indexOf(COLUMNAS.BLOQUE_2),
      b3: headers.indexOf(COLUMNAS.BLOQUE_3),
      fecha: headers.indexOf(COLUMNAS.FECHA),
      hora: headers.indexOf(COLUMNAS.HORA),
      rem: headers.indexOf(COLUMNAS.REMITENTE),
      msgId: headers.indexOf(COLUMNAS.ID_MENSAJE),
      chatId: headers.indexOf(COLUMNAS.ID_CHAT),
      estado: headers.indexOf(COLUMNAS.ESTADO),
    };

    let actualizados = 0;
    for (const filaHist of filasFechaActual) {
      const nod = parseInt(filaHist.get(COLUMNAS.NODO) || "0", 10);
      const repDB = mapaDB.get(nod);
      const datosPrincipal = mapaPrincipal.get(nod);

      let total = 0, b1 = 0, b2 = 0, b3 = 0;
      let hora = "", remitente = "", msgId = "", chatId = "", estado = "";
      let tieneDatos = false;

      if (repDB) {
        total = Number(repDB.total_verificadores ?? 0);
        b1 = Number(repDB.bloque_1 ?? 0);
        b2 = Number(repDB.bloque_2 ?? 0);
        b3 = Number(repDB.bloque_3 ?? 0);
        hora = repDB.hora || "";
        remitente = repDB.remitente || "";
        msgId = repDB.telegram_message_id ? String(repDB.telegram_message_id) : "";
        chatId = repDB.telegram_chat_id ? String(repDB.telegram_chat_id) : "";
        estado = repDB.estado || "OK";
        tieneDatos = true;
      } else if (datosPrincipal && (Number(datosPrincipal[COLUMNAS.TOTAL_VERIFICADORES] || 0) > 0 || (datosPrincipal[COLUMNAS.ID_MENSAJE] || "") !== "")) {
        total = Number(datosPrincipal[COLUMNAS.TOTAL_VERIFICADORES] || 0);
        b1 = Number(datosPrincipal[COLUMNAS.BLOQUE_1] || 0);
        b2 = Number(datosPrincipal[COLUMNAS.BLOQUE_2] || 0);
        b3 = Number(datosPrincipal[COLUMNAS.BLOQUE_3] || 0);
        hora = datosPrincipal[COLUMNAS.HORA] || "";
        remitente = datosPrincipal[COLUMNAS.REMITENTE] || "";
        msgId = datosPrincipal[COLUMNAS.ID_MENSAJE] || "";
        chatId = datosPrincipal[COLUMNAS.ID_CHAT] || "";
        estado = datosPrincipal[COLUMNAS.ESTADO] || "OK";
        tieneDatos = true;
      }

      if (tieneDatos) {
        const rowIndex = filaHist.rowNumber - 1;
        if (colIdx.tot >= 0) sheetHistorica.getCell(rowIndex, colIdx.tot).value = total;
        if (colIdx.b1 >= 0) sheetHistorica.getCell(rowIndex, colIdx.b1).value = b1;
        if (colIdx.b2 >= 0) sheetHistorica.getCell(rowIndex, colIdx.b2).value = b2;
        if (colIdx.b3 >= 0) sheetHistorica.getCell(rowIndex, colIdx.b3).value = b3;
        if (colIdx.fecha >= 0) sheetHistorica.getCell(rowIndex, colIdx.fecha).value = fechaReporte;
        if (colIdx.hora >= 0) sheetHistorica.getCell(rowIndex, colIdx.hora).value = hora;
        if (colIdx.rem >= 0) sheetHistorica.getCell(rowIndex, colIdx.rem).value = remitente;
        if (colIdx.msgId >= 0) sheetHistorica.getCell(rowIndex, colIdx.msgId).value = msgId;
        if (colIdx.chatId >= 0) sheetHistorica.getCell(rowIndex, colIdx.chatId).value = chatId;
        if (colIdx.estado >= 0) sheetHistorica.getCell(rowIndex, colIdx.estado).value = estado;
        actualizados++;
      }
    }

    if (actualizados > 0) {
      await ejecutarConReintento(async () => await sheetHistorica.saveUpdatedCells());
      console.log(`[INFO] Histórico del día ${fechaReporte} actualizado con éxito (${actualizados} nodos actualizados).`);
    }
    return;
  }

  const filasDatos = filas.map(f => {
    const obj = f.toObject();
    const nod = parseInt(obj[COLUMNAS.NODO] || "0", 10);
    const repDB = mapaDB.get(nod);
    const rawFilaFecha = (obj[COLUMNAS.FECHA] || "").trim();
    const stdFilaFecha = estandarizarFecha(rawFilaFecha) || rawFilaFecha;
    const esDeFechaResguardo = stdFilaFecha === fechaReporte;

    if (repDB) {
      return {
        [COLUMNAS.MUNICIPIO]: obj[COLUMNAS.MUNICIPIO] || "",
        [COLUMNAS.NODO]: obj[COLUMNAS.NODO] || "",
        [COLUMNAS.TOTAL_VERIFICADORES]: repDB.total_verificadores ?? 0,
        [COLUMNAS.BLOQUE_1]: repDB.bloque_1 ?? 0,
        [COLUMNAS.BLOQUE_2]: repDB.bloque_2 ?? 0,
        [COLUMNAS.BLOQUE_3]: repDB.bloque_3 ?? 0,
        [COLUMNAS.FECHA]: fechaReporte,
        [COLUMNAS.HORA]: repDB.hora || "",
        [COLUMNAS.REMITENTE]: repDB.remitente || "",
        [COLUMNAS.ID_MENSAJE]: repDB.telegram_message_id ? String(repDB.telegram_message_id) : "",
        [COLUMNAS.ID_CHAT]: repDB.telegram_chat_id ? String(repDB.telegram_chat_id) : "",
        [COLUMNAS.ESTADO]: repDB.estado || "OK"
      };
    } else if (esDeFechaResguardo) {
      return {
        [COLUMNAS.MUNICIPIO]: obj[COLUMNAS.MUNICIPIO] || "",
        [COLUMNAS.NODO]: obj[COLUMNAS.NODO] || "",
        [COLUMNAS.TOTAL_VERIFICADORES]: obj[COLUMNAS.TOTAL_VERIFICADORES] || "",
        [COLUMNAS.BLOQUE_1]: obj[COLUMNAS.BLOQUE_1] || "",
        [COLUMNAS.BLOQUE_2]: obj[COLUMNAS.BLOQUE_2] || "",
        [COLUMNAS.BLOQUE_3]: obj[COLUMNAS.BLOQUE_3] || "",
        [COLUMNAS.FECHA]: stdFilaFecha || fechaReporte,
        [COLUMNAS.HORA]: obj[COLUMNAS.HORA] || "",
        [COLUMNAS.REMITENTE]: obj[COLUMNAS.REMITENTE] || "",
        [COLUMNAS.ID_MENSAJE]: obj[COLUMNAS.ID_MENSAJE] || "",
        [COLUMNAS.ID_CHAT]: obj[COLUMNAS.ID_CHAT] || "",
        [COLUMNAS.ESTADO]: obj[COLUMNAS.ESTADO] || ""
      };
    } else {
      return {
        [COLUMNAS.MUNICIPIO]: obj[COLUMNAS.MUNICIPIO] || "",
        [COLUMNAS.NODO]: obj[COLUMNAS.NODO] || "",
        [COLUMNAS.TOTAL_VERIFICADORES]: "0",
        [COLUMNAS.BLOQUE_1]: "0",
        [COLUMNAS.BLOQUE_2]: "0",
        [COLUMNAS.BLOQUE_3]: "0",
        [COLUMNAS.FECHA]: fechaReporte,
        [COLUMNAS.HORA]: "",
        [COLUMNAS.REMITENTE]: "",
        [COLUMNAS.ID_MENSAJE]: "",
        [COLUMNAS.ID_CHAT]: "",
        [COLUMNAS.ESTADO]: ""
      };
    }
  });

  await ejecutarConReintento(async () => await sheetHistorica.addRows(filasDatos));
  console.log(`[INFO] Historial diario de la fecha ${fechaReporte} guardado con éxito. Se copiaron ${filasDatos.length} filas.`);
}

/**
 * Recorre el historial de filas para obtener los últimos valores acumulados del municipio/nodo.
 */
export function obtenerUltimosValores(
  filas: GoogleSpreadsheetRow[],
  municipio: string,
  nodo: number | string,
  fechaActual: string,
  filaExcluida: GoogleSpreadsheetRow | null = null
): HistorialAcumulado {
  let total = 0, b1 = 0, b2 = 0, b3 = 0;
  const munBuscado = normalizarTexto(municipio);
  const nodBuscado = parseInt(String(nodo), 10);

  for (let i = filas.length - 1; i >= 0; i--) {
    if (filaExcluida && filas[i].rowNumber === filaExcluida.rowNumber) continue;

    const obj      = filas[i].toObject();
    const munFila  = normalizarTexto(obj[COLUMNAS.MUNICIPIO]);
    const nodoFila = parseInt(obj[COLUMNAS.NODO], 10);
    const fechaFila = obj[COLUMNAS.FECHA] || "";

    if (munFila !== munBuscado || nodoFila !== nodBuscado) continue;
    if (fechaFila !== fechaActual) continue;

    if (!total) total = parseInt(obj[COLUMNAS.TOTAL_VERIFICADORES] || "0", 10);
    if (!b1)    b1    = parseInt(obj[COLUMNAS.BLOQUE_1] || "0", 10);
    if (!b2)    b2    = parseInt(obj[COLUMNAS.BLOQUE_2] || "0", 10);
    if (!b3)    b3    = parseInt(obj[COLUMNAS.BLOQUE_3] || "0", 10);

    if (total && b1 && b2 && b3) break;
  }

  return { total, b1, b2, b3 };
}
```

---

## 5. Verification Method

To independently verify the logic and blueprints before full implementation:

### 5.1 Verification Commands
1. Run existing regression test suite:
   ```bash
   npm test
   ```
   *Expected result*: All 18 tests pass with 0 failures.

2. Verify TypeScript type-checking without emitting files:
   ```bash
   npm run build
   ```
   *Expected result*: `tsc --noEmit` exits with status code 0.

3. Verify classifier and retry mechanics in isolation:
   ```bash
   npx tsx -e '
   import { esErrorReintentableGoogle, ejecutarConReintento } from "./src/utils/retry.js";
   console.log("Classifier test 503:", esErrorReintentableGoogle({ response: { status: 503 } }));
   console.log("Classifier test ECONNRESET:", esErrorReintentableGoogle({ code: "ECONNRESET" }));
   console.log("Classifier test 400:", esErrorReintentableGoogle({ response: { status: 400 } }));
   '
   ```
   *Expected result*:
   - `Classifier test 503: true`
   - `Classifier test ECONNRESET: true`
   - `Classifier test 400: false`

4. Verify re-entrant mutex behavior:
   ```bash
   npx tsx -e '
   import { Mutex } from "./src/utils/mutex.js";
   const m = new Mutex();
   m.runExclusive(async () => {
     return await m.runExclusive(async () => "reentrant-ok");
   }).then(res => console.log("Mutex re-entrancy:", res));
   '
   ```
   *Expected result*: `Mutex re-entrancy: reentrant-ok` (no deadlock, resolves immediately).

### 5.2 Invalidation Conditions
- If `esErrorReintentableGoogle` returns `true` for HTTP 400, 401, or 404, the blueprint is invalidated (non-transient errors must not be retried).
- If `ejecutarConReintento` blocks for $> 100\text{ms}$ during test runs when `process.env.NODE_ENV === "test"`, the test acceleration logic is invalidated.
- If calling `sheetsMutex.runExclusive` inside another `sheetsMutex.runExclusive` execution tree hangs indefinitely, the mutex re-entrancy guard is invalidated.
