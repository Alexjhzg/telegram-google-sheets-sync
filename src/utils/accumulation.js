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

  // Extraer el valor numérico único reportado (de los bloques o del total)
  const valorReportado = bloque1 || bloque2 || bloque3 || totalVerificadores || 0;

  // Inicializar acumulaciones finales con los valores históricos
  let b1Final = historial.b1;
  let b2Final = historial.b2;
  let b3Final = historial.b3;

  if (bloqueActivo === 1) {
    // B1 es el bloque activo: se puede escribir B1, y B2/B3 por adelantado
    // Si se reportó un bloque futuro (B2 o B3) pero no el actual (B1), no usamos el total para B1
    const tieneReporteFuturo = (bloque2 > 0 || bloque3 > 0);
    
    if (bloque1 > 0) {
      b1Final = bloque1;
    } else if (tieneReporteFuturo) {
      b1Final = historial.b1; // Mantiene el valor histórico de B1
    } else {
      b1Final = totalVerificadores || 0;
    }

    b2Final = bloque2 || historial.b2 || 0;
    b3Final = bloque3 || historial.b3 || 0;
  } else if (bloqueActivo === 2) {
    // B1 es pasado (LOCKED) pero permite correcciones tardías o mantiene historia
    b1Final = bloque1 || historial.b1 || 0;

    // B2 es el bloque activo
    if (bloque2 > 0) {
      b2Final = bloque2;
    } else {
      // Si no especificó B2, pero sí especificó B1 (tardío) o B3 (futuro), no alteramos B2
      const tieneOtrosReportes = (bloque1 > 0 || bloque3 > 0);
      if (tieneOtrosReportes) {
        b2Final = historial.b2;
      } else {
        b2Final = totalVerificadores || historial.b2 || 0;
      }
    }

    // B3 es futuro (adelantado) o mantiene historia
    b3Final = bloque3 || historial.b3 || 0;
  } else if (bloqueActivo === 3) {
    // B1 y B2 son pasados: permiten correcciones tardías o mantienen historia
    b1Final = bloque1 || historial.b1 || 0;
    b2Final = bloque2 || historial.b2 || 0;

    // B3 es el bloque activo
    if (bloque3 > 0) {
      b3Final = bloque3;
    } else {
      // Si no especificó B3, pero sí especificó B1 o B2 (tardíos), no alteramos B3
      const tieneOtrosReportes = (bloque1 > 0 || bloque2 > 0);
      if (tieneOtrosReportes) {
        b3Final = historial.b3;
      } else {
        b3Final = totalVerificadores || historial.b3 || 0;
      }
    }
  }

  return { b1Final, b2Final, b3Final };
}
