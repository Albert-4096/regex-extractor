/// <reference lib="webworker" />
import { handleRequest } from './handler';
import type { WorkerRequest } from './protocol';

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  self.postMessage(handleRequest(ev.data));
};
