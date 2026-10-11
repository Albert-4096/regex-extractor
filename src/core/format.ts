import type { Match } from './types';

export type OutputFormat = 'perline' | 'flat' | 'json' | 'jsonl' | 'csv' | 'table';

export interface FormatOptions {
  format: OutputFormat;
  /** Raw separator text; supports \t \n \r \\ escapes. */
  separator: string;
  keepEmptyLines: boolean;
  unique: boolean;
  uniqueScope: 'line' | 'global';
  /** Keep only these types (a family like `hash` also keeps `hash:md5`); null = all. */
  types: string[] | null;
  quote: 'none' | 'single' | 'double';
  prefix: string;
  suffix: string;
}

export function defaultFormatOptions(): FormatOptions {
  return {
    format: 'perline',
    separator: ', ',
    keepEmptyLines: false,
    unique: false,
    uniqueScope: 'global',
    types: null,
    quote: 'none',
    prefix: '',
    suffix: '',
  };
}

export function unescapeSeparator(s: string): string {
  return s.replace(/\\([tnr\\])/g, (_, c: string) => (c === 't' ? '\t' : c === 'n' ? '\n' : c === 'r' ? '\r' : '\\'));
}

export function applyFilters(matches: Match[], o: FormatOptions): Match[] {
  let out = matches;
  if (o.types) {
    const wanted = o.types;
    out = out.filter((m) => wanted.includes(m.type) || wanted.includes(m.type.split(':')[0]));
  }
  if (o.unique) {
    const seen = new Set<string>();
    let curLine = -1;
    out = out.filter((m) => {
      if (o.uniqueScope === 'line' && m.line !== curLine) {
        curLine = m.line;
        seen.clear();
      }
      if (seen.has(m.text)) return false;
      seen.add(m.text);
      return true;
    });
  }
  return out;
}

function groupByLine(matches: Match[]): Map<number, Match[]> {
  const g = new Map<number, Match[]>();
  for (const m of matches) {
    const a = g.get(m.line);
    if (a) a.push(m);
    else g.set(m.line, [m]);
  }
  return g;
}

function decorate(text: string, o: FormatOptions): string {
  let v = text;
  if (o.quote !== 'none') {
    const q = o.quote === 'single' ? "'" : '"';
    v = q + v.replace(/\\/g, '\\\\').split(q).join('\\' + q) + q;
  }
  return o.prefix + v + o.suffix;
}

function csvField(s: string): string {
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function jsonMatch(m: Match) {
  return { type: m.type, text: m.text, start: m.start, end: m.end, groups: m.groups, alt: m.alt, meta: m.meta };
}

/** Lines to emit, in order: all lines when keepEmptyLines, else only lines with matches. */
function lineNumbers(groups: Map<number, Match[]>, lineCount: number, keep: boolean): number[] {
  if (!keep) return [...groups.keys()].sort((a, b) => a - b);
  let maxLine = lineCount;
  for (const k of groups.keys()) if (k > maxLine) maxLine = k;
  return Array.from({ length: maxLine }, (_, i) => i + 1);
}

export function tableRows(matches: Match[]): string[][] {
  return matches.map((m) => {
    const extra: string[] = [];
    if (m.alt?.length) extra.push(`alt: ${m.alt.join(', ')}`);
    if (m.meta) for (const k of Object.keys(m.meta)) extra.push(`${k}: ${m.meta[k]}`);
    if (m.groups) for (const k of Object.keys(m.groups)) extra.push(`${k}=${m.groups[k]}`);
    return [m.type, m.text, String(m.line), `${m.start}-${m.end}`, extra.join('; ')];
  });
}

export const TABLE_HEADER = ['type', 'value', 'line', 'offsets', 'alt / decoded'];

export function formatOutput(matches: Match[], lineCount: number, options: FormatOptions): string {
  const o = options;
  const ms = applyFilters(matches, o);
  const groups = groupByLine(ms);
  const nums = lineNumbers(groups, lineCount, o.keepEmptyLines);
  const sep = unescapeSeparator(o.separator);

  switch (o.format) {
    case 'perline':
      return nums.map((n) => (groups.get(n) ?? []).map((m) => decorate(m.text, o)).join(sep)).join('\n');
    case 'flat':
      return ms.map((m) => decorate(m.text, o)).join('\n');
    case 'json':
      return JSON.stringify(
        nums.map((n) => ({ line: n, matches: (groups.get(n) ?? []).map(jsonMatch) })),
        null,
        2,
      );
    case 'jsonl':
      return nums.map((n) => JSON.stringify({ line: n, matches: (groups.get(n) ?? []).map(jsonMatch) })).join('\n');
    case 'csv': {
      const rows = nums.map((n) => (groups.get(n) ?? []).map((m) => m.text));
      const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
      if (width === 0) return '';
      const header = Array.from({ length: width }, (_, i) => `v${i + 1}`);
      return [header, ...rows.map((r) => [...r, ...Array<string>(width - r.length).fill('')])]
        .map((r) => r.map(csvField).join(','))
        .join('\n');
    }
    case 'table': {
      const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
      return [TABLE_HEADER, ...tableRows(ms)].map((r) => r.map(esc).join('\t')).join('\n');
    }
  }
}

export interface Stats {
  total: number;
  byType: Record<string, number>;
}

export function computeStats(matches: Match[]): Stats {
  const byType: Record<string, number> = Object.create(null);
  for (const m of matches) byType[m.type] = (byType[m.type] ?? 0) + 1;
  return { total: matches.length, byType };
}
