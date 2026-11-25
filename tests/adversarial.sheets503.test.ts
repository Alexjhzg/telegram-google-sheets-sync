import test from "node:test";
import assert from "node:assert/strict";
import { Bot } from "grammy";
import { config } from "../src/config/index.js";
import { procesarYGuardarReporte } from "../src/services/reportProcessor.js";
import { registrarHandlers } from "../src/handlers/message.js";
import { ejecutarLimpieza } from "../src/jobs/cleanup.js";
import {
  setHojaDeCalculoProviderForTesting,
  sheetsMutex,
  COLUMNAS,
} from "../src/services/sheets.js";
import { createMockWorksheet, createMockGoogleSpreadsheet } from "./helpers/mockSheets.js";
import { createGoogle503Error } from "./helpers/errorSimulation.js";
import { DatosReporteProcesar } from "../src/types/index.js";

function generarDatosReporte(
  nodo = 16039,
  municipio = "Maturín",
  messageId = 55555
): DatosReporteProcesar {
  return {
    reporte: {
      municipio,
      nodo,
      totalVerificadores: 2,
      bloque1: 2,
      bloque2: null,
      bloque3: null,
    },
    tiempo: {
      fecha: "14/08/2026",
      hora: "09:15 AM",
    },
    remitente: "Supervisor Adversarial",
    messageId,
    chatId: -1001999999,
    creationTimestamp: Math.floor(new Date("2026-08-14T09:15:00-04:00").getTime() / 1000),
    editTimestamp: null,
    esEdicion: false,
  };
}

function crearBotHarness() {
  const bot = new Bot("123456789:dummy_token_for_adversarial_testing", {
    botInfo: {
      id: 123456789,
      is_bot: true,
      first_name: "TestBot",
      username: "test_bot",
      can_join_groups: true,
      can_read_all_group_messages: true,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      can_manage_bots: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
    } as any,
  });
  const mensajesEnviados: Array<{ text: string; params: any }> = [];
  const reaccionesEnviadas: Array<{ emoji: string; messageId: number }> = [];

  bot.api.config.use(async (prev, method, payload) => {
    if (method === "sendMessage") {
      mensajesEnviados.push({ text: (payload as any).text, params: payload });
      return {
        ok: true,
        result: {
          message_id: 8888,
          date: Math.floor(Date.now() / 1000),
          chat: { id: (payload as any).chat_id },
          text: (payload as any).text,
        },
      } as any;
    }
    if (method === "setMessageReaction") {
      const reactionArr = (payload as any).reaction;
      const emoji = Array.isArray(reactionArr) ? reactionArr[0]?.emoji : reactionArr?.emoji;
      reaccionesEnviadas.push({ emoji, messageId: (payload as any).message_id });
      return { ok: true, result: true } as any;
    }
    if (method === "deleteMessage") {
      return { ok: true, result: true } as any;
    }
    return { ok: true, result: true } as any;
  });

  registrarHandlers(bot);

  let botCatchError: any = null;
  bot.catch((err) => {
    botCatchError = err.error || err;
    console.error("[ADVERSARIAL TEST] bot.catch capturó un error:", err);
  });

  return {
    bot,
    mensajesEnviados,
    reaccionesEnviadas,
    getBotCatchError: () => botCatchError,
  };
}

function generarTextoReporteValido(municipio = "Maturín", nodo = 16039): string {
  return (
    `Formato de reporte:\n` +
    `1. Municipio: ${municipio}\n` +
    `2. Nodo: ${nodo}\n` +
    `3. Total de Verificadores en el nodo: 2\n` +
    `➡️Bloque (1) 9am: 2\n` +
    `➡️Bloque (2) 2pm: 0\n` +
    `➡️Bloque (3) 6pm: 0`
  );
}

// ============================================================================
// 1. REPORTE BAJO FALLOS EXTREMOS (FLAPPING 503: FAIL -> PASS -> FAIL)
// ============================================================================

