import { compile, run } from '../core';
import type { Compiled } from '../core';
import type { WorkerRequest, WorkerResponse } from './protocol';

let cachedKey = '';
let cached: Compiled | null = null;

/** Pure request handler; the worker entry point only wires it to postMessage. */
export function handleRequest(req: WorkerRequest): WorkerResponse {
  try {
    const key = JSON.stringify(req.config);
    if (key !== cachedKey || !cached) {
      cached = compile(req.config);
      cachedKey = key;
    }
    return { id: req.id, ok: true, result: run(req.text, cached) };
  } catch (e) {
    return { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
