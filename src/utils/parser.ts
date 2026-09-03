import { config } from "../config/index.js";
import { ReporteParseado, TiempoConvertido, BloqueInfo } from "../types/index.js";

/**
 * Extrae los campos del reporte desde el texto del mensaje.
 *
 * Soporta formateo Markdown (negrita con asteriscos *), espacios
 * adicionales, saltos de línea variados y valores vacíos (0 por defecto).
 * Usa las horas clave (9am, 2pm, 6pm) como anclas de extracción.
 *
 * @param texto - Texto del mensaje de Telegram.
 * @returns Reporte parseado o null si falta municipio o nodo.
 */
export function parsearReporte(texto: string): (ReporteParseado & { bloque1: number | null; bloque2: number | null; bloque3: number | null }) | null {
  const regexMunicipio = /(?:Municipio|municipio)\*?\s*:\*?\s*([^*️\r\n\t]+)/i;
  const regexNodo      = /(?:Nodo|nodo)\*?\s*:\*?\s*(\d+)/i;
  const regexTotal     = /(?:Total\s*(?:de)?\s*Verificadores(?:\s*en\s*el\s*nodo)?)\*?\s*:\*?\s*(\d+)/i;

  const regexBloque1   = /9\s*(?:a\.?m\.?|p\.?m\.?)\*?\s*[:\-=\s]?\*?\s*[\(\[\{]?\s*[,.]?\s*(\d+)?[\)\]\}]?/i;
  const regexBloque2   = /2\s*(?:a\.?m\.?|p\.?m\.?)\*?\s*[:\-=\s]?\*?\s*[\(\[\{]?\s*[,.]?\s*(\d+)?[\)\]\}]?/i;
  const regexBloque3   = /6\s*(?:a\.?m\.?|p\.?m\.?)\*?\s*[:\-=\s]?\*?\s*[\(\[\{]?\s*[,.]?\s*(\d+)?[\)\]\}]?/i;

  const matchMunicipio = regexMunicipio.exec(texto);
  const matchNodo      = regexNodo.exec(texto);
  const matchTotal     = regexTotal.exec(texto);
  const matchB1        = regexBloque1.exec(texto);
  const matchB2        = regexBloque2.exec(texto);
  const matchB3        = regexBloque3.exec(texto);

  if (!matchMunicipio || !matchNodo) return null;

  return {
    municipio:          matchMunicipio[1].trim(),
    nodo:               parseInt(matchNodo[1], 10),
    totalVerificadores: matchTotal ? parseInt(matchTotal[1], 10) : 0,
    bloque1:            matchB1 ? ((matchB1[1] !== undefined) ? parseInt(matchB1[1], 10) : 0) : null,
    bloque2:            matchB2 ? ((matchB2[1] !== undefined) ? parseInt(matchB2[1], 10) : 0) : null,
    bloque3:            matchB3 ? ((matchB3[1] !== undefined) ? parseInt(matchB3[1], 10) : 0) : null,
  };
}

/**
 * Convierte un timestamp Unix de Telegram a fecha y hora
 * en la zona horaria de Venezuela.
 *
 * @param timestamp - Timestamp en segundos.
 */
export function convertirTimestamp(timestamp: number): TiempoConvertido {
  const dateObj = new Date(timestamp * 1000);
  const formatterFecha = new Intl.DateTimeFormat("en-GB", {
    timeZone: config.app.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const formatterHora = new Intl.DateTimeFormat("es-VE", {
    timeZone: config.app.timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  return {
    fecha: formatterFecha.format(dateObj),
    hora:  formatterHora.format(dateObj),
  };
}

/**
 * Obtiene la hora de Venezuela (VET) y determina el bloque activo (1, 2 o 3) para un timestamp.
 *
 * @param timestamp - Unix timestamp en segundos.
 */
export function obtenerBloqueYHoraActivo(timestamp: number): BloqueInfo {
  const dateVE = new Date(timestamp * 1000);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: config.app.timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(dateVE);
  const hourPart = parts.find((p) => p.type === "hour");
  const minutePart = parts.find((p) => p.type === "minute");

  const hourVE = hourPart ? parseInt(hourPart.value, 10) : 0;
  const minuteVE = minutePart ? parseInt(minutePart.value, 10) : 0;

  const minutosDelDia = hourVE * 60 + minuteVE;

  let bloqueActivo: number;
  if (minutosDelDia >= 360 && minutosDelDia <= 540) {
    bloqueActivo = 1;
  } else if (minutosDelDia > 540 && minutosDelDia <= 840) {
    bloqueActivo = 2;
  } else {
    bloqueActivo = 3;
  }

  const horaStr = `${String(hourVE).padStart(2, "0")}:${String(minuteVE).padStart(2, "0")}`;
  const bloqueStr = bloqueActivo === 1 ? "9am" : bloqueActivo === 2 ? "2pm" : "6pm";

  return { horaStr, bloqueActivo, bloqueStr, minutosDelDia };
}