test("adversarial - flapping multi-etapa: 503 en getRows, setHeaderRow y row.save() recupera con éxito", async () => {
  // Configurar hoja con fallos 503 transitorios (1 fallo por operación, recupera en intento 2)
  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    headers: [
      "Municipio",
      "Nodo",
      "Total Verificadores",
      "Bloque 1 (9am)",
      "Bloque 2 (2pm)",
      "Bloque 3 (6pm)",
      "Fecha",
      "Hora",
      "Remitente",
    ],
    rows: [{ Municipio: "Maturín", Nodo: "16039", Fecha: "14/08/2026" }],
    failAttemptsOnGetRows: 1, // Fallo 1: getRows falla con 503, intento 2 pasa
    failAttemptsOnSetHeader: 1, // Fallo 2: setHeaderRow falla con 503 en asegurarColumnas, intento 2 pasa
    failAttemptsOnSave: 1, // Fallo 3: fila.save() falla con 503, intento 2 pasa
  });

  const hojaNodos = createMockWorksheet({
    title: "verificadores_nodo",
    headers: ["MUNICIPIO", "NODO", "CANTIDAD DE VERIFICADORES"],
    rows: [{ MUNICIPIO: "Maturín", NODO: "16039", "CANTIDAD DE VERIFICADORES": "5" }],
  });

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: hojaNodos,
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  try {
    const payload = generarDatosReporte();
    const resultado = await procesarYGuardarReporte(payload);

    assert.equal(
      resultado.valido,
      true,
      "El reporte debe ser válido a pesar del flapping multi-etapa"
    );
    assert.equal(
      resultado.sincronizadoSheets,
      true,
      "Debe sincronizar con Sheets tras recuperarse"
    );
    assert.equal(hojaTelegram.stats.getRowsCalls, 2, "getRows debió reintentarse");
    assert.equal(hojaTelegram.stats.setHeaderCalls, 2, "setHeaderRow debió reintentarse");
    assert.equal(hojaTelegram.stats.saveCalls, 2, "row.save debió reintentarse");
    assert.equal(resultado.totalFinal, 2);
  } finally {
    setHojaDeCalculoProviderForTesting(null);
  }
});

test("adversarial - flapping secuencial entre reportes consecutivos: reporte 1 (flapping éxito) -> reporte 2 (503 persistente) -> reporte 3 (inmediato éxito)", async () => {
  // Hoja compartida para 3 reportes en serie
  let saveFailuresRemaining = 0;

  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    rows: [
      { Municipio: "Maturín", Nodo: "16039", Fecha: "14/08/2026" },
      { Municipio: "Maturín", Nodo: "16040", Fecha: "14/08/2026" },
      { Municipio: "Maturín", Nodo: "16041", Fecha: "14/08/2026" },
    ],
  });

  // Interceptar saveCalls dinámicamente según el escenario
  hojaTelegram.setRowSaveFailure(0, 1); // Reporte 1: 1 fallo 503 (flapping -> pasa en intento 2)
  hojaTelegram.setRowSaveFailure(1, 10); // Reporte 2: 10 fallos 503 (falla permanente)
  hojaTelegram.setRowSaveFailure(2, 0); // Reporte 3: 0 fallos (pasa inmediatamente)

  const hojaNodos = createMockWorksheet({
    title: "verificadores_nodo",
    headers: ["MUNICIPIO", "NODO", "CANTIDAD DE VERIFICADORES"],
    rows: [
      { MUNICIPIO: "Maturín", NODO: "16039", "CANTIDAD DE VERIFICADORES": "10" },
      { MUNICIPIO: "Maturín", NODO: "16040", "CANTIDAD DE VERIFICADORES": "10" },
      { MUNICIPIO: "Maturín", NODO: "16041", "CANTIDAD DE VERIFICADORES": "10" },
    ],
  });

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: hojaNodos,
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  let unhandledCaptured = false;
  const unhandledHandler = () => {
    unhandledCaptured = true;
  };
  process.on("unhandledRejection", unhandledHandler);

  try {
    // 1. Reporte 1 (Flapping -> Éxito)
    const res1 = await procesarYGuardarReporte(generarDatosReporte(16039, "Maturín", 101));
    assert.equal(res1.valido, true, "Reporte 1 debe procesarse con éxito");
    assert.equal(res1.sincronizadoSheets, true, "Reporte 1 debe estar sincronizado en Sheets");

    // 2. Reporte 2 (503 Permanente -> Degradación con DB o Error controlado sin DB)
    const res2 = await procesarYGuardarReporte(generarDatosReporte(16040, "Maturín", 102));
    if (config.db.enabled) {
      assert.equal(res2.valido, true, "Reporte 2 debe degradar graciosamente en DB");
      assert.equal(
        res2.sincronizadoSheets,
        false,
        "Reporte 2 tiene sincronización diferida en Sheets"
      );
      assert.equal(res2.persistidoDB, true, "Reporte 2 resguardado en DB");
    } else {
      assert.equal(res2.valido, false, "Reporte 2 sin DB debe retornar fallo controlado");
      assert.equal(res2.razon, "ERROR_CONEXION_SHEETS");
    }

    // 3. Reporte 3 (Inmediato Éxito -> Recuperación del sistema)
    const res3 = await procesarYGuardarReporte(generarDatosReporte(16041, "Maturín", 103));
    assert.equal(res3.valido, true, "Reporte 3 debe procesarse con éxito inmediatamente");
    assert.equal(
      res3.sincronizadoSheets,
      true,
      "Reporte 3 debe sincronizar normalmente con Sheets"
    );

    // Verificar que sheetsMutex sigue funcional y desbloqueado
    let lockExclusivo = false;
    await sheetsMutex.runExclusive(() => {
      lockExclusivo = true;
    });
    assert.equal(lockExclusivo, true, "sheetsMutex debe quedar libre tras la secuencia de fallos");
    assert.equal(unhandledCaptured, false, "Cero unhandled rejections a lo largo de la secuencia");
  } finally {
    process.off("unhandledRejection", unhandledHandler);
    setHojaDeCalculoProviderForTesting(null);
  }
});

