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

  // Si el reporte indica explícitamente 0 verificadores en total y en todos los bloques,
  // significa que no salieron a campo hoy, por lo que sobreescribimos e inicializamos todo a cero.
  if (totalVerificadores === 0 && bloque1 === 0 && bloque2 === 0 && bloque3 === 0) {
    return { b1Final: 0, b2Final: 0, b3Final: 0 };
  }

  // Inicializar acumulaciones finales con los valores históricos
  let b1Final = historial.b1;
  let b2Final = historial.b2;
  let b3Final = historial.b3;

  // Determinar si el mensaje contiene valores explícitos para algún bloque específico
  const tieneBloquesEspecificos = (bloque1 > 0 || bloque2 > 0 || bloque3 > 0);

  if (tieneBloquesEspecificos) {
    // Si contiene valores específicos, actualizamos cada bloque aplicando "Futuro Abierto / Pasado Bloqueado"
    if (bloqueActivo === 1) {
      // 9am Activo: 9am, 2pm y 6pm están ABIERTOS (futuros). No hay bloqueados.
      b1Final = bloque1;
      b2Final = bloque2;
      b3Final = bloque3;
    } else if (bloqueActivo === 2) {
      // 2pm Activo: 9am está CERRADO (LOCKED). 2pm y 6pm están ABIERTOS.
      
      // Calcular diferencia tardía de B1: si reporta más de lo que ya hay en Sheets, redirigimos el extra
      const diffB1 = Math.max(0, bloque1 - historial.b1);

      b2Final = bloque2 + diffB1;
      b3Final = bloque3;
    } else if (bloqueActivo === 3) {
      // 6pm Activo: 9am y 2pm están CERRADOS (LOCKED). 6pm está ABIERTO.
      
      // Calcular diferencias tardías de B1 y B2
      const diffB1 = Math.max(0, bloque1 - historial.b1);
      const diffB2 = Math.max(0, bloque2 - historial.b2);

      b3Final = bloque3 + diffB1 + diffB2;
    }
  } else {
    // Si no tiene bloques específicos pero sí un valor genérico (Total Verificadores),
    // se aplica la regla de fallback clásico asignándolo únicamente al bloque activo.
    const valorGenerico = totalVerificadores || 0;
    if (bloqueActivo === 1) {
      b1Final = valorGenerico;
    } else if (bloqueActivo === 2) {
      b2Final = valorGenerico;
    } else if (bloqueActivo === 3) {
      b3Final = valorGenerico;
    }
  }

  return { b1Final, b2Final, b3Final };
}
