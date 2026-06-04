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

  // Inicializar acumulaciones finales con los valores históricos
  let b1Final = historial.b1;
  let b2Final = historial.b2;
  let b3Final = historial.b3;

  // Lógica unificada de "Pasado Bloqueado / Presente y Futuro Abiertos":
  if (bloqueActivo === 1) {
    // 9am Activo: no hay pasado. B1 (presente), B2 y B3 (futuros) se actualizan.
    b1Final = bloque1 || totalVerificadores || 0;
    b2Final = bloque2 || 0;
    b3Final = bloque3 || 0;
  } else if (bloqueActivo === 2) {
    // 2pm Activo: B1 (pasado) es LOCKED. B2 (presente) y B3 (futuro) se actualizan.
    const diffB1 = Math.max(0, (bloque1 || 0) - historial.b1);
    
    // Si el reporte trae bloques específicos, usamos bloque2. Si no, usamos el totalVerificadores.
    const valorB2Reportado = (bloque1 > 0 || bloque2 > 0 || bloque3 > 0) ? bloque2 : totalVerificadores;
    
    b2Final = (valorB2Reportado || 0) + diffB1;
    b3Final = bloque3 || 0;
  } else if (bloqueActivo === 3) {
    // 6pm Activo: B1 y B2 (pasados) son LOCKED. B3 (presente) se actualiza.
    const diffB1 = Math.max(0, (bloque1 || 0) - historial.b1);
    const diffB2 = Math.max(0, (bloque2 || 0) - historial.b2);
    
    const valorB3Reportado = (bloque1 > 0 || bloque2 > 0 || bloque3 > 0) ? bloque3 : totalVerificadores;
    
    b3Final = (valorB3Reportado || 0) + diffB1 + diffB2;
  }

  return { b1Final, b2Final, b3Final };
}