// ============================================================================
// 2. PERMANENTE 503 CON BASE DE DATOS HABILITADA
// ============================================================================

test("adversarial - 503 permanente con DB activa: degradación graciosa, sincronizado_sheets=false, cero unhandled rejections", async () => {
  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    rows: [{ Municipio: "Maturín", Nodo: "16039", Fecha: "14/08/2026" }],
    failAttemptsOnSave: 10, // 503 permanente
  });

  const hojaNodos = createMockWorksheet({
    title: "verificadores_nodo",
    headers: ["MUNICIPIO", "NODO", "CANTIDAD DE VERIFICADORES"],
    rows: [{ MUNICIPIO: "Maturín", NODO: "16039", "CANTIDAD DE VERIFICADORES": "5" }],
  });

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: hojaNodos,
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  let unhandledErrors: any[] = [];
  const rejectionHandler = (reason: any) => {
    unhandledErrors.push(reason);
  };
  process.on("unhandledRejection", rejectionHandler);

  const prevDbEnabled = config.db.enabled;
  config.db.enabled = true; // Asegurar DB activa

  try {
    const payload = generarDatosReporte(16039, "Maturín", 7001);
    const resultado = await procesarYGuardarReporte(payload);

    assert.equal(
      resultado.valido,
      true,
      "Con DB activa, el reporte debe ser aceptado con degradación"
    );
    assert.equal(resultado.sincronizadoSheets, false, "sincronizadoSheets debe ser false");
    assert.equal(resultado.persistidoDB, true, "persistidoDB debe ser true");
    assert.equal(resultado.totalFinal, 2);

    await new Promise((r) => setTimeout(r, 30));
    assert.equal(unhandledErrors.length, 0, "No debe registrarse ningún unhandledRejection");
  } finally {
    config.db.enabled = prevDbEnabled;
    process.off("unhandledRejection", rejectionHandler);
    setHojaDeCalculoProviderForTesting(null);
  }
});

