import { lineAt, splitLines } from './lines';
import type { Line } from './lines';

export interface Span {
  start: number;
  end: number;
}

export type Level = 'L0' | 'L1' | 'L2' | 'L3';
export type Boundary = 'none' | 'lookaround' | 'prefix' | 'suffix' | 'both';

export interface InferInput {
  text: string;
  positives: Span[];
  negatives?: Span[];
  /** Match over the whole text instead of line by line (same switch as extraction). */
  acrossText?: boolean;
}

export interface InferCandidate {
  level: Level;
  boundary: Boundary;
  pattern: string;
  flags: string;
  /** Total number of matches over the whole input. */
  count: number;
  /** Matches that are not one of the positive examples. */
  also: number;
  matches: Span[];
  alsoSpans: Span[];
}

export interface InferResult {
  candidates: InferCandidate[];
  /** Index of the pre-selected candidate; -1 when there is none (L0 is never pre-selected). */
  defaultIndex: number;
  conflict?: { message: string; positives: Span[]; negatives: Span[] };
  message: string;
}

export const MAX_CANDIDATES = 5;
const SPAN_CAP = 20_000;
const MATCH_CAP = 100_000;

/* ---------- character class ladder (narrowest first) ---------- */

interface ClassDef {
  src: string;
  /** Contents for use inside a bracket expression. */
  inner: string;
  test: RegExp;
}

const LADDER: ClassDef[] = [
  { src: '[01]', inner: '01', test: /^[01]$/ },
  { src: '\\d', inner: '\\d', test: /^\d$/ },
  { src: '[0-9a-f]', inner: '0-9a-f', test: /^[0-9a-f]$/ },
  { src: '[0-9A-F]', inner: '0-9A-F', test: /^[0-9A-F]$/ },
  { src: '[0-9a-fA-F]', inner: '0-9a-fA-F', test: /^[0-9a-fA-F]$/ },
  { src: '[a-z]', inner: 'a-z', test: /^[a-z]$/ },
  { src: '[A-Z]', inner: 'A-Z', test: /^[A-Z]$/ },
  { src: '[A-Za-z]', inner: 'A-Za-z', test: /^[A-Za-z]$/ },
  { src: '[A-Za-z0-9]', inner: 'A-Za-z0-9', test: /^[A-Za-z0-9]$/ },
  { src: '\\w', inner: '\\w', test: /^\w$/ },
];

function leastGeneral(chars: string): ClassDef {
  for (const c of LADDER) {
    if ([...chars].every((ch) => c.test.test(ch))) return c;
  }
  return LADDER[LADDER.length - 1];
}

/** Escape a literal for use outside a character class. Escapes only syntax characters, so the
 *  result stays valid with the `u` flag and in Python / PCRE. */
export function escapeLiteral(s: string): string {
  let out = '';
  for (const ch of s) {
    if ('\\^$.*+?()[]{}|/'.includes(ch)) out += ch === '/' ? ch : '\\' + ch;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch < ' ' || ch === '\x7f') out += '\\x' + ch.charCodeAt(0).toString(16).padStart(2, '0');
    else out += ch;
  }
  return out;
}

/* ---------- shapes ---------- */

type Tok = { kind: 'run'; chars: string } | { kind: 'lit'; ch: string };
type Slot = { kind: 'lit'; ch: string } | { kind: 'run'; cls: ClassDef; min: number; max: number };

function tokenize(s: string): Tok[] {
  const toks: Tok[] = [];
  for (const ch of s) {
    const isWord = /^[A-Za-z0-9_]$/.test(ch);
    const last = toks[toks.length - 1];
    if (isWord && last && last.kind === 'run') last.chars += ch;
    else toks.push(isWord ? { kind: 'run', chars: ch } : { kind: 'lit', ch });
  }
  return toks;
}

/** Merge the shapes of all examples; null when their skeletons differ. */
function mergeShapes(examples: string[]): Slot[] | null {
  const shapes = examples.map(tokenize);
  const first = shapes[0];
  if (shapes.some((s) => s.length !== first.length)) return null;
  const slots: Slot[] = [];
  for (let i = 0; i < first.length; i++) {
    const t = first[i];
    if (t.kind === 'lit') {
      if (!shapes.every((s) => s[i].kind === 'lit' && (s[i] as { ch: string }).ch === t.ch)) return null;
      slots.push({ kind: 'lit', ch: t.ch });
    } else {
      if (!shapes.every((s) => s[i].kind === 'run')) return null;
      const runs = shapes.map((s) => (s[i] as { chars: string }).chars);
      const lens = runs.map((r) => r.length);
      slots.push({ kind: 'run', cls: leastGeneral(runs.join('')), min: Math.min(...lens), max: Math.max(...lens) });
    }
  }
  return slots;
}

