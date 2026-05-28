"use strict";

import { config } from "../config/index.js";

/**
 * Extrae los campos del reporte desde el texto del mensaje.
 *
 * Soporta formateo Markdown (negrita con asteriscos *), espacios
 * adicionales, saltos de línea variados y valores vacíos (0 por defecto).
 * Usa las horas clave (9am, 2pm, 6pm) como anclas de extracción.
 *
 * @param {string} texto - Texto del mensaje de Telegram.
 * @returns {{ municipio, nodo, totalVerificadores, bloque1, bloque2, bloque3 } | null}
 */
export function parsearReporte(texto) {
  const regexMunicipio = /(?:Municipio|municipio)\*?\s*:\*?\s*([^*️\r\n\t]+)/i;
  const regexNodo      = /(?:Nodo|nodo)\*?\s*:\*?\s*(\d+)/i;
  const regexTotal     = /(?:Total Verificadores en el nodo|Total Verificadores)\*?\s*:\*?\s*(\d+)/i;

  // Anclas por hora de corte para máxima flexibilidad de formato (soporta opcionalmente paréntesis o corchetes alrededor del número)
  const regexBloque1   = /9\s*(?:a\.?m\.?|p\.?m\.?)\*?\s*[:\-=\s]?\*?\s*[\(\[\{]?(\d+)?[\)\]\}]?/i;
  const regexBloque2   = /2\s*(?:a\.?m\.?|p\.?m\.?)\*?\s*[:\-=\s]?\*?\s*[\(\[\{]?(\d+)?[\)\]\}]?/i;
  const regexBloque3   = /6\s*(?:a\.?m\.?|p\.?m\.?)\*?\s*[:\-=\s]?\*?\s*[\(\[\{]?(\d+)?[\)\]\}]?/i;

  const matchMunicipio = regexMunicipio.exec(texto);
  const matchNodo      = regexNodo.exec(texto);
  const matchTotal     = regexTotal.exec(texto);
  const matchB1        = regexBloque1.exec(texto);
  const matchB2        = regexBloque2.exec(texto);
  const matchB3        = regexBloque3.exec(texto);

  // Municipio y Nodo son campos mínimos obligatorios
  if (!matchMunicipio || !matchNodo) return null;

  return {
    municipio:         matchMunicipio[1].trim(),
    nodo:              parseInt(matchNodo[1], 10),
    totalVerificadores: matchTotal ? parseInt(matchTotal[1], 10) : 0,
    bloque1:           (matchB1 && matchB1[1]) ? parseInt(matchB1[1], 10) : 0,
    bloque2:           (matchB2 && matchB2[1]) ? parseInt(matchB2[1], 10) : 0,
    bloque3:           (matchB3 && matchB3[1]) ? parseInt(matchB3[1], 10) : 0,
  };
}

/**
 * Convierte un timestamp Unix de Telegram a fecha y hora
 * en la zona horaria de Venezuela.
 *
 * @param {number} timestamp - Timestamp en segundos.
 * @returns {{ fecha: string, hora: string }}
 */
export function convertirTimestamp(timestamp) {
  const fecha = new Date(timestamp * 1000);
  const opts  = { timeZone: config.app.timezone, hour12: false };

  return {
    fecha: fecha.toLocaleDateString("es-VE", { ...opts, year: "numeric", month: "2-digit", day: "2-digit" }),
    hora:  fecha.toLocaleTimeString("es-VE", { ...opts, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
}

/**
 * Obtiene la hora de Venezuela (VET) y determina el bloque activo (1, 2 o 3) para un timestamp.
 *
 * @param {number} timestamp - Unix timestamp en segundos.
 * @returns {{ horaStr: string, bloqueActivo: number, bloqueStr: string, minutosDelDia: number }}
 */
export function obtenerBloqueYHoraActivo(timestamp) {
  const dateVE = new Date(timestamp * 1000);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: config.app.timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(dateVE);
  const hourVE = parseInt(parts.find((p) => p.type === "hour").value, 10);
  const minuteVE = parseInt(parts.find((p) => p.type === "minute").value, 10);

  const minutosDelDia = hourVE * 60 + minuteVE;

  // Determinar bloque activo
  let bloqueActivo;
  if (minutosDelDia >= 420 && minutosDelDia <= 540) {
    bloqueActivo = 1; // 9am
  } else if (minutosDelDia > 540 && minutosDelDia <= 840) {
    bloqueActivo = 2; // 2pm
  } else {
    bloqueActivo = 3; // 6pm
  }

  const horaStr = `${String(hourVE).padStart(2, "0")}:${String(minuteVE).padStart(2, "0")}`;
  const bloqueStr = bloqueActivo === 1 ? "9am" : bloqueActivo === 2 ? "2pm" : "6pm";

  return { horaStr, bloqueActivo, bloqueStr, minutosDelDia };
}
