import { describe, expect, it } from 'vitest';
import { compile, defaultConfig, run } from '../src/core';

function makeLog(bytes: number): string {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const hex = (n: number) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');
  const bits = (n: number) => Array.from({ length: n }, () => (rnd() < 0.5 ? '0' : '1')).join('');
  const lines: string[] = [];
  let size = 0;
  let i = 0;
  while (size <= bytes) {
    const kind = i++ % 5;
    const line =
      kind === 0
        ? `2024-05-12T10:31:${String(i % 60).padStart(2, '0')}Z host-${i % 97} sshd[${1000 + (i % 9000)}]: Accepted publickey for user from 192.168.${i % 255}.${(i * 7) % 255} port ${20000 + (i % 40000)}`
        : kind === 1
          ? `Circuit[${i % 10}] : ${bits(8)} -> [OPERATION] -> ${bits(8)} checksum=${hex(32)}`
          : kind === 2
            ? `request id=${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)} token=SGVsbG8gd29ybGQgMTIzNDU2Nzg5 status=200 bytes=${i * 13}`
            : kind === 3
              ? `GET /api/v1/items/${i}?q=${hex(6)} HTTP/1.1 200 ${Math.floor(rnd() * 5000)}ms ua="Mozilla/5.0 (X11; Linux x86_64)"`
              : `debug: value=0x${hex(8)} sha1=${hex(40)} flag{${hex(12)}} noise ${bits(5)} lorem ipsum dolor sit amet consectetur`;
    lines.push(line);
    size += line.length + 1;
  }
  return lines.join('\n');
}

describe('performance smoke test', () => {
  it('1 MB of log text with default detectors finishes in under ~1 s', () => {
    const text = makeLog(1024 * 1024);
    expect(text.length).toBeGreaterThanOrEqual(1024 * 1024);
    const compiled = compile(defaultConfig()); // precompiled once, as the worker does
    const t0 = performance.now();
    const res = run(text, compiled);
    const ms = performance.now() - t0;
    console.log(`[perf] ${(text.length / 1024).toFixed(0)} KiB, ${res.matches.length} matches, ${ms.toFixed(0)} ms (run) `);
    expect(res.truncated).toBe(false);
    expect(res.matches.length).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(1000);
  });
});