function quant(min: number, max: number, range: boolean): string {
  if (!range || min === max) return min === 1 ? '' : `{${min}}`;
  return `{${min},${max}}`;
}

function slotsPattern(slots: Slot[], range: boolean): string {
  return slots
    .map((s) => (s.kind === 'lit' ? escapeLiteral(s.ch) : s.cls.src + quant(s.min, s.max, range)))
    .join('');
}

/* ---------- boundaries ---------- */

function edgeClass(slot: Slot | undefined): string {
  if (!slot || slot.kind === 'lit') return '\\w';
  return slot.cls.inner === '\\w' ? '\\w' : `[${slot.cls.inner}\\w]`;
}

function commonSuffix(strs: string[]): string {
  let out = strs[0];
  for (const s of strs) {
    let i = 0;
    while (i < out.length && i < s.length && out[out.length - 1 - i] === s[s.length - 1 - i]) i++;
    out = out.slice(out.length - i);
  }
  return out;
}

function commonPrefix(strs: string[]): string {
  let out = strs[0];
  for (const s of strs) {
    let i = 0;
    while (i < out.length && i < s.length && out[i] === s[i]) i++;
    out = out.slice(0, i);
  }
  return out;
}

/* ---------- evaluation ---------- */

function runRegex(re: RegExp, text: string, lines: Line[], acrossText: boolean): { spans: Span[]; capped: boolean } {
  const spans: Span[] = [];
  const scan = (s: string, base: number): boolean => {
    for (const m of s.matchAll(re)) {
      if (m[0].length === 0) continue;
      spans.push({ start: base + m.index, end: base + m.index + m[0].length });
      if (spans.length >= MATCH_CAP) return true;
    }
    return false;
  };
  if (acrossText) return { spans, capped: scan(text, 0) };
  for (const line of lines) {
    if (line.text.length > 0 && scan(line.text, line.start)) return { spans, capped: true };
  }
  return { spans, capped: false };
}

const fmt = (t: string, s: Span) => `"${t.length > 40 ? t.slice(0, 40) + '…' : t}" (chars ${s.start}–${s.end})`;

