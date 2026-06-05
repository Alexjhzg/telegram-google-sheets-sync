"use strict";

/**
 * Calcula los valores finales acumulados de verificadores para los bloques B1, B2 y B3
 * de acuerdo con el bloque activo en curso y los valores históricos del día.
 * Implementa la lógica de "Pasado Bloqueado / Presente y Futuro Abiertos" y acumulación de incrementos.
 *
 * @param {number} bloqueActivo - Bloque de tiempo activo actualmente (1, 2 o 3).
 * @param {object} reporte - Datos parseados del reporte entrante.
 * @param {object} historial - Valores acumulados previos del mismo día de Sheets.
 * @returns {{ b1Final: number, b2Final: number, b3Final: number }} Valores calculados resultantes.
 */
export function calcularAcumulacion(bloqueActivo, reporte, historial) {
  const { totalVerificadores, bloque1, bloque2, bloque3 } = reporte;

  // Normalizar los valores de los bloques a enteros (0 por defecto) si fueron provistos
  const b1Msg = bloque1 !== null ? bloque1 : 0;
  const b2Msg = bloque2 !== null ? bloque2 : 0;
  const b3Msg = bloque3 !== null ? bloque3 : 0;

  // Identificar si el supervisor proveyó la estructura explícita de bloques en el mensaje
  const tieneEstructuraBloques = (bloque1 !== null || bloque2 !== null || bloque3 !== null);

  // Inicializar acumulaciones finales con los valores históricos
  let b1Final = historial.b1;
  let b2Final = historial.b2;
  let b3Final = historial.b3;

  // Lógica unificada de "Pasado Bloqueado / Presente y Futuro Abiertos":
  if (bloqueActivo === 1) {
    // 9am Activo: no hay pasado. B1 (presente), B2 y B3 (futuros) se actualizan.
    if (tieneEstructuraBloques) {
      b1Final = b1Msg;
      b2Final = b2Msg;
      b3Final = b3Msg;
    } else {
      b1Final = totalVerificadores || 0;
      b2Final = 0;
      b3Final = 0;
    }
  } else if (bloqueActivo === 2) {
    // 2pm Activo: B1 (pasado) es LOCKED. B2 (presente) y B3 (futuro) se actualizan.
    if (tieneEstructuraBloques) {
      const diffB1 = Math.max(0, b1Msg - historial.b1);
      b2Final = b2Msg + diffB1;
      b3Final = b3Msg;
    } else {
      b2Final = totalVerificadores || 0;
      b3Final = 0;
    }
  } else if (bloqueActivo === 3) {
    // 6pm Activo: B1 y B2 (pasados) son LOCKED. B3 (presente) se actualiza.
    if (tieneEstructuraBloques) {
      const diffB1 = Math.max(0, b1Msg - historial.b1);
      const diffB2 = Math.max(0, b2Msg - historial.b2);
      b3Final = b3Msg + diffB1 + diffB2;
    } else {
      b3Final = totalVerificadores || 0;
    }
  }

  return { b1Final, b2Final, b3Final };
}
