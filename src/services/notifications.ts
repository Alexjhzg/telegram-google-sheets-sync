import { Api } from "grammy";
import { GoogleSpreadsheetRow } from "google-spreadsheet";
import { config } from "../config/index.js";
import { obtenerHojaDeCalculo, COLUMNAS } from "./sheets.js";

const FALLBACK_CHAT_ID = -1003785032543;

function resolverChatId(filasCargadas: GoogleSpreadsheetRow[] = []): number | string {
  if (process.env.TELEGRAM_REPORT_CHAT_ID) {
    return process.env.TELEGRAM_REPORT_CHAT_ID;
  }

  for (const row of filasCargadas) {
    const cId = row.get(COLUMNAS.ID_CHAT);
    if (cId) return cId;
  }

  return FALLBACK_CHAT_ID;
}

export async function enviarAvisoCierre(api: Api, corte: number): Promise<void> {
  console.log(`[INFO] Iniciando envío de aviso de cierre para el corte ${corte}...`);
  try {
    const MENSAJES_CIERRE: Record<number, string> = {
      1: `🔴 *Corte de las 9:00 am CERRADO*\n` +
         `🟢 *Bloque de las 2:00 pm ACTIVO*\n\n` +
         `Cualquier dato recibido de ahora en adelante se debe asignar al bloque de las 2pm y 6pm.`,
      2: `🔴 *Corte de las 2:00 pm CERRADO*\n` +
         `🟢 *Bloque de las 6:00 pm ACTIVO*\n\n` +
         `Cualquier dato recibido de ahora en adelante se asignará al bloque de las 6pm.`,
      3: `🔴 *Corte de las 6:00 pm CERRADO*\n` +
         `🏁 *Cierre de jornada de hoy completado*`,
    };

    const mensaje = MENSAJES_CIERRE[corte];
    if (!mensaje) {
      console.warn(`[ADVERTENCIA] No hay mensaje de cierre definido para el corte ${corte}.`);
      return;
    }

    let chatId: number | string;
    try {
      const doc = await obtenerHojaDeCalculo();
      const hoja = doc.sheetsByTitle["registros_telegram"];
      const rowsPrincipal = hoja ? await hoja.getRows() : [];
      chatId = resolverChatId(rowsPrincipal);
    } catch (e) {
      console.error("[ERROR] No se pudo obtener Chat ID de la hoja para aviso de cierre:", e);
      chatId = FALLBACK_CHAT_ID;
    }

    console.log(`[INFO] Enviando aviso de cierre (Corte: ${corte}) al Chat ID: ${chatId}`);
    await api.sendMessage(chatId, mensaje, { parse_mode: "Markdown" });
    console.log(`[INFO] Aviso de cierre del corte ${corte} enviado con éxito.`);
  } catch (err) {
    console.error(`[ERROR] Falló el envío del aviso de cierre del corte ${corte}:`, err);
  }
}