test("adversarial - 503 permanente con DB activa en message handler: usuario recibe aviso informativo y bot.catch no explota", async () => {
  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    rows: [{ Municipio: "Maturín", Nodo: "16039", Fecha: "14/08/2026" }],
    failAttemptsOnSave: 10,
  });

  const hojaNodos = createMockWorksheet({
    title: "verificadores_nodo",
    headers: ["MUNICIPIO", "NODO", "CANTIDAD DE VERIFICADORES"],
    rows: [{ MUNICIPIO: "Maturín", NODO: "16039", "CANTIDAD DE VERIFICADORES": "5" }],
  });

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: hojaNodos,
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  const { bot, mensajesEnviados, reaccionesEnviadas, getBotCatchError } = crearBotHarness();

  const prevDbEnabled = config.db.enabled;
  const prevStartHour = config.app.workStartHour;
  const prevEndHour = config.app.workEndHour;

  config.db.enabled = true;
  config.app.workStartHour = 0; // Garantizar horario laboral en la prueba
  config.app.workEndHour = 24;

  try {
    const update = {
      update_id: 9901,
      message: {
        message_id: 8001,
        date: Math.floor(Date.now() / 1000),
        chat: { id: -100123456789, type: "supergroup", title: "Grupo Supervisión" },
        from: { id: 1111, first_name: "Carlos", username: "carlos_supervisor" },
        text: generarTextoReporteValido("Maturín", 16039),
      },
    };

    await bot.handleUpdate(update as any);

    // 1. bot.catch NUNCA debe haber sido disparado
    assert.equal(
      getBotCatchError(),
      null,
      "bot.catch no debe capturar errores; deben estar contenidos"
    );

    // 2. Debe haber reaccionado positivamente (porque el reporte fue aceptado en BD)
    assert.ok(reaccionesEnviadas.length > 0, "Debe registrarse reacción");
    assert.equal(reaccionesEnviadas[0].emoji, "👍", "Debe reaccionar con pulgar arriba");

    // 3. Debe haber enviado mensaje informativo sobre la sincronización diferida
    assert.ok(mensajesEnviados.length > 0, "Debe enviar mensaje al usuario");
    const msg = mensajesEnviados[0].text;
    assert.ok(
      msg.includes("Reporte resguardado en base de datos") || msg.includes("Google Sheets"),
      `El mensaje debe notificar resguardo y retraso de Sheets. Recibido: ${msg}`
    );
  } finally {
    config.db.enabled = prevDbEnabled;
    config.app.workStartHour = prevStartHour;
    config.app.workEndHour = prevEndHour;
    setHojaDeCalculoProviderForTesting(null);
  }
});

// ============================================================================
// 3. PERMANENTE 503 CON BASE DE DATOS DESHABILITADA
// ============================================================================

test("adversarial - 503 permanente con DB inactiva en message handler: envía aviso amigable 503 y bot.catch no explota", async () => {
  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    rows: [{ Municipio: "Maturín", Nodo: "16039", Fecha: "14/08/2026" }],
    failAttemptsOnSave: 10,
  });

  const hojaNodos = createMockWorksheet({
    title: "verificadores_nodo",
    headers: ["MUNICIPIO", "NODO", "CANTIDAD DE VERIFICADORES"],
    rows: [{ MUNICIPIO: "Maturín", NODO: "16039", "CANTIDAD DE VERIFICADORES": "5" }],
  });

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: hojaNodos,
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  const { bot, mensajesEnviados, reaccionesEnviadas, getBotCatchError } = crearBotHarness();

  const prevDbEnabled = config.db.enabled;
  const prevStartHour = config.app.workStartHour;
  const prevEndHour = config.app.workEndHour;

  config.db.enabled = false; // Sin BD relacional
  config.app.workStartHour = 0;
  config.app.workEndHour = 24;

  try {
    const update = {
      update_id: 9902,
      message: {
        message_id: 8002,
        date: Math.floor(Date.now() / 1000),
        chat: { id: -100123456789, type: "supergroup", title: "Grupo Supervisión" },
        from: { id: 2222, first_name: "María", username: "maria_supervisora" },
        text: generarTextoReporteValido("Maturín", 16039),
      },
    };

    await bot.handleUpdate(update as any);

    // 1. bot.catch NO debe activarse
    assert.equal(getBotCatchError(), null, "bot.catch no debe capturar errores al fallar Sheets");

    // 2. Debe reaccionar con pulgar abajo indicando que el reporte no pudo guardarse
    assert.ok(reaccionesEnviadas.length > 0, "Debe registrarse reacción");
    assert.equal(reaccionesEnviadas[0].emoji, "👎", "Debe reaccionar con pulgar abajo");

    // 3. Debe enviar mensaje descriptivo explicando la indisponibilidad 503
    assert.ok(mensajesEnviados.length > 0, "Debe enviar mensaje al usuario");
    const msg = mensajesEnviados[0].text;
    assert.ok(
      msg.includes("503") ||
        msg.includes("Conexión temporalmente no disponible") ||
        msg.includes("Aviso de servicio"),
      `El mensaje debe informar al usuario sobre error 503 o conexión temporalmente no disponible. Recibido: ${msg}`
    );
  } finally {
    config.db.enabled = prevDbEnabled;
    config.app.workStartHour = prevStartHour;
    config.app.workEndHour = prevEndHour;
    setHojaDeCalculoProviderForTesting(null);
  }
});

