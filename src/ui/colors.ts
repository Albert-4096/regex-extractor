import { DETECTOR_ORDER } from '../core';

/** CSS classes (palette slot + underline style) for a match type. Stable per type. */
export function typeClass(type: string): string {
  const base = type.split(':')[0];
  let i = (DETECTOR_ORDER as readonly string[]).indexOf(base);
  if (i < 0) {
    let hash = 0;
    for (let k = 0; k < type.length; k++) hash = (hash * 31 + type.charCodeAt(k)) | 0;
    i = 16 + (Math.abs(hash) % 8);
  }
  return `t${i % 8}` + (Math.floor(i / 8) % 2 === 1 ? ' s1' : '');
}