export function infer(input: InferInput): InferResult {
  const { text } = input;
  const acrossText = input.acrossText === true;
  const valid = (s: Span) => Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 && s.end > s.start && s.end <= text.length;
  const uniq = (a: Span[]) => {
    const seen = new Set<string>();
    return a
      .filter(valid)
      .sort((x, y) => x.start - y.start || x.end - y.end)
      .filter((s) => (seen.has(`${s.start}:${s.end}`) ? false : (seen.add(`${s.start}:${s.end}`), true)));
  };
  const positives = uniq(input.positives);
  const negatives = uniq(input.negatives ?? []);

  if (positives.length === 0) {
    return { candidates: [], defaultIndex: -1, message: 'Select at least one positive example: the text you want to extract.' };
  }

  const lines = splitLines(text);

  if (!acrossText) {
    const multi = positives.filter((p) => lineAt(lines, p.start) !== lineAt(lines, p.end - 1));
    if (multi.length) {
      const message =
        `Example ${multi.map((s) => fmt(text.slice(s.start, s.end), s)).join(', ')} spans several lines. ` +
        "Select text inside one line, or turn on 'Match across the whole text'.";
      return { candidates: [], defaultIndex: -1, conflict: { message, positives: multi, negatives: [] }, message };
    }
  }

  const strings = positives.map((p) => text.slice(p.start, p.end));
  const slots = mergeShapes(strings);

  // Literal context taken from the same line as each example.
  const lineOf = (offset: number) => lines[lineAt(lines, offset) - 1];
  const before = positives.map((p) => {
    const ln = lineOf(p.start);
    return text.slice(Math.max(ln.start, p.start - 3), p.start);
  });
  const after = positives.map((p) => {
    const ln = lineOf(p.end - 1);
    return text.slice(p.end, Math.min(ln.start + ln.text.length, p.end + 3));
  });
  const prefix = commonSuffix(before);
  const suffix = commonPrefix(after);

  interface Spec {
    level: Level;
    boundary: Boundary;
    pattern: string;
  }
  const specs: Spec[] = [];
  const add = (level: Level, core: string, leftEdge: string, rightEdge: string) => {
    specs.push({ level, boundary: 'none', pattern: core });
    specs.push({ level, boundary: 'lookaround', pattern: `(?<!${leftEdge})${core}(?!${rightEdge})` });
    if (prefix) specs.push({ level, boundary: 'prefix', pattern: `(?<=${escapeLiteral(prefix)})${core}` });
    if (suffix) specs.push({ level, boundary: 'suffix', pattern: `${core}(?=${escapeLiteral(suffix)})` });
    if (prefix && suffix) {
      specs.push({ level, boundary: 'both', pattern: `(?<=${escapeLiteral(prefix)})${core}(?=${escapeLiteral(suffix)})` });
    }
  };

  if (slots) {
    const runs = slots.filter((s): s is Extract<Slot, { kind: 'run' }> => s.kind === 'run');
    const left = edgeClass(slots[0]);
    const right = edgeClass(slots[slots.length - 1]);
    if (runs.every((r) => r.min === r.max)) add('L1', slotsPattern(slots, false), left, right);
    if (runs.some((r) => r.min !== r.max)) add('L2', slotsPattern(slots, true), left, right);
  }
  if (strings.every((s) => /^\w+$/.test(s))) add('L3', '\\w+', '\\w', '\\w');
  else if (strings.every((s) => /^\S+$/.test(s))) add('L3', '\\S+', '\\S', '\\S');

  const posKey = new Map<number, number>();
  for (const p of positives) posKey.set(p.start, p.end);

  const evaluate = (pattern: string): { spans: Span[]; posOk: boolean; negHits: Span[] } | null => {
    let re: RegExp;
    try {
      re = new RegExp(pattern, 'g');
    } catch {
      return null;
    }
    const { spans } = runRegex(re, text, lines, acrossText);
    const starts = new Map<number, number>();
    for (const s of spans) starts.set(s.start, s.end);
    const posOk = positives.every((p) => starts.get(p.start) === p.end);
    const negHits = negatives.filter((n) => {
      // spans are sorted and disjoint: binary search the first span ending after n.start
      let lo = 0;
      let hi = spans.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (spans[mid].end <= n.start) lo = mid + 1;
        else hi = mid;
      }
      return lo < spans.length && spans[lo].start < n.end;
    });
    return { spans, posOk, negHits };
  };

  const toCandidate = (spec: Spec, spans: Span[]): InferCandidate => {
    const also = spans.filter((s) => posKey.get(s.start) !== s.end);
    return {
      level: spec.level,
      boundary: spec.boundary,
      pattern: spec.pattern,
      flags: '',
      count: spans.length,
      also: also.length,
      matches: spans.slice(0, SPAN_CAP),
      alsoSpans: also.slice(0, SPAN_CAP),
    };
  };

  const good: InferCandidate[] = [];
  const seen = new Set<string>();
  let bestConflict: Span[] | null = null;
  for (const spec of specs) {
    if (seen.has(spec.pattern)) continue;
    seen.add(spec.pattern);
    const ev = evaluate(spec.pattern);
    if (!ev || !ev.posOk) continue;
    if (ev.negHits.length === 0) {
      good.push(toCandidate(spec, ev.spans));
      if (good.length >= MAX_CANDIDATES) break;
    } else if (!bestConflict || ev.negHits.length < bestConflict.length) {
      bestConflict = ev.negHits;
    }
  }

  // L0: exact literals. Fallback only, never pre-selected.
  let l0: InferCandidate | null = null;
  const lits = [...new Set(strings)].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  const l0Spec: Spec = {
    level: 'L0',
    boundary: 'none',
    pattern: lits.length === 1 ? escapeLiteral(lits[0]) : `(?:${lits.map(escapeLiteral).join('|')})`,
  };
  if (!seen.has(l0Spec.pattern)) {
    const ev = evaluate(l0Spec.pattern);
    if (ev && ev.posOk && ev.negHits.length === 0) l0 = toCandidate(l0Spec, ev.spans);
  }

  const candidates = [...good];
  if (l0 && candidates.length < MAX_CANDIDATES) candidates.push(l0);

  if (good.length > 0) {
    return { candidates, defaultIndex: 0, message: `${good[0].count} matches, ${good[0].also} also matched.` };
  }
  if (bestConflict) {
    const names = bestConflict.map((s) => fmt(text.slice(s.start, s.end), s)).join(', ');
    const message =
      `Conflicting examples: every pattern that matches the positive examples also matches the negative ` +
      `example${bestConflict.length > 1 ? 's' : ''} ${names}. Remove one of them or add more context.`;
    return { candidates, defaultIndex: -1, conflict: { message, positives, negatives: bestConflict }, message };
  }
  if (l0) {
    return {
      candidates,
      defaultIndex: -1,
      message: 'Only an exact list of the examples could be built. Add more examples with the same shape, or write a regex.',
    };
  }

  const names = positives.map((s) => fmt(text.slice(s.start, s.end), s)).join(', ');
  const message =
    `Conflicting examples: no pattern matches all positive examples with their exact spans (${names}). ` +
    'Remove an example that has a different shape.';
  return { candidates: [], defaultIndex: -1, conflict: { message, positives, negatives: [] }, message };
}