// ============================================================================
// 4. RUTINAS DE LIMPIEZA BAJO FALLO ADVERSARIAL POR LOTES (FILAS INTERCALADAS)
// ============================================================================

test("adversarial.cleanup - fallos 503 intercalados en lote: filas 1, 3, 5 fallan 503; filas 2, 4 se limpian exitosamente", async () => {
  // Configurar 5 filas expiradas que deben limpiarse
  const timestampExpirado = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    rows: [
      {
        rowNumber: 2,
        Municipio: "Maturín",
        Nodo: "1001",
        "Total Verificadores": "5",
        "Bloque 1 (9am)": "5",
        "ID Mensaje": "5001",
        "ID Chat": "-100111",
        Estado: `Revisión desde: ${timestampExpirado}`,
      },
      {
        rowNumber: 3,
        Municipio: "Cedeño",
        Nodo: "1002",
        "Total Verificadores": "4",
        "Bloque 1 (9am)": "4",
        "ID Mensaje": "5002",
        "ID Chat": "-100111",
        Estado: `Revisión desde: ${timestampExpirado}`,
      },
      {
        rowNumber: 4,
        Municipio: "Piar",
        Nodo: "1003",
        "Total Verificadores": "3",
        "Bloque 1 (9am)": "3",
        "ID Mensaje": "5003",
        "ID Chat": "-100111",
        Estado: `Revisión desde: ${timestampExpirado}`,
      },
      {
        rowNumber: 5,
        Municipio: "Acosta",
        Nodo: "1004",
        "Total Verificadores": "2",
        "Bloque 1 (9am)": "2",
        "ID Mensaje": "5004",
        "ID Chat": "-100111",
        Estado: `Revisión desde: ${timestampExpirado}`,
      },
      {
        rowNumber: 6,
        Municipio: "Caripe",
        Nodo: "1005",
        "Total Verificadores": "1",
        "Bloque 1 (9am)": "1",
        "ID Mensaje": "5005",
        "ID Chat": "-100111",
        Estado: `Revisión desde: ${timestampExpirado}`,
      },
    ],
  });

  // Configurar fallos 503 permanentes en filas de índices pares: 0 (Nodo 1001), 2 (Nodo 1003), 4 (Nodo 1005)
  // Las filas de índices impares: 1 (Nodo 1002) y 3 (Nodo 1004) responderán OK en save()
  hojaTelegram.setRowSaveFailure(0, 10, createGoogle503Error("503 en fila 1 (Nodo 1001)"));
  hojaTelegram.setRowSaveFailure(2, 10, createGoogle503Error("503 en fila 3 (Nodo 1003)"));
  hojaTelegram.setRowSaveFailure(4, 10, createGoogle503Error("503 en fila 5 (Nodo 1005)"));

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: createMockWorksheet({ title: "verificadores_nodo" }),
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  let unhandledCaptured = false;
  const unhandledHandler = () => {
    unhandledCaptured = true;
  };
  process.on("unhandledRejection", unhandledHandler);

  const prevDelay = config.app.cleanupRequestDelayMs;
  config.app.cleanupRequestDelayMs = 0; // Acelerar escaneo para pruebas

  try {
    // Escaneo con límite 10 (cubre todas las 5 filas)
    await ejecutarLimpieza({} as any, 10, true);

    const filasFinales = await hojaTelegram.getRows();

    // 1. Filas que fallaron con 503 (Nodos 1001, 1003, 1005): retienen sus valores, su error fue contenido
    const f1001 = filasFinales.find((f) => f.get(COLUMNAS.NODO) === "1001");
    const f1003 = filasFinales.find((f) => f.get(COLUMNAS.NODO) === "1003");
    const f1005 = filasFinales.find((f) => f.get(COLUMNAS.NODO) === "1005");

    assert.ok(f1001, "Fila 1001 debe existir");
    assert.equal(
      f1001.get(COLUMNAS.TOTAL_VERIFICADORES),
      "5",
      "Fila 1001 retiene su valor previo ante fallo 503"
    );

    assert.ok(f1003, "Fila 1003 debe existir");
    assert.equal(
      f1003.get(COLUMNAS.TOTAL_VERIFICADORES),
      "3",
      "Fila 1003 retiene su valor previo ante fallo 503"
    );

    assert.ok(f1005, "Fila 1005 debe existir");
    assert.equal(
      f1005.get(COLUMNAS.TOTAL_VERIFICADORES),
      "1",
      "Fila 1005 retiene su valor previo ante fallo 503"
    );

    // 2. Filas que tuvieron éxito (Nodos 1002 y 1004): se resetearon a cero a pesar de las fallas en las otras filas
    const f1002 = filasFinales.find((f) => f.get(COLUMNAS.NODO) === "1002");
    const f1004 = filasFinales.find((f) => f.get(COLUMNAS.NODO) === "1004");

    assert.ok(f1002, "Fila 1002 debe existir");
    assert.equal(
      f1002.get(COLUMNAS.TOTAL_VERIFICADORES),
      "0",
      "Fila 1002 debió resetearse exitosamente"
    );
    assert.equal(f1002.get(COLUMNAS.ESTADO), "", "Estado de fila 1002 debió limpiarse");

    assert.ok(f1004, "Fila 1004 debe existir");
    assert.equal(
      f1004.get(COLUMNAS.TOTAL_VERIFICADORES),
      "0",
      "Fila 1004 debió resetearse exitosamente"
    );
    assert.equal(f1004.get(COLUMNAS.ESTADO), "", "Estado de fila 1004 debió limpiarse");

    // 3. Confirmar que ninguna excepción huérfana escapó
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(
      unhandledCaptured,
      false,
      "Cero unhandled rejections durante escaneo con fallos intercalados"
    );
  } finally {
    config.app.cleanupRequestDelayMs = prevDelay;
    process.off("unhandledRejection", unhandledHandler);
    setHojaDeCalculoProviderForTesting(null);
  }
});

