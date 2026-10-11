import { describe, expect, it } from 'vitest';
import { compileCustom, extract } from '../src/core';
import { custom } from './helpers';

describe('custom regexes', () => {
  it('named capture mode yields groups a and b', () => {
    const t = 'Circuit[0] : 01110101 -> [OPERATION] -> 10001010';
    const r = extract(t, custom([{ label: 'io', pattern: '(?<a>[01]{8}) -> .* -> (?<b>[01]{8})', captureMode: 'named' }]));
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].type).toBe('io');
    expect(r.matches[0].groups).toEqual({ a: '01110101', b: '10001010' });
    expect(r.matches[0].text).toBe('01110101 -> [OPERATION] -> 10001010');
  });
  it('group1 mode extracts the first group with exact offsets', () => {
    const t = 'key=value; key=other';
    const r = extract(t, custom([{ pattern: 'key=(\\w+)', captureMode: 'group1' }]));
    expect(r.matches.map((m) => m.text)).toEqual(['value', 'other']);
    for (const m of r.matches) expect(t.slice(m.start, m.end)).toBe(m.text);
  });
  it('full mode extracts the whole match', () => {
    const r = extract('a1 b22', custom([{ pattern: '[a-z]\\d+' }]));
    expect(r.matches.map((m) => m.text)).toEqual(['a1', 'b22']);
  });
  it('invalid regex returns an error object, never throws, and does not block others', () => {
    const res = compileCustom({ id: 'x', label: 'bad', pattern: '(unclosed', flags: '', captureMode: 'full' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/\S/);
    const r = extract('abc 123', custom([{ pattern: '(unclosed' }, { label: 'digits', pattern: '\\d+' }]));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].index).toBe(0);
    expect(r.matches.map((m) => m.text)).toEqual(['123']);
  });
  it('skips zero-length matches', () => {
    const r = extract('aaa bbb', custom([{ pattern: 'x*' }]));
    expect(r.matches).toEqual([]);
    const r2 = extract('aaa', custom([{ pattern: 'a*?' }]));
    expect(r2.matches).toEqual([]);
  });
  it('flags i/m/s/u are honoured; unknown flags are ignored', () => {
    expect(extract('ABC', custom([{ pattern: 'abc', flags: 'i' }])).matches).toHaveLength(1);
    expect(extract('ABC', custom([{ pattern: 'abc', flags: '' }])).matches).toHaveLength(0);
    expect(extract('ABC', custom([{ pattern: 'abc', flags: 'iyg' }])).matches).toHaveLength(1);
    expect(extract('😀', custom([{ pattern: '^.$', flags: 'u' }])).matches).toHaveLength(1);
  });
  it('^ and $ are per line by default and whole-text with acrossText', () => {
    const t = 'ab\ncd';
    expect(extract(t, custom([{ pattern: '^\\w\\w$' }])).matches.map((m) => m.text)).toEqual(['ab', 'cd']);
    expect(extract(t, custom([{ pattern: '^[\\s\\S]*$' }], { acrossText: true })).matches.map((m) => m.text)).toEqual(['ab\ncd']);
  });
  it('custom matches win over built-ins by default and record them as alt', () => {
    const r = extract('01110101', {
      ...custom([{ label: 'mybits', pattern: '[01]{8}' }]),
      detectors: [{ id: 'binary', enabled: true, params: {} }],
    });
    expect(r.matches[0].type).toBe('mybits');
    expect(r.matches[0].alt).toEqual(['binary']);
  });
  it('earlier custom entries outrank later ones', () => {
    const r = extract('abcdef', custom([{ label: 'first', pattern: 'abc' }, { label: 'second', pattern: 'abc' }]));
    expect(r.matches[0].type).toBe('first');
    expect(r.matches[0].alt).toEqual(['second']);
  });
  it('a group named __proto__ does not pollute', () => {
    const r = extract('abc', custom([{ pattern: '(?<__proto__>a)bc', captureMode: 'named' }]));
    expect(({} as Record<string, unknown>).a).toBeUndefined();
    expect(JSON.parse(JSON.stringify(r.matches[0].groups))).toEqual({ ['__proto__']: 'a' });
  });
});
