import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegexRunner, TimeoutError, StaleError, TIMEOUT_MESSAGE } from '../src/worker/client';
import type { WorkerLike } from '../src/worker/client';
import { defaultConfig } from '../src/core';
import { handleRequest } from '../src/worker/handler';

class FakeWorker implements WorkerLike {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: { message?: string }) => void) | null = null;
  terminated = false;
  posted: { id: number }[] = [];
  /** `silent` workers never answer, like a worker stuck in catastrophic backtracking. */
  constructor(private respond: ((req: { id: number }) => unknown) | null) {}
  postMessage(msg: { id: number }): void {
    this.posted.push(msg);
    if (this.respond) {
      const out = this.respond(msg);
      queueMicrotask(() => !this.terminated && this.onmessage?.({ data: out }));
    }
  }
  terminate(): void {
    this.terminated = true;
  }
}

describe('RegexRunner timeout wrapper', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('terminates a worker that never answers, reports the message, and spawns a fresh worker', async () => {
    const workers: FakeWorker[] = [];
    const runner = new RegexRunner(() => {
      const w = new FakeWorker(null);
      workers.push(w);
      return w;
    }, 2000);
    expect(workers).toHaveLength(1);
    const p = runner.run({ op: 'extract', text: 'x', config: defaultConfig() });
    const settled = p.then(() => 'resolved', (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1999);
    expect(workers[0].terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const err = await settled;
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as Error).message).toBe(TIMEOUT_MESSAGE);
    expect(TIMEOUT_MESSAGE).toBe('pattern too slow or catastrophic backtracking');
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1].terminated).toBe(false);
  });

  it('the fresh worker after a timeout answers normally', async () => {
    let n = 0;
    const runner = new RegexRunner(() => {
      n++;
      return n === 1 ? new FakeWorker(null) : new FakeWorker((req) => ({ id: req.id, ok: true, result: 'fine' }));
    }, 2000);
    const first = runner.run({ op: 'extract', text: '', config: defaultConfig() }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2001);
    expect(await first).toBeInstanceOf(TimeoutError);
    await expect(runner.run({ op: 'extract', text: '', config: defaultConfig() })).resolves.toBe('fine');
  });

  it('a newer request supersedes an older one: the older rejects as stale and its late answer is dropped', async () => {
    const workers: FakeWorker[] = [];
    const runner = new RegexRunner(() => {
      const w = new FakeWorker(null);
      workers.push(w);
      return w;
    }, 2000);
    const a = runner.run({ op: 'extract', text: 'a', config: defaultConfig() }).catch((e: unknown) => e);
    const oldId = workers[0].posted[0].id;
    const oldWorker = workers[0];
    const b = runner.run({ op: 'extract', text: 'b', config: defaultConfig() });
    expect(await a).toBeInstanceOf(StaleError);
    // the stale worker is gone; even a late answer from it must not resolve anything
    oldWorker.onmessage?.({ data: { id: oldId, ok: true, result: 'STALE' } });
    const current = workers[workers.length - 1];
    current.onmessage?.({ data: { id: current.posted[0].id, ok: true, result: 'FRESH' } });
    await expect(b).resolves.toBe('FRESH');
  });

  it('ignores a response with an unexpected id', async () => {
    const w = new FakeWorker(null);
    const runner = new RegexRunner(() => w, 2000);
    const p = runner.run({ op: 'extract', text: '', config: defaultConfig() });
    w.onmessage?.({ data: { id: 9999, ok: true, result: 'WRONG' } });
    w.onmessage?.({ data: { id: w.posted[0].id, ok: true, result: 'RIGHT' } });
    await expect(p).resolves.toBe('RIGHT');
  });

  it('worker error replies reject with the message and keep the runner usable', async () => {
    const runner = new RegexRunner(
      () => new FakeWorker((req) => ({ id: req.id, ok: false, error: 'boom' })),
      2000,
    );
    await expect(runner.run({ op: 'extract', text: '', config: defaultConfig() })).rejects.toThrow('boom');
  });
});

describe('worker request handler (the code the real worker runs)', () => {
  it('extracts and returns a result', () => {
    const out = handleRequest({ id: 7, op: 'extract', text: '01110101', config: defaultConfig() });
    expect(out.id).toBe(7);
    expect(out.ok).toBe(true);
    if (out.ok) expect((out.result as { matches: unknown[] }).matches).toHaveLength(1);
  });
  it('caches the compiled config between calls', () => {
    const cfg = defaultConfig();
    const a = handleRequest({ id: 1, op: 'extract', text: '01110101', config: cfg });
    const b = handleRequest({ id: 2, op: 'extract', text: '10001010', config: cfg });
    expect(a.ok && b.ok).toBe(true);
  });
});

describe('worker request handler: infer op', () => {
  it('runs inference inside the worker handler', () => {
    const text = 'a 01110101 b 10001010';
    const out = handleRequest({
      id: 3,
      op: 'infer',
      text,
      positives: [{ start: 2, end: 10 }],
      negatives: [],
      acrossText: false,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      const r = out.result as { defaultIndex: number; candidates: { pattern: string; count: number }[] };
      expect(r.candidates[r.defaultIndex].pattern).toBe('[01]{8}');
      expect(r.candidates[r.defaultIndex].count).toBe(2);
    }
  });
});
