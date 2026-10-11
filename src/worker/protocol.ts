import type { ExtractConfig } from '../core';

export type WorkerRequest = { id: number; op: 'extract'; text: string; config: ExtractConfig };

export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** A request without its id (the runner assigns ids). */
export type RequestBody = Omit<WorkerRequest, 'id'>;
