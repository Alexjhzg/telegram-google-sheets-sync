"use strict";

/**
 * Clase Mutex para garantizar exclusión mutua en operaciones asíncronas.
 * Permite encolar tareas y ejecutarlas secuencialmente.
 */
export class Mutex {
  constructor() {
    this.queue = Promise.resolve();
  }

  /**
   * Ejecuta una función asíncrona dentro del bloqueo exclusivo.
   * Garantiza que la cola no se rompa incluso si la función falla.
   *
   * @template T
   * @param {() => Promise<T>|T} callback - Función asíncrona a ejecutar.
   * @returns {Promise<T>} Promesa que se resuelve con el resultado de la función.
   */
  runExclusive(callback) {
    const next = this.queue.then(() => callback());
    // Encadenamos el siguiente ticket en la cola. 
    // Usamos then(resolve, reject) para atrapar cualquier error y evitar que la cola se rompa.
    this.queue = next.then(
      () => {},
      () => {}
    );
    return next;
  }
}
