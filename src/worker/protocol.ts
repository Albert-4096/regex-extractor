import type { ExtractConfig, Span } from '../core';

export type WorkerRequest =
  | { id: number; op: 'extract'; text: string; config: ExtractConfig }
  | { id: number; op: 'infer'; text: string; positives: Span[]; negatives: Span[]; acrossText: boolean };

export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** A request without its id (the runner assigns ids). Distributes over the union. */
export type RequestBody = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;
