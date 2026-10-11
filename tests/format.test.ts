import { describe, expect, it } from 'vitest';
import { defaultFormatOptions, formatOutput, unescapeSeparator, computeStats, tableRows } from '../src/core';
import type { FormatOptions, Match } from '../src/core';

let off = 0;
const m = (line: number, text: string, type = 'binary', extra: Partial<Match> = {}): Match => {
  const start = off;
  off += text.length + 1;
  return { line, start, end: start + text.length, text, type, ...extra };
};
const fmt = (matches: Match[], lineCount: number, o: Partial<FormatOptions> = {}) =>
  formatOutput(matches, lineCount, { ...defaultFormatOptions(), ...o });

describe('formatters', () => {
  const ms = [m(1, 'a'), m(1, 'b'), m(3, 'c'), m(3, 'a')];

  it('per-line: separator and empty-line handling', () => {
    expect(fmt(ms, 4)).toBe('a, b\nc, a');
    expect(fmt(ms, 4, { keepEmptyLines: true })).toBe('a, b\n\nc, a\n');
    expect(fmt(ms, 3, { separator: '|' })).toBe('a|b\nc|a');
  });
  it('separator escapes \\t \\n \\\\', () => {
    expect(unescapeSeparator('\\t')).toBe('\t');
    expect(unescapeSeparator('a\\nb')).toBe('a\nb');
    expect(unescapeSeparator('\\\\')).toBe('\\');
    expect(unescapeSeparator('\\x')).toBe('\\x');
    expect(fmt(ms, 3, { separator: '\\t' })).toBe('a\tb\nc\ta');
  });
  it('flat: one value per line', () => {
    expect(fmt(ms, 3, { format: 'flat' })).toBe('a\nb\nc\na');
  });
  it('unique: global vs per line, keeps first occurrence', () => {
    expect(fmt(ms, 3, { unique: true, uniqueScope: 'global' })).toBe('a, b\nc');
    expect(fmt(ms, 3, { unique: true, uniqueScope: 'line' })).toBe('a, b\nc, a');
    const dup = [m(1, 'x'), m(1, 'x'), m(2, 'x')];
    expect(fmt(dup, 2, { unique: true, uniqueScope: 'line' })).toBe('x\nx');
    expect(fmt(dup, 2, { unique: true, uniqueScope: 'global', format: 'flat' })).toBe('x');
  });
  it('filter by type, including the family prefix of hash:*', () => {
    const mixed = [m(1, 'abc', 'hex'), m(1, 'def', 'hash:md5'), m(1, '10101010', 'binary')];
    expect(fmt(mixed, 1, { types: ['hash'] })).toBe('def');
    expect(fmt(mixed, 1, { types: ['hash:md5', 'hex'] })).toBe('abc, def');
    expect(fmt(mixed, 1, { types: null })).toBe('abc, def, 10101010');
  });
  it('quote style, prefix and suffix', () => {
    expect(fmt(ms, 3, { quote: 'single' })).toBe("'a', 'b'\n'c', 'a'");
    expect(fmt(ms, 3, { quote: 'double', format: 'flat' })).toBe('"a"\n"b"\n"c"\n"a"');
    expect(fmt([m(1, "it's")], 1, { quote: 'single' })).toBe("'it\\'s'");
    expect(fmt(ms, 3, { prefix: '<', suffix: '>', format: 'flat' })).toBe('<a>\n<b>\n<c>\n<a>');
  });
  it('JSON has the documented shape', () => {
    const j = [m(1, 'A', 'hex', { alt: ['decimal-int'], meta: { decoded: 'x' } }), m(2, 'B', 'custom', { groups: { g: 'B' } })];
    const out = JSON.parse(fmt(j, 2, { format: 'json' }));
    expect(out).toEqual([
      { line: 1, matches: [{ type: 'hex', text: 'A', start: j[0].start, end: j[0].end, alt: ['decimal-int'], meta: { decoded: 'x' } }] },
      { line: 2, matches: [{ type: 'custom', text: 'B', start: j[1].start, end: j[1].end, groups: { g: 'B' } }] },
    ]);
  });
  it('JSON keepEmptyLines adds empty entries; JSONL is one object per line', () => {
    const j = [m(2, 'B')];
    expect(JSON.parse(fmt(j, 3, { format: 'json', keepEmptyLines: true })).map((x: { line: number }) => x.line)).toEqual([1, 2, 3]);
    const lines = fmt([m(1, 'A'), m(2, 'B')], 2, { format: 'jsonl' }).split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).line).toBe(1);
    expect(JSON.parse(lines[1]).matches[0].text).toBe('B');
  });
  it('CSV: RFC 4180 quoting, header v1..vn, padded rows', () => {
    const rows = [m(1, 'a,b'), m(1, 'say "hi"'), m(2, 'line\nbreak'), m(2, 'plain'), m(2, 'x')];
    const csv = fmt(rows, 2, { format: 'csv' });
    expect(csv).toBe('v1,v2,v3\n"a,b","say ""hi""",\n"line\nbreak",plain,x');
  });
  it('table rows carry type | value | line | offsets | alt/decoded', () => {
    const t = [m(1, 'SGVsbG8=', 'base64', { alt: ['decimal-int'], meta: { decoded: 'Hello' } })];
    const rows = tableRows(t);
    expect(rows[0].slice(0, 4)).toEqual(['base64', 'SGVsbG8=', '1', `${t[0].start}-${t[0].end}`]);
    expect(rows[0][4]).toContain('decimal-int');
    expect(rows[0][4]).toContain('Hello');
  });
  it('stats count totals and per-type', () => {
    const s = computeStats([m(1, 'a', 'hex'), m(1, 'b', 'hex'), m(2, 'c', 'binary')]);
    expect(s.total).toBe(3);
    expect(s.byType).toEqual({ hex: 2, binary: 1 });
  });
});
