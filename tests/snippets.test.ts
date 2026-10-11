import { describe, expect, it } from 'vitest';
import { snippets } from '../src/core';

const by = (pattern: string, flags = '') => Object.fromEntries(snippets(pattern, flags).map((s) => [s.id, s]));

describe('copy-as snippets', () => {
  it('produces javascript, python, grep and rg snippets', () => {
    const s = by('[01]{8}');
    expect(Object.keys(s).sort()).toEqual(['grep', 'js', 'python', 'rg']);
    expect(s.js.code).toContain('new RegExp("[01]{8}", "g")');
    expect(s.python.code).toContain('re.findall(r"[01]{8}"');
    expect(s.python.code).toContain('re.finditer');
    expect(s.grep.code).toContain("grep -oP '[01]{8}'");
    expect(s.rg.code).toContain("rg -o -P '[01]{8}'");
    for (const x of Object.values(s)) expect(x.warnings).toEqual([]);
  });
  it('converts JS named groups to Python (?P<name>…) and warns', () => {
    const s = by('(?<a>[01]{8}) -> (?<b>\\d+)');
    expect(s.python.code).toContain('(?P<a>[01]{8}) -> (?P<b>\\d+)');
    expect(s.python.warnings.join(' ')).toMatch(/named group/i);
    expect(s.grep.code).toContain('(?<a>[01]{8})');
    expect(s.grep.warnings).toEqual([]);
  });
  it('converts \\k<name> back-references for Python', () => {
    expect(by('(?<q>[\'"]).*?\\k<q>').python.code).toContain('(?P=q)');
  });
  it('maps flags: i, m, s and keeps ASCII semantics for Python', () => {
    const s = by('abc', 'ims');
    expect(s.js.code).toContain('"gims"');
    expect(s.python.code).toContain('re.I');
    expect(s.python.code).toContain('re.M');
    expect(s.python.code).toContain('re.S');
    expect(s.python.code).toContain('re.A');
    expect(s.grep.code).toContain('(?ims)abc');
    expect(s.grep.warnings.join(' ')).toMatch(/line/i);
  });
  it('quotes single quotes for the shell', () => {
    expect(by("it's").grep.code).toContain("grep -oP 'it'\\''s'");
  });
  it('warns about constructs that are not equivalent', () => {
    const s = by('\\p{L}+$');
    expect(s.python.warnings.join(' ')).toMatch(/\\p/);
    expect(s.python.warnings.join(' ')).toMatch(/\$/);
    const t = by('(?<=a+)b');
    expect(t.python.warnings.join(' ')).toMatch(/lookbehind/i);
    expect(t.grep.warnings.join(' ')).toMatch(/lookbehind/i);
    const u = by('\\u00e9');
    expect(u.grep.warnings.join(' ')).toMatch(/\\u/);
  });
});
