/**
 * src/utils/mutex.ts
 * Clase Mutex reentrante para garantizar exclusión mutua en operaciones asíncronas.
 * Permite encolar tareas secuencialmente y soporta reentrancia segura dentro del
 * mismo árbol de ejecución asíncrono sin provocar interbloqueos (deadlocks).
 */
import { AsyncLocalStorage } from "node:async_hooks";

export class Mutex {
  private queue: Promise<void>;
  private asyncLocalStorage: AsyncLocalStorage<symbol>;
  private currentLockKey: symbol | null;

  constructor() {
    this.queue = Promise.resolve();
    this.asyncLocalStorage = new AsyncLocalStorage<symbol>();
    this.currentLockKey = null;
  }

  /**
   * Ejecuta una función asíncrona dentro del bloqueo exclusivo.
   * Si el llamador ya posee el bloqueo en el contexto asíncrono actual,
   * se ejecuta inmediatamente sin encolarse de nuevo (reentrancia segura).
   */
  public async runExclusive<T>(callback: () => Promise<T> | T): Promise<T> {
    const activeKey = this.asyncLocalStorage.getStore();
    if (activeKey && activeKey === this.currentLockKey) {
      return await callback();
    }

    const lockKey = Symbol("mutex-lock");
    const next = this.queue.then(async () => {
      this.currentLockKey = lockKey;
      try {
        return await this.asyncLocalStorage.run(lockKey, () => callback());
      } finally {
        this.currentLockKey = null;
      }
    });

    this.queue = next.then(
      () => {},
      () => {}
    );

    return next;
  }

  public isLocked(): boolean {
    return this.currentLockKey !== null;
  }
}