// ============================================================================
// 5. CONCURRENCIA Y ESTRÉS MUTEX BAJO FLAPPING 503
// ============================================================================

test("adversarial - concurrencia: múltiples reportes en paralelo con 503 intermitente procesan sin carreras ni deadlock", async () => {
  const rows = [];
  const verificadoresRows = [];
  for (let i = 1; i <= 6; i++) {
    const nodo = 17000 + i;
    rows.push({
      Municipio: "Maturín",
      Nodo: String(nodo),
      "Total Verificadores": "0",
      "Bloque 1 (9am)": "0",
      "Bloque 2 (2pm)": "0",
      "Bloque 3 (6pm)": "0",
      Fecha: "14/08/2026",
    });
    verificadoresRows.push({
      MUNICIPIO: "Maturín",
      NODO: String(nodo),
      "CANTIDAD DE VERIFICADORES": "10",
    });
  }

  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    rows,
  });

  // Filas impares (0, 2, 4) fallan 1 vez en save (flapping); filas pares (1, 3, 5) pasan directo
  hojaTelegram.setRowSaveFailure(0, 1);
  hojaTelegram.setRowSaveFailure(2, 1);
  hojaTelegram.setRowSaveFailure(4, 1);

  const hojaNodos = createMockWorksheet({
    title: "verificadores_nodo",
    headers: ["MUNICIPIO", "NODO", "CANTIDAD DE VERIFICADORES"],
    rows: verificadoresRows,
  });

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: hojaNodos,
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  let unhandledCaptured = false;
  const unhandledHandler = () => {
    unhandledCaptured = true;
  };
  process.on("unhandledRejection", unhandledHandler);

  try {
    const promesas = [];
    for (let i = 1; i <= 6; i++) {
      const nodo = 17000 + i;
      promesas.push(procesarYGuardarReporte(generarDatosReporte(nodo, "Maturín", 9000 + i)));
    }

    const resultados = await Promise.all(promesas);

    for (const res of resultados) {
      assert.equal(res.valido, true, "Todos los reportes concurrentes deben ser válidos");
      assert.equal(
        res.sincronizadoSheets,
        true,
        "Todos deben sincronizarse en Sheets tras recuperarse de 503"
      );
    }

    assert.equal(unhandledCaptured, false, "Cero unhandled rejections durante ráfaga concurrente");
    assert.equal(sheetsMutex.isLocked(), false, "sheetsMutex debe quedar completamente liberado");
  } finally {
    process.off("unhandledRejection", unhandledHandler);
    setHojaDeCalculoProviderForTesting(null);
  }
});

