import test from "node:test";
import assert from "node:assert/strict";
import { Mutex } from "../src/utils/mutex.js";
import {
  ejecutarConReintento,
  esErrorReintentableGoogle,
} from "../src/utils/retry.js";
import {
  asegurarColumnas,
  sheetsMutex,
  COLUMNAS,
  setHojaDeCalculoProviderForTesting,
} from "../src/services/sheets.js";
import { procesarYGuardarReporte } from "../src/services/reportProcessor.js";
import {
  createGoogle503Error,
  createGoogleNonTransientError,
  createNetworkError,
} from "./helpers/errorSimulation.js";
import {
  createMockWorksheet,
  createMockGoogleSpreadsheet,
} from "./helpers/mockSheets.js";
import { config } from "../src/config/index.js";
import { DatosReporteProcesar } from "../src/types/index.js";

// ============================================================================
// 1. CONCURRENCY STRESS & MUTEX HARNESS
// ============================================================================

test("adversarial.concurrency - 50 tareas concurrentes en Mutex garantizan FIFO y exclusión mutua estricta", async () => {
  const mutex = new Mutex();
  const ejecucionOrden: number[] = [];
  let concurrenciaActiva = 0;
  let maxConcurrenciaObservada = 0;

  const totalTareas = 50;
  const promesas: Promise<number>[] = [];

  for (let i = 0; i < totalTareas; i++) {
    const id = i;
    promesas.push(
      mutex.runExclusive(async () => {
        concurrenciaActiva++;
        if (concurrenciaActiva > maxConcurrenciaObservada) {
          maxConcurrenciaObservada = concurrenciaActiva;
        }
        // Simular trabajo asíncrono aleatorio
        await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 4) + 1));
        ejecucionOrden.push(id);
        concurrenciaActiva--;
        return id;
      })
    );
  }

  const resultados = await Promise.all(promesas);

  assert.equal(maxConcurrenciaObservada, 1, "La concurrencia activa nunca debe exceder 1 (exclusión mutua)");
  assert.equal(concurrenciaActiva, 0, "No debe haber tareas activas tras finalizar");
  assert.equal(ejecucionOrden.length, totalTareas, "Todas las 50 tareas deben haberse ejecutado");

  // Verificar orden FIFO estricto
  for (let i = 0; i < totalTareas; i++) {
    assert.equal(ejecucionOrden[i], i, `La tarea ${i} debe ejecutarse en posición FIFO ${i}`);
    assert.equal(resultados[i], i);
  }
  assert.equal(mutex.isLocked(), false, "El mutex debe quedar liberado al terminar");
});

