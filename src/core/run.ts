import { DETECTORS, defaultParams, getDetector } from './detectors';
import { countLines, lineAt, splitLines } from './lines';
import type { Line } from './lines';
import { resolveOverlaps } from './resolve';
import { MAX_INPUT_CHARS, MAX_MATCHES } from './types';
import type {
  Candidate,
  CustomError,
  CustomRegex,
  Detector,
  ExtractConfig,
  Match,
  Params,
  RunResult,
} from './types';

export function defaultConfig(): ExtractConfig {
  return {
    detectors: DETECTORS.map((d) => ({ id: d.id, enabled: d.defaultEnabled, params: defaultParams(d) })),
    custom: [],
    acrossText: false,
  };
}

export type CompileResult = { ok: true; regex: RegExp } | { ok: false; error: string };

/** Compile one custom entry. Never throws. Adds the internal `g` and `d` flags. */
export function compileCustom(entry: CustomRegex): CompileResult {
  if (entry.pattern === '') return { ok: false, error: 'Pattern is empty' };
  const flags = [...new Set(entry.flags.split(''))].filter((f) => 'imsu'.includes(f)).join('');
  try {
    return { ok: true, regex: new RegExp(entry.pattern, flags + 'gd') };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

interface CompiledDetector {
  det: Detector;
  re: RegExp;
  params: Params;
}
interface CompiledCustom {
  entry: CustomRegex;
  re: RegExp;
  priority: number;
}
export interface Compiled {
  detectors: CompiledDetector[];
  custom: CompiledCustom[];
  errors: CustomError[];
  acrossText: boolean;
}

const CUSTOM_BASE_PRIORITY = 100_000;

/** Precompile every regex once so repeated runs do no RegExp construction. */
export function compile(config: ExtractConfig): Compiled {
  const detectors: CompiledDetector[] = [];
  const custom: CompiledCustom[] = [];
  const errors: CustomError[] = [];
  for (const s of config.detectors) {
    const det = getDetector(s.id);
    if (!det || !s.enabled) continue;
    const params: Params = { ...defaultParams(det), ...s.params };
    try {
      const src = det.build(params);
      const flags = src.flags.includes('g') ? src.flags : src.flags + 'g';
      detectors.push({ det, re: new RegExp(src.source, flags), params });
    } catch (e) {
      errors.push({ index: -1, id: s.id, label: det.label, message: e instanceof Error ? e.message : String(e) });
    }
  }
  config.custom.forEach((entry, index) => {
    if (entry.pattern === '') return;
    const res = compileCustom(entry);
    if (res.ok) custom.push({ entry, re: res.regex, priority: CUSTOM_BASE_PRIORITY - index });
    else errors.push({ index, id: entry.id, label: entry.label, message: res.error });
  });
  return { detectors, custom, errors, acrossText: config.acrossText };
}

interface Collect {
  candidates: Candidate[];
  capped: boolean;
}

function collect(text: string, base: number, lineFor: (start: number) => number, c: Compiled, out: Collect): void {
  const cap = MAX_MATCHES + 1;
  for (const { det, re, params } of c.detectors) {
    let n = 0;
    for (const m of text.matchAll(re) as IterableIterator<RegExpExecArray>) {
      if (m[0].length === 0) continue;
      if (det.validate && !det.validate(m, params)) continue;
      let mText = m[0];
      let offset = 0;
      let type = det.id;
      let meta: Record<string, string> | undefined;
      if (det.refine) {
        const r = det.refine(m, params);
        if (!r) continue;
        mText = r.text;
        offset = r.offset;
        if (r.type) type = r.type;
        meta = r.meta;
      }
      if (mText.length === 0) continue;
      const start = base + m.index + offset;
      out.candidates.push({
        start,
        end: start + mText.length,
        text: mText,
        type,
        priority: det.priority,
        line: lineFor(start),
        ...(meta ? { meta } : {}),
      });
      if (++n >= cap) {
        out.capped = true;
        break;
      }
    }
  }
  for (const { entry, re, priority } of c.custom) {
    let n = 0;
    for (const m of text.matchAll(re) as IterableIterator<RegExpExecArray>) {
      if (m[0].length === 0) continue;
      let mText = m[0];
      let start = base + m.index;
      let groups: Record<string, string> | undefined;
      if (entry.captureMode === 'group1') {
        const idx = m.indices?.[1];
        if (!idx || m[1] === undefined) continue;
        mText = m[1];
        start = base + idx[0];
      } else if (entry.captureMode === 'named' && m.groups) {
        groups = Object.create(null) as Record<string, string>;
        for (const k of Object.keys(m.groups)) {
          const v = m.groups[k];
          if (v !== undefined) groups[k] = v;
        }
      }
      if (mText.length === 0) continue;
      out.candidates.push({
        start,
        end: start + mText.length,
        text: mText,
        type: entry.label,
        priority,
        line: lineFor(start),
        ...(groups ? { groups } : {}),
      });
      if (++n >= cap) {
        out.capped = true;
        break;
      }
    }
  }
}

export function run(text: string, c: Compiled): RunResult {
  const t0 = Date.now();
  const base: RunResult = {
    matches: [],
    lineCount: 0,
    truncated: false,
    errors: c.errors,
    inputTooLarge: false,
    elapsedMs: 0,
  };
  if (text.length > MAX_INPUT_CHARS) {
    return { ...base, inputTooLarge: true, elapsedMs: Date.now() - t0 };
  }
  const lines: Line[] = splitLines(text);
  base.lineCount = countLines(lines, text);
  let matches: Match[] = [];
  let truncated = false;

  if (c.acrossText) {
    const out: Collect = { candidates: [], capped: false };
    collect(text, 0, (s) => lineAt(lines, s), c, out);
    matches = resolveOverlaps(out.candidates);
    truncated = out.capped;
  } else {
    outer: for (const line of lines) {
      if (line.text.length === 0) continue;
      const out: Collect = { candidates: [], capped: false };
      const n = line.number;
      collect(line.text, line.start, () => n, c, out);
      if (out.capped) truncated = true;
      if (out.candidates.length === 0) continue;
      for (const m of resolveOverlaps(out.candidates)) {
        matches.push(m);
        if (matches.length >= MAX_MATCHES) {
          truncated = true;
          break outer;
        }
      }
    }
  }
  if (matches.length > MAX_MATCHES) {
    matches = matches.slice(0, MAX_MATCHES);
    truncated = true;
  }
  return { ...base, matches, truncated, elapsedMs: Date.now() - t0 };
}

export function extract(text: string, config: ExtractConfig): RunResult {
  return run(text, compile(config));
}
