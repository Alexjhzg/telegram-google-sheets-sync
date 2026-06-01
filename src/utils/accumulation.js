"use strict";

/**
 * Calcula los valores finales acumulados de verificadores para los bloques B1, B2 y B3
 * de acuerdo con el bloque activo en curso y los valores históricos del día.
 * Implementa la lógica de "Pasado Bloqueado / Futuro Abierto" y acumulación de incrementos.
 *
 * @param {number} bloqueActivo - Bloque de tiempo activo actualmente (1, 2 o 3).
 * @param {object} reporte - Datos parseados del reporte entrante.
 * @param {object} historial - Valores acumulados previos del mismo día de Sheets.
 * @returns {{ b1Final: number, b2Final: number, b3Final: number }} Valores calculados resultantes.
 */
export function calcularAcumulacion(bloqueActivo, reporte, historial) {
  const { totalVerificadores, bloque1, bloque2, bloque3 } = reporte;

  // Extraer el valor numérico único reportado (de cualquier campo del mensaje)
  const valorReportado = bloque1 || bloque2 || bloque3 || totalVerificadores || 0;

  // Inicializar acumulaciones finales con los valores históricos (los bloques pasados y futuros se quedan congelados)
  let b1Final = historial.b1;
  let b2Final = historial.b2;
  let b3Final = historial.b3;

  if (bloqueActivo === 1) {
    // Bloque 1 activo: solo se permite escribir en B1
    b1Final = valorReportado;
  } else if (bloqueActivo === 2) {
    // Bloque 2 activo: solo se permite escribir en B2 (B1 pasado queda bloqueado)
    b2Final = valorReportado;
  } else if (bloqueActivo === 3) {
    // Bloque 3 activo: solo se permite escribir en B3 (B1 y B2 pasados quedan bloqueados)
    b3Final = valorReportado;
  }

  return { b1Final, b2Final, b3Final };
}