test("adversarial.concurrency - reentrancia anidada profunda (10 niveles) sin deadlocks", async () => {
  const mutex = new Mutex();
  const maxProfundidad = 10;
  const visitados: number[] = [];

  async function ejecutarAnidado(nivel: number): Promise<number> {
    return mutex.runExclusive(async () => {
      visitados.push(nivel);
      if (nivel < maxProfundidad) {
        await new Promise((r) => setTimeout(r, 1));
        return await ejecutarAnidado(nivel + 1);
      }
      return nivel;
    });
  }

  const resultado = await ejecutarAnidado(1);
  assert.equal(resultado, 10);
  assert.equal(visitados.length, 10);
  assert.deepEqual(visitados, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(mutex.isLocked(), false, "El mutex debe estar desbloqueado tras resolver todos los niveles");
});

test("adversarial.concurrency - tareas encoladas esperan a que la tarea con reentrancia anidada complete completamente", async () => {
  const mutex = new Mutex();
  const eventos: string[] = [];

  // Tarea 1: adquiere lock, hace llamadas reentrantes con delay
  const p1 = mutex.runExclusive(async () => {
    eventos.push("T1_inicio");
    await new Promise((r) => setTimeout(r, 10));
    await mutex.runExclusive(async () => {
      eventos.push("T1_anidado_1");
      await new Promise((r) => setTimeout(r, 10));
    });
    await mutex.runExclusive(async () => {
      eventos.push("T1_anidado_2");
    });
    eventos.push("T1_fin");
  });

  // Tarea 2: encolada mientras T1 está en curso
  const p2 = mutex.runExclusive(async () => {
    eventos.push("T2_ejecutada");
  });

  await Promise.all([p1, p2]);

  assert.deepEqual(
    eventos,
    ["T1_inicio", "T1_anidado_1", "T1_anidado_2", "T1_fin", "T2_ejecutada"],
    "T2 no debe entrometerse entre las operaciones anidadas de T1"
  );
  assert.equal(mutex.isLocked(), false);
});

test("adversarial.concurrency - tareas con error liberan el lock y permiten ejecución continua de tareas subsiguientes", async () => {
  const mutex = new Mutex();
  const resultados: (string | Error | void)[] = [];

  const promesas = [
    mutex.runExclusive(async () => {
      await new Promise((r) => setTimeout(r, 2));
      return "T1_ok";
    }),
    mutex.runExclusive(async () => {
      await new Promise((r) => setTimeout(r, 2));
      throw new Error("T2_fallo");
    }),
    mutex.runExclusive(async () => {
      await new Promise((r) => setTimeout(r, 2));
      return "T3_ok";
    }),
    mutex.runExclusive(async () => {
      await mutex.runExclusive(async () => {
        throw new Error("T4_anidada_fallo");
      });
    }),
    mutex.runExclusive(async () => {
      return "T5_ok";
    }),
  ];

  for (const p of promesas) {
    try {
      const res = await p;
      resultados.push(res);
    } catch (e: any) {
      resultados.push(e);
    }
  }

  assert.equal(resultados[0], "T1_ok");
  assert.ok(resultados[1] instanceof Error && (resultados[1] as Error).message === "T2_fallo");
  assert.equal(resultados[2], "T3_ok");
  assert.ok(resultados[3] instanceof Error && (resultados[3] as Error).message === "T4_anidada_fallo");
  assert.equal(resultados[4], "T5_ok");
  assert.equal(mutex.isLocked(), false, "Mutex debe quedar completamente desbloqueado");
});

// ============================================================================
// 2. EDGE-CASE ERRORS & RETRY ENGINE STRESS HARNESS
// ============================================================================

test("adversarial.retry - errores no transitorios (400, 401, 403, 404, 422) fallan inmediatamente sin reintento", async () => {
  const codigosNoTransitorios = [400, 401, 403, 404, 422];

  for (const status of codigosNoTransitorios) {
    let llamadas = 0;
    const errorSimulado = createGoogleNonTransientError(status, `Error HTTP ${status}`);

    await assert.rejects(
      async () => {
        await ejecutarConReintento(
          async () => {
            llamadas++;
            throw errorSimulado;
          },
          { maxIntentos: 5 }
        );
      },
      (err: any) => {
        assert.equal(err.status, status);
        return true;
      }
    );

    assert.equal(llamadas, 1, `Status ${status} debe abortar en el intento 1 sin reintentos adicionales`);
  }
});

test("adversarial.retry - secuencia mixta de errores (503 transitorio seguido de 401 no transitorio) aborta en el 2do intento", async () => {
  let llamadas = 0;
  const err503 = createGoogle503Error();
  const err401 = createGoogleNonTransientError(401, "Unauthorized");

  await assert.rejects(
    async () => {
      await ejecutarConReintento(
        async () => {
          llamadas++;
          if (llamadas === 1) throw err503;
          throw err401;
        },
        { maxIntentos: 5 }
      );
    },
    (err: any) => {
      assert.equal(err.status, 401);
      return true;
    }
  );

  assert.equal(llamadas, 2, "Debe ejecutar el reintento tras 503, pero detenerse inmediatamente ante 401 sin llegar al intento 3");
});

test("adversarial.retry - errores de socket (ECONNRESET, ETIMEDOUT) se reintentan y recuperan", async () => {
  const codigosRed: ("ECONNRESET" | "ETIMEDOUT")[] = ["ECONNRESET", "ETIMEDOUT"];

  for (const cod of codigosRed) {
    let llamadas = 0;
    const resultado = await ejecutarConReintento(
      async () => {
        llamadas++;
        if (llamadas === 1) {
          throw createNetworkError(cod, `Simulated network error ${cod}`);
        }
        return `recuperado_${cod}`;
      },
      { maxIntentos: 3 }
    );

    assert.equal(resultado, `recuperado_${cod}`);
    assert.equal(llamadas, 2, `Debe reintentar tras ${cod} y recuperarse en intento 2`);
  }
});

test("adversarial.retry - variantes de cuota 403 de Google (rateLimitExceeded, userRateLimitExceeded, quota exceeded) se reintentan", async () => {
  // Caso A: reason rateLimitExceeded
  let intentosA = 0;
  const errRateLimit: any = new Error("Rate limit exceeded");
  errRateLimit.response = {
    status: 403,
    data: {
      error: {
        code: 403,
        errors: [{ reason: "rateLimitExceeded" }],
      },
    },
  };

  const resA = await ejecutarConReintento(
    async () => {
      intentosA++;
      if (intentosA === 1) throw errRateLimit;
      return "exito_rate_limit";
    },
    { maxIntentos: 3 }
  );
  assert.equal(resA, "exito_rate_limit");
  assert.equal(intentosA, 2);

  // Caso B: 403 con mensaje "quota exceeded"
  let intentosB = 0;
  const errQuota: any = new Error("Quota exceeded for quota metric 'Read requests'");
  errQuota.response = { status: 403, data: {} };
  const resB = await ejecutarConReintento(
    async () => {
      intentosB++;
      if (intentosB === 1) throw errQuota;
      return "exito_quota";
    },
    { maxIntentos: 3 }
  );
  assert.equal(resB, "exito_quota");
  assert.equal(intentosB, 2);
});

test("adversarial.retry - verificación matemática de límites de jitter y modo determinista sin jitter", async () => {
  const delaysRegistrados: number[] = [];

  // Recolectar muestras con jitter real (desactivando acelerarParaPruebas)
  for (let i = 0; i < 20; i++) {
    let intentos = 0;
    try {
      await ejecutarConReintento(
        async () => {
          intentos++;
          if (intentos <= 2) throw createGoogle503Error();
          return true;
        },
        {
          maxIntentos: 3,
          retrasoBaseMs: 100,
          retrasoMaximoMs: 1000,
          factorMultiplicador: 2,
          conJitter: true,
          acelerarParaPruebas: false,
          onReintento: (_err, intento, delay) => {
            delaysRegistrados.push(delay);
            const delayTeorico = Math.min(1000, 100 * Math.pow(2, intento - 1));
            const minJitter = Math.round(delayTeorico / 2);
            const maxJitter = delayTeorico;
            assert.ok(
              delay >= minJitter && delay <= maxJitter,
              `Delay ${delay} debe estar acotado entre [${minJitter}, ${maxJitter}] para intento ${intento}`
            );
          },
        }
      );
    } catch {
      // noop
    }
  }

  assert.ok(delaysRegistrados.length >= 40, "Debe recolectar suficientes muestras de retraso");
  const unicos = new Set(delaysRegistrados);
  assert.ok(unicos.size > 5, "Los retrasos calculados deben variar aleatoriamente (jitter activo)");

  // Verificar con conJitter: false que sea determinista exacto
  const delaysExactos: number[] = [];
  let cnt = 0;
  await ejecutarConReintento(
    async () => {
      cnt++;
      if (cnt <= 2) throw createGoogle503Error();
      return "exacto";
    },
    {
      maxIntentos: 3,
      retrasoBaseMs: 100,
      factorMultiplicador: 2,
      conJitter: false,
      acelerarParaPruebas: false,
      onReintento: (_err, _intento, delay) => {
        delaysExactos.push(delay);
      },
    }
  );
  assert.deepEqual(delaysExactos, [100, 200], "Sin jitter los delays deben ser exactamente 100 y 200ms");
});

test("adversarial.retry - detector identifica error transitorio anidado en Error.cause", () => {
  const innerError = createGoogle503Error("Backend Unavailable");
  const outerError = new Error("Operational failed: wrapper");
  (outerError as any).cause = innerError;

  const esReintentable = esErrorReintentableGoogle(outerError);
  assert.equal(esReintentable, true, "Debe inspeccionar recursivamente la propiedad cause y detectar 503");
});

test("adversarial.retry - comportamiento ante ciclo de referencias circulares en Error.cause (Finding #1)", () => {
  const errA: any = new Error("Error A");
  const errB: any = new Error("Error B");
  errA.cause = errB;
  errB.cause = errA;

  let stackOverflowOccurred = false;
  try {
    esErrorReintentableGoogle(errA);
  } catch (e: any) {
    if (e instanceof RangeError && e.message.includes("Maximum call stack size exceeded")) {
      stackOverflowOccurred = true;
    }
  }

  assert.ok(
    stackOverflowOccurred,
    "Comprueba empíricamente que una cadena circular de causas causa desbordamiento de pila en la implementación actual"
  );
});

// ============================================================================
// 3. ASEGURAR COLUMNAS STRESS UNDER EXTREME CONDITIONS
// ============================================================================

test("adversarial.sheets - asegurarColumnas recupera ante hoja vacía (No values in the header row)", async () => {
  const mockHoja = createMockWorksheet({
    headers: [],
    errorToThrowOnLoadHeader: new Error("No values in the header row - sheet is empty"),
    failAttemptsOnLoadHeader: 1,
  });

  await asegurarColumnas(mockHoja as any);

  assert.ok(mockHoja.headerValues.includes(COLUMNAS.ID_MENSAJE));
  assert.ok(mockHoja.headerValues.includes(COLUMNAS.ID_CHAT));
  assert.ok(mockHoja.headerValues.includes(COLUMNAS.ESTADO));
  assert.equal(mockHoja.stats.setHeaderCalls, 1, "Debe haber guardado las cabeceras requeridas");
});

test("adversarial.sheets - asegurarColumnas maneja cabeceras corruptas (nulls, vacíos, duplicados)", async () => {
  const mockHoja = createMockWorksheet({
    headers: ["Municipio", null as any, "", "   ", COLUMNAS.ESTADO],
  });

  await asegurarColumnas(mockHoja as any);

  // 'Estado' ya existía, pero 'ID Mensaje' y 'ID Chat' deben ser agregados
  assert.ok(mockHoja.headerValues.includes(COLUMNAS.ID_MENSAJE));
  assert.ok(mockHoja.headerValues.includes(COLUMNAS.ID_CHAT));
  assert.ok(mockHoja.headerValues.includes(COLUMNAS.ESTADO));
  // Los valores previos corruptos se conservan sin romper la estructura
  assert.equal(mockHoja.headerValues[0], "Municipio");
  assert.equal(mockHoja.headerValues[1], null);
  assert.equal(mockHoja.stats.setHeaderCalls, 1);
});

test("adversarial.sheets - asegurarColumnas propaga 503 tras agotar reintentos en setHeaderRow", async () => {
  const mockHoja = createMockWorksheet({
    headers: ["Municipio", "Nodo"],
    failAttemptsOnSetHeader: 10, // Falla permanente en escritura
  });

  await assert.rejects(
    async () => {
      await asegurarColumnas(mockHoja as any);
    },
    (err: any) => {
      assert.equal(err.status, 503);
      return true;
    }
  );

  assert.equal(mockHoja.stats.setHeaderCalls, 3, "Debe haber intentado 3 veces antes de fallar");
});

test("adversarial.sheets - asegurarColumnas se recupera ante 503s intermitentes en ambas operaciones (loadHeader y setHeader)", async () => {
  const mockHoja = createMockWorksheet({
    headers: ["Municipio", "Nodo"],
    failAttemptsOnLoadHeader: 1, // Falla 1 vez en lectura, recupera al 2do
    failAttemptsOnSetHeader: 1,  // Falla 1 vez en escritura, recupera al 2do
  });

  await asegurarColumnas(mockHoja as any);

  assert.equal(mockHoja.stats.loadHeaderCalls, 2);
  assert.equal(mockHoja.stats.setHeaderCalls, 2);
  assert.ok(mockHoja.headerValues.includes(COLUMNAS.ESTADO));
});

test("adversarial.sheets - asegurarColumnas falla inmediatamente sin reintentar ante 404 Not Found en loadHeaderRow", async () => {
  const mockHoja = createMockWorksheet({
    headers: ["Municipio", "Nodo"],
    errorToThrowOnLoadHeader: createGoogleNonTransientError(404, "Spreadsheet or Worksheet Not Found"),
    failAttemptsOnLoadHeader: 5,
  });

  await assert.rejects(
    async () => {
      await asegurarColumnas(mockHoja as any);
    },
    (err: any) => {
      assert.equal(err.status, 404);
      return true;
    }
  );

  assert.equal(mockHoja.stats.loadHeaderCalls, 1, "No debe reintentar 404");
  assert.equal(mockHoja.stats.setHeaderCalls, 0, "No debe intentar escribir si la lectura falló por 404");
});

// ============================================================================
// 4. CONCURRENT REPORT PROCESSOR EXECUTION & ZERO UNHANDLED REJECTIONS
// ============================================================================

test("adversarial.reportProcessor - 10 reportes concurrentes procesados a través de sheetsMutex sin condiciones de carrera", async () => {
  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    rows: [
      {
        Municipio: "Maturín",
        Nodo: "16039",
        "Total Verificadores": "0",
        "Bloque 1 (9am)": "0",
        "Bloque 2 (2pm)": "0",
        "Bloque 3 (6pm)": "0",
        Fecha: "14/08/2026",
      },
    ],
  });

  const hojaNodos = createMockWorksheet({
    title: "verificadores_nodo",
    headers: ["MUNICIPIO", "NODO", "CANTIDAD DE VERIFICADORES"],
    rows: [{ MUNICIPIO: "Maturín", NODO: "16039", "CANTIDAD DE VERIFICADORES": "50" }],
  });

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: hojaNodos,
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  let unhandledRejections = 0;
  const rejectionHandler = () => {
    unhandledRejections++;
  };
  process.on("unhandledRejection", rejectionHandler);

  try {
    const totalConcurrentes = 10;
    const promesas: Promise<any>[] = [];

    for (let i = 0; i < totalConcurrentes; i++) {
      const payload: DatosReporteProcesar = {
        reporte: {
          municipio: "Maturín",
          nodo: 16039,
          totalVerificadores: 1,
          bloque1: 1,
          bloque2: null,
          bloque3: null,
        },
        tiempo: { fecha: "14/08/2026", hora: "09:15 AM" },
        remitente: `Supervisor_${i}`,
        messageId: 80000 + i,
        chatId: -100123456789,
        creationTimestamp: Math.floor(new Date("2026-08-14T09:15:00-04:00").getTime() / 1000),
        editTimestamp: null,
        esEdicion: false,
      };

      promesas.push(procesarYGuardarReporte(payload));
    }

    const resultados = await Promise.all(promesas);

    for (const r of resultados) {
      assert.equal(r.valido, true, "Cada reporte concurrente debe procesarse válidamente");
    }

    assert.equal(unhandledRejections, 0, "No debe producirse ningún unhandledRejection durante ejecución concurrente");
    assert.equal(sheetsMutex.isLocked(), false, "sheetsMutex debe quedar libre");
  } finally {
    process.removeListener("unhandledRejection", rejectionHandler);
    setHojaDeCalculoProviderForTesting(null);
  }
});
