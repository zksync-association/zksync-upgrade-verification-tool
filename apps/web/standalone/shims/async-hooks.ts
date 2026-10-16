// node:async_hooks for the single-file build. Browsers have no async context, so a store is
// visible only during the synchronous part of run(). What used it is server-side bookkeeping:
// marking engine-made requests for the pacer and noting a page load's keys (beats cover those).
export class AsyncLocalStorage<T> {
  #store: T | undefined;
  getStore(): T | undefined {
    return this.#store;
  }
  run<R>(store: T, fn: (...args: unknown[]) => R, ...args: unknown[]): R {
    const previous = this.#store;
    this.#store = store;
    try {
      return fn(...args);
    } finally {
      this.#store = previous;
    }
  }
}
