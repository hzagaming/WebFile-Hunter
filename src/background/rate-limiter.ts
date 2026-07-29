export class OriginRateLimiter {
  readonly #maxConcurrency: number;
  readonly #minDelayMs: number;
  #active = 0;
  #lastStartedAt = 0;
  #pausedUntil = 0;
  #paused = false;
  #cancelled = false;
  readonly #waiters: Array<() => void> = [];

  constructor(maxConcurrency: number, minDelayMs: number) {
    this.#maxConcurrency = Math.max(1, maxConcurrency);
    this.#minDelayMs = Math.max(0, minDelayMs);
  }

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.#acquire(signal);
    try {
      return await task();
    } finally {
      this.#active -= 1;
      this.#notify();
    }
  }

  pause(): void {
    this.#paused = true;
  }

  resume(): void {
    this.#paused = false;
    this.#notify();
  }

  coolDown(delayMs: number): void {
    this.#pausedUntil = Math.max(this.#pausedUntil, Date.now() + delayMs);
  }

  cancel(): void {
    this.#cancelled = true;
    this.#notify();
  }

  async #acquire(signal?: AbortSignal): Promise<void> {
    while (true) {
      if (this.#cancelled || signal?.aborted) throw new DOMException("任务已取消", "AbortError");
      const now = Date.now();
      const delay = Math.max(
        this.#pausedUntil - now,
        this.#lastStartedAt + this.#minDelayMs - now,
        0
      );
      if (!this.#paused && this.#active < this.#maxConcurrency && delay === 0) {
        this.#active += 1;
        this.#lastStartedAt = now;
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const removeWaiter = (): void => {
          const index = this.#waiters.indexOf(notify);
          if (index >= 0) this.#waiters.splice(index, 1);
        };
        const notify = (): void => {
          clearTimeout(timeout);
          removeWaiter();
          signal?.removeEventListener("abort", abort);
          resolve();
        };
        const abort = (): void => {
          clearTimeout(timeout);
          removeWaiter();
          reject(new DOMException("任务已取消", "AbortError"));
        };
        const timeout = setTimeout(notify, Math.max(delay, 50));
        this.#waiters.push(notify);
        signal?.addEventListener("abort", abort, { once: true });
      });
    }
  }

  #notify(): void {
    this.#waiters.splice(0).forEach((resolve) => resolve());
  }
}