export async function enviarAvisoNodosFaltantes(api: Api): Promise<void> {
  console.log("[INFO] Iniciando generación de aviso de nodos sin reporte...");
  try {
    const doc = await obtenerHojaDeCalculo();
    const sheet = doc.sheetsByTitle["registros_telegram"];
    if (!sheet) {
      console.error("[ERROR] No se encontró la hoja 'registros_telegram' para verificar nodos faltantes.");
      return;
    }

    const filas = await sheet.getRows();

    const faltantesPorMunicipio: Record<string, string[]> = {};
    let totalFaltantes = 0;

    for (const fila of filas) {
      const municipio = (fila.get(COLUMNAS.MUNICIPIO) || "").trim();
      const nodo = (fila.get(COLUMNAS.NODO) || "").trim();
      const totalVerificadores = parseInt(fila.get(COLUMNAS.TOTAL_VERIFICADORES) || "0", 10);
      const idMensaje = (fila.get(COLUMNAS.ID_MENSAJE) || "").trim();
      const fecha = (fila.get(COLUMNAS.FECHA) || "").trim();

      if (municipio && nodo && totalVerificadores === 0 && !idMensaje && !fecha) {
        if (!faltantesPorMunicipio[municipio]) {
          faltantesPorMunicipio[municipio] = [];
        }
        faltantesPorMunicipio[municipio].push(nodo);
        totalFaltantes++;
      }
    }

    if (totalFaltantes === 0) {
      console.log("[INFO] Todos los nodos han reportado hoy. No se envía aviso de faltantes.");
      return;
    }

    console.log("[INFO] Guardando registro de incidencias en 'nodos_sin_reportes'...");
    try {
      let sheetSinReportes = doc.sheetsByTitle["nodos_sin_reportes"];
      if (!sheetSinReportes) {
        console.log("[INFO] Creando la hoja 'nodos_sin_reportes' ya que no existía...");
        sheetSinReportes = await doc.addSheet({ title: "nodos_sin_reportes" });
      }

      try {
        await sheetSinReportes.loadHeaderRow();
      } catch (_) {
        console.log("[INFO] Inicializando cabeceras en 'nodos_sin_reportes'...");
        await sheetSinReportes.setHeaderRow(["Fecha", "Municipio", "Nodo"]);
      }

      const opts: Intl.DateTimeFormatOptions = { timeZone: "America/Caracas", year: "numeric", month: "2-digit", day: "2-digit" };
      const hoyStr = new Date().toLocaleDateString("es-VE", opts);

      const filasExistentes = await sheetSinReportes.getRows();
      const yaExiste = filasExistentes.some(f => (f.get("Fecha") || "").trim() === hoyStr);

      if (yaExiste) {
        console.log(`[INFO] Los registros de nodos sin reporte para el día ${hoyStr} ya están guardados. Omitiendo duplicados.`);
      } else {
        const filasNuevas: Array<Record<string, string>> = [];
        for (const municipio of Object.keys(faltantesPorMunicipio)) {
          for (const nodo of faltantesPorMunicipio[municipio]) {
            filasNuevas.push({ "Fecha": hoyStr, "Municipio": municipio, "Nodo": String(nodo) });
          }
        }

        if (filasNuevas.length > 0) {
          await sheetSinReportes.addRows(filasNuevas);
          console.log(`[INFO] Se guardaron exitosamente ${filasNuevas.length} registros en 'nodos_sin_reportes'.`);
        }
      }
    } catch (errSheet) {
      console.error("[ERROR] Falló el guardado histórico en la hoja 'nodos_sin_reportes':", errSheet);
    }

    let mensaje = "⚠️ *NODOS SIN REPORTE REGISTRADO HOY*\n\n" +
                  "Municipios y sus respectivos nodos sin actividad:\n\n";

    const municipiosOrdenados = Object.keys(faltantesPorMunicipio).sort((a, b) => a.localeCompare(b));
    for (const municipio of municipiosOrdenados) {
      const nodos = faltantesPorMunicipio[municipio].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const nodosStr = nodos.map(n => `Nodo ${n}`).join(" • ");
      mensaje += `📍 *${municipio}* • ${nodosStr}\n\n`;
    }
    mensaje += "📝 _Estaremos registrando estas incidencias._";

    const chatId = resolverChatId(filas);
    console.log(`[INFO] Enviando aviso de nodos faltantes al Chat ID: ${chatId}`);
    await api.sendMessage(chatId, mensaje, { parse_mode: "Markdown" });
    console.log("[INFO] Aviso de nodos faltantes enviado con éxito.");

    if (config.telegram.managerChatIds.length > 0) {
      for (const managerId of config.telegram.managerChatIds) {
        console.log(`[INFO] Enviando copia del aviso de nodos faltantes al privado (Chat ID: ${managerId})`);
        try {
          await api.sendMessage(managerId, mensaje, { parse_mode: "Markdown" });
          console.log(`[INFO] Copia del aviso de nodos faltantes enviada a ${managerId} con éxito.`);
        } catch (managerErr) {
          console.error(`[ERROR] Falló el envío del aviso de nodos faltantes al privado ${managerId}:`, managerErr);
        }
      }
    }
  } catch (err) {
    console.error("[ERROR] Falló el envío del aviso de nodos faltantes:", err);
  }
}
