import { describe, expect, it } from 'vitest';
import { defaultConfig, extract, formatOutput, defaultFormatOptions } from '../src/core';
import { only } from './helpers';

const INPUT = [
  'Circuit[0] : 01110101 -> [OPERATION] -> 10001010',
  "Circuit[0] : ('01101110', '10110100') -> [OPERATION] -> 11111110",
].join('\n');

describe('acceptance test #1 (reference behavior)', () => {
  it('Binary only, min length 8, per line, ", " separator is exact', () => {
    const res = extract(INPUT, only(['binary'], { binary: { minLength: 8 } }));
    const out = formatOutput(res.matches, res.lineCount, {
      ...defaultFormatOptions(),
      format: 'perline',
      separator: ', ',
    });
    expect(out).toBe('01110101, 10001010\n01101110, 10110100, 11111110');
  });

  it('keeps leading zeros as strings and preserves line numbers', () => {
    const res = extract(INPUT, only(['binary']));
    expect(res.matches.map((m) => [m.line, m.text])).toEqual([
      [1, '01110101'],
      [1, '10001010'],
      [2, '01101110'],
      [2, '10110100'],
      [2, '11111110'],
    ]);
    for (const m of res.matches) expect(INPUT.slice(m.start, m.end)).toBe(m.text);
  });

  it('the preloaded sample gives the same output with every default detector enabled', () => {
    const res = extract(INPUT, defaultConfig());
    const out = formatOutput(res.matches, res.lineCount, defaultFormatOptions());
    expect(out).toBe('01110101, 10001010\n01101110, 10110100, 11111110');
    expect(new Set(res.matches.map((m) => m.type))).toEqual(new Set(['binary']));
  });
});
