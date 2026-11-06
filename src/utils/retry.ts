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
   * Alias de compatibilidad para el retraso base inicial.
   */
  delayInicialMs?: number;

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

  /**
   * Etiqueta contextual opcional para trazabilidad en logs.
   */
  contexto?: string;
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
  const retrasoBaseMs = opciones?.retrasoBaseMs ?? opciones?.delayInicialMs ?? 500;
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
