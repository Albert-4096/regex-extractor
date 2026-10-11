import { describe, expect, it } from 'vitest';
import { resolveOverlaps, DETECTOR_ORDER } from '../src/core';
import type { Candidate } from '../src/core';
import { run } from './helpers';

const cand = (o: Partial<Candidate> & { start: number; end: number; type: string }): Candidate => ({
  text: 'x'.repeat(o.end - o.start),
  priority: 1,
  line: 1,
  ...o,
});

describe('resolveOverlaps', () => {
  it('higher priority wins over a longer, lower-priority candidate', () => {
    const out = resolveOverlaps([
      cand({ start: 0, end: 20, type: 'long', priority: 1 }),
      cand({ start: 5, end: 10, type: 'short', priority: 2 }),
    ]);
    expect(out.map((m) => m.type)).toEqual(['short']);
  });
  it('same priority: longer wins, then earlier start', () => {
    const out = resolveOverlaps([
      cand({ start: 0, end: 5, type: 'a' }),
      cand({ start: 3, end: 12, type: 'b' }),
    ]);
    expect(out.map((m) => m.type)).toEqual(['b']);
    const tie = resolveOverlaps([
      cand({ start: 4, end: 8, type: 'late' }),
      cand({ start: 0, end: 6, type: 'early' }),
    ]);
    expect(tie.map((m) => m.type)).toEqual(['early']);
  });
  it('records exact-span losers in alt, in priority order, and sorts by start', () => {
    const out = resolveOverlaps([
      cand({ start: 10, end: 18, type: 'decimal-int', priority: 1 }),
      cand({ start: 0, end: 4, type: 'x', priority: 5 }),
      cand({ start: 10, end: 18, type: 'binary', priority: 9 }),
      cand({ start: 10, end: 18, type: 'hex', priority: 4 }),
    ]);
    expect(out.map((m) => m.type)).toEqual(['x', 'binary']);
    expect(out[1].alt).toEqual(['hex', 'decimal-int']);
    expect(out[0].alt).toBeUndefined();
  });
  it('does not record partially overlapping losers as alt', () => {
    const out = resolveOverlaps([
      cand({ start: 0, end: 8, type: 'a', priority: 2 }),
      cand({ start: 0, end: 10, type: 'b', priority: 1 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].alt).toBeUndefined();
  });
  it('accepts touching (non-overlapping) candidates', () => {
    const out = resolveOverlaps([
      cand({ start: 0, end: 4, type: 'a' }),
      cand({ start: 4, end: 8, type: 'b' }),
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('detector priority order', () => {
  it('matches the specified order', () => {
    expect(DETECTOR_ORDER).toEqual([
      'flag', 'jwt', 'url', 'email', 'uuid', 'mac', 'ipv4', 'ipv6', 'binary', 'hash', 'hex',
      'base64', 'iso8601', 'decimal-float', 'decimal-int', 'quoted-string',
    ]);
  });
  it('binary beats decimal-int and records it as alt', () => {
    const r = run('x 01110101 y', ['binary', 'decimal-int']);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].type).toBe('binary');
    expect(r.matches[0].alt).toEqual(['decimal-int']);
  });
  it('binary beats hash for a 32-char bit string', () => {
    const bits = '01'.repeat(16);
    const r = run(bits, ['binary', 'hash', 'hex']);
    expect(r.matches[0].type).toBe('binary');
    expect(r.matches[0].alt).toEqual(['hash:md5']);
  });
  it('hash beats hex on a 32-char hex string and keeps hex as alt', () => {
    const md5 = 'd41d8cd98f00b204e9800998ecf8427e';
    const r = run(md5, ['hash', 'hex']);
    expect(r.matches[0].type).toBe('hash:md5');
    expect(r.matches[0].alt).toEqual(['hex']);
  });
  it('hex vs decimal: bare digits are never hex', () => {
    const r = run('12345678 deadbeef', ['hex', 'decimal-int']);
    expect(r.matches.map((m) => [m.type, m.text])).toEqual([
      ['decimal-int', '12345678'],
      ['hex', 'deadbeef'],
    ]);
  });
  it('a url swallows an email-looking or ip-looking part', () => {
    const r = run('http://10.0.0.1/a', ['url', 'ipv4']);
    expect(r.matches.map((m) => m.type)).toEqual(['url']);
  });
});