// ============================================================================
// 6. ELIMINACIÓN Y REVISIÓN BAJO 503
// ============================================================================

test("adversarial - eliminarReporte recupera tras 503 transitorio y no arroja excepciones", async () => {
  const { eliminarReporte } = await import("../src/services/reportProcessor.js");

  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    rows: [
      {
        Municipio: "Maturín",
        Nodo: "16039",
        "Total Verificadores": "3",
        "ID Mensaje": "9999",
        "ID Chat": "-1001",
      },
    ],
    failAttemptsOnSave: 1, // Flapping 503 en resetearFila
  });

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: createMockWorksheet({ title: "verificadores_nodo" }),
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  try {
    const resultado = await eliminarReporte(9999);
    assert.equal(resultado, true, "eliminarReporte debe retornar true al recuperarse del 503");
  } finally {
    setHojaDeCalculoProviderForTesting(null);
  }
});

test("adversarial - eliminarReporte bajo 503 permanente retorna false graciosamente sin unhandled rejection", async () => {
  const { eliminarReporte } = await import("../src/services/reportProcessor.js");

  const hojaTelegram = createMockWorksheet({
    title: "registros_telegram",
    rows: [
      {
        Municipio: "Maturín",
        Nodo: "16039",
        "Total Verificadores": "3",
        "ID Mensaje": "9999",
        "ID Chat": "-1001",
      },
    ],
    failAttemptsOnSave: 10, // 503 permanente
  });

  const mockDoc = createMockGoogleSpreadsheet({
    registros_telegram: hojaTelegram,
    verificadores_nodo: createMockWorksheet({ title: "verificadores_nodo" }),
    registros_historicos_telegram: createMockWorksheet({ title: "registros_historicos_telegram" }),
  });

  setHojaDeCalculoProviderForTesting(async () => mockDoc as any);

  let unhandledCaptured = false;
  const unhandledHandler = () => {
    unhandledCaptured = true;
  };
  process.on("unhandledRejection", unhandledHandler);

  try {
    const resultado = await eliminarReporte(9999);
    assert.equal(resultado, false, "eliminarReporte debe retornar false ante 503 permanente");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(unhandledCaptured, false, "No debe registrarse unhandledRejection");
  } finally {
    process.off("unhandledRejection", unhandledHandler);
    setHojaDeCalculoProviderForTesting(null);
  }
});
