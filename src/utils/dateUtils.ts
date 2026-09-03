const TIMEZONE = process.env.TZ || "America/Caracas";

/**
 * Estandariza cualquier valor de fecha (string o número) al formato uniforme DD/MM/YYYY.
 *
 * Ejemplos de entradas soportadas:
 * - "2/9/2026" ➔ "02/09/2026"
 * - "2026-09-02" ➔ "02/09/2026"
 * - "02-09-2026" ➔ "02/09/2026"
 * - "2026/09/02" ➔ "02/09/2026"
 * - "2026-09-02T12:00:00.000Z" ➔ "02/09/2026"
 * - 46237 (número de serie de Excel) ➔ "02/09/2026" (o la fecha equivalente)
 *
 * @param fechaInput - Valor de entrada que contiene una fecha.
 * @returns Fecha en formato "DD/MM/YYYY" o null si no se pudo determinar una fecha válida.
 */
export function estandarizarFecha(fechaInput: string | number | null | undefined): string | null {
  if (fechaInput === null || fechaInput === undefined) return null;

  const raw = String(fechaInput).trim();
  if (!raw) return null;

  // 1. Manejo de número de serie de Excel/Google Sheets (ej. 46237)
  if (/^\d{4,5}(\.\d+)?$/.test(raw)) {
    const num = parseFloat(raw);
    if (!isNaN(num) && num > 1000 && num < 100000) {
      // Offset de época Excel (30-dic-1899)
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const date = new Date(excelEpoch.getTime() + num * 86400000);
      const dia = String(date.getUTCDate()).padStart(2, "0");
      const mes = String(date.getUTCMonth() + 1).padStart(2, "0");
      const anio = date.getUTCFullYear();
      return `${dia}/${mes}/${anio}`;
    }
  }

  // Si incluye hora / timestamp (ej: "2026-09-02T15:30:00" o "02/09/2026 12:00:00"), tomar solo la parte de fecha
  const parteFecha = raw.split(/[T\s]/)[0];

  // 2. Formato YYYY-MM-DD o YYYY/MM/DD (Año primero)
  const regexAnioPrimero = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
  const matchAnioPrimero = regexAnioPrimero.exec(parteFecha);
  if (matchAnioPrimero) {
    const anio = parseInt(matchAnioPrimero[1], 10);
    const mes = parseInt(matchAnioPrimero[2], 10);
    const dia = parseInt(matchAnioPrimero[3], 10);
    if (validarFechaValida(dia, mes, anio)) {
      return `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${anio}`;
    }
  }

  // 3. Formato DD/MM/YYYY o DD-MM-YYYY o D/M/YYYY (Día primero)
  const regexDiaPrimero = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/;
  const matchDiaPrimero = regexDiaPrimero.exec(parteFecha);
  if (matchDiaPrimero) {
    const dia = parseInt(matchDiaPrimero[1], 10);
    const mes = parseInt(matchDiaPrimero[2], 10);
    const anio = parseInt(matchDiaPrimero[3], 10);
    if (validarFechaValida(dia, mes, anio)) {
      return `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${anio}`;
    }
  }

  // 4. Intentar parsing con Date() como último recurso (ej. cadenas RFC/ISO)
  const parsedDate = new Date(raw);
  if (!isNaN(parsedDate.getTime())) {
    const opts: Intl.DateTimeFormatOptions = {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    };
    const formatted = parsedDate.toLocaleDateString("es-VE", opts);
    // Verificar si toLocaleDateString retornó DD/MM/YYYY
    const matchVE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(formatted);
    if (matchVE) {
      const d = String(matchVE[1]).padStart(2, "0");
      const m = String(matchVE[2]).padStart(2, "0");
      const y = matchVE[3];
      return `${d}/${m}/${y}`;
    }
    return formatted;
  }

  return null;
}

/**
 * Valida si un día, mes y año componen una fecha real en el calendario.
 */
function validarFechaValida(dia: number, mes: number, anio: number): boolean {
  if (mes < 1 || mes > 12) return false;
  if (dia < 1 || dia > 31) return false;
  if (anio < 1900 || anio > 2100) return false;

  const d = new Date(anio, mes - 1, dia);
  return d.getFullYear() === anio && d.getMonth() === mes - 1 && d.getDate() === dia;
}

/**
 * Obtiene la fecha actual en la zona horaria de la aplicación en formato DD/MM/YYYY.
 */
export function obtenerFechaHoyEstandar(): string {
  const date = new Date();
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

