import type { RequestBody, WorkerResponse } from './protocol';

export const TIMEOUT_MESSAGE = 'pattern too slow or catastrophic backtracking';
export const DEFAULT_TIMEOUT_MS = 2000;

export class TimeoutError extends Error {
  constructor() {
    super(TIMEOUT_MESSAGE);
    this.name = 'TimeoutError';
  }
}

/** Rejected when a newer request replaced this one. Callers ignore it. */
export class StaleError extends Error {
  constructor() {
    super('superseded by a newer request');
    this.name = 'StaleError';
  }
}

/** The subset of Worker the runner needs, so tests can inject a fake. */
export interface WorkerLike {
  postMessage(msg: never): void;
  terminate(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: { message?: string }) => void) | null;
}

interface Pending {
  id: number;
  resolve: (v: never) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Runs requests in a worker with a hard timeout. On timeout, supersede, or worker
 * error the worker is terminated and a fresh one is spawned, so a runaway regex can
 * never block the page or a later request.
 */
export class RegexRunner {
  private worker: WorkerLike;
  private pending: Pending | null = null;
  private nextId = 0;
  private disposed = false;

  constructor(
    private readonly factory: () => WorkerLike,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {
    this.worker = this.spawn();
  }

  private spawn(): WorkerLike {
    const w = this.factory();
    w.onmessage = (ev) => this.onMessage(ev.data as WorkerResponse);
    w.onerror = (ev) => this.onError(ev.message ?? 'worker error');
    return w;
  }

  private restart(): void {
    const old = this.worker;
    old.onmessage = null;
    old.onerror = null;
    old.terminate();
    if (!this.disposed) this.worker = this.spawn();
  }

  private settle(): Pending | null {
    const p = this.pending;
    if (p) clearTimeout(p.timer);
    this.pending = null;
    return p;
  }

  private onMessage(msg: WorkerResponse): void {
    const p = this.pending;
    if (!p || !msg || msg.id !== p.id) return; // stale or unknown: drop
    this.settle();
    if (msg.ok) p.resolve(msg.result as never);
    else p.reject(new Error(msg.error));
  }

  private onError(message: string): void {
    const p = this.settle();
    this.restart();
    p?.reject(new Error(message));
  }

  run<T = unknown>(body: RequestBody): Promise<T> {
    if (this.pending) {
      // Do not queue behind a request that may be stuck: drop it and start clean.
      const old = this.settle();
      this.restart();
      old?.reject(new StaleError());
    }
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.id !== id) return;
        this.settle();
        this.restart();
        reject(new TimeoutError());
      }, this.timeoutMs);
      this.pending = { id, resolve: resolve as (v: never) => void, reject, timer };
      this.worker.postMessage({ ...body, id } as never);
    });
  }

  dispose(): void {
    this.disposed = true;
    const p = this.settle();
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    p?.reject(new StaleError());
  }
}

export function createRunner(timeoutMs = DEFAULT_TIMEOUT_MS): RegexRunner {
  return new RegexRunner(
    () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
    timeoutMs,
  );
}
