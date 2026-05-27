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
    // B1 es pasado (LOCKED)
    b1Final = historial.b1;

    // B2 es activo: se acumula el INCREMENTO tardío de B1 y lo declarado para B2
    const incrementoB1 = Math.max(0, bloque1 - historial.b1);

    let nuevoReporteB2 = 0;
    if (bloque2 > 0 || bloque1 > 0) {
      nuevoReporteB2 = incrementoB1 + bloque2;
    } else {
      // Si no especificó B1 ni B2, pero sí especificó el futuro B3, no alteramos B2
      const tieneReporteFuturo = (bloque3 > 0);
      if (tieneReporteFuturo) {
        nuevoReporteB2 = 0;
      } else {
        nuevoReporteB2 = valorReportado;
      }
    }
    b2Final = b1Final + nuevoReporteB2;

    // B3 es futuro (adelantado): se acepta lo reportado por adelantado
    b3Final = bloque3 || historial.b3 || 0;
  } else if (bloqueActivo === 3) {
    // B1 y B2 son pasados (LOCKED)
    b1Final = historial.b1;
    b2Final = historial.b2;

    // B3 es activo: se acumulan los incrementos tardíos de B1/B2 y lo de B3
    const incrementoB1 = Math.max(0, bloque1 - historial.b1);
    const incrementoB2 = Math.max(0, bloque2 - historial.b2);

    let nuevoReporteB3 = 0;
    if (bloque3 > 0 || bloque2 > 0 || bloque1 > 0) {
      nuevoReporteB3 = incrementoB1 + incrementoB2 + bloque3;
    } else {
      nuevoReporteB3 = valorReportado;
    }
    const baseB3 = Math.max(b1Final, b2Final);
    b3Final = baseB3 + nuevoReporteB3;
  }

  return { b1Final, b2Final, b3Final };
}
