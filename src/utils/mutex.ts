/**
 * Clase Mutex para garantizar exclusión mutua en operaciones asíncronas.
 * Permite encolar tareas y ejecutarlas secuencialmente.
 */
export class Mutex {
  private queue: Promise<void>;

  constructor() {
    this.queue = Promise.resolve();
  }

  /**
   * Ejecuta una función asíncrona dentro del bloqueo exclusivo.
   * Garantiza que la cola no se rompa incluso si la función falla.
   */
  public runExclusive<T>(callback: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(() => callback());
    this.queue = next.then(
      () => {},
      () => {}
    );
    return next;
  }
}
