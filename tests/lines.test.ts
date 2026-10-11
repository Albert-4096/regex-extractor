import { describe, expect, it } from 'vitest';
import { splitLines } from '../src/core';
import { run } from './helpers';

describe('line handling', () => {
  it('splits on CRLF, LF and CR', () => {
    expect(splitLines('a\r\nb\nc\rd').map((l) => l.text)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('offsets align with text.slice for CRLF input', () => {
    const t = '01110101\r\n10001010\r\n11110000';
    const r = run(t, ['binary']);
    expect(r.matches.map((m) => m.line)).toEqual([1, 2, 3]);
    for (const m of r.matches) expect(t.slice(m.start, m.end)).toBe(m.text);
  });
  it('offsets align for lone CR input', () => {
    const t = '01110101\r10001010';
    const r = run(t, ['binary']);
    expect(r.matches.map((m) => m.start)).toEqual([0, 9]);
    for (const m of r.matches) expect(t.slice(m.start, m.end)).toBe(m.text);
  });
  it('offsets align after emoji / surrogate pairs', () => {
    const t = '😀😀 01110101 👩‍👩‍👧 10001010\n🎉 11110000';
    const r = run(t, ['binary']);
    expect(r.matches.map((m) => m.text)).toEqual(['01110101', '10001010', '11110000']);
    for (const m of r.matches) expect(t.slice(m.start, m.end)).toBe(m.text);
    expect(r.matches[0].start).toBe(5);
  });
  it('lineCount ignores one trailing terminator', () => {
    expect(run('a\nb\n', ['binary']).lineCount).toBe(2);
    expect(run('', ['binary']).lineCount).toBe(0);
  });
  it('whole-text mode reports absolute offsets and start line', () => {
    const t = 'x\n01110101';
    const r = run(t, ['binary'], {}, { acrossText: true });
    expect(r.matches[0].line).toBe(2);
    expect(t.slice(r.matches[0].start, r.matches[0].end)).toBe('01110101');
  });
});
