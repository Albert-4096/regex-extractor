import { describe, expect, it } from 'vitest';
import { infer } from '../src/core';
import type { InferResult, Span } from '../src/core';

const INPUT = [
  'Circuit[0] : 01110101 -> [OPERATION] -> 10001010',
  "Circuit[0] : ('01101110', '10110100') -> [OPERATION] -> 11111110",
].join('\n');

/** Span of the nth occurrence of `s` in `text`. */
function span(text: string, s: string, nth = 0): Span {
  let from = -1;
  for (let i = 0; i <= nth; i++) from = text.indexOf(s, from + 1);
  if (from < 0) throw new Error(`"${s}" not found`);
  return { start: from, end: from + s.length };
}

const picked = (r: InferResult) => r.candidates[r.defaultIndex];
const textsOf = (text: string, r: InferResult) => picked(r).matches.map((m) => text.slice(m.start, m.end));

/** Bodies of all lookbehinds in a pattern (no nesting expected). */
function lookbehindBodies(pattern: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '\\') {
      i++;
      continue;
    }
    if (pattern.startsWith('(?<=', i) || pattern.startsWith('(?<!', i)) {
      let j = i + 4;
      let body = '';
      let inClass = false;
      for (; j < pattern.length; j++) {
        const c = pattern[j];
        if (c === '\\') {
          body += c + pattern[j + 1];
          j++;
          continue;
        }
        if (c === '[') inClass = true;
        if (c === ']') inClass = false;
        if (c === ')' && !inClass) break;
        body += c;
      }
      out.push(body);
    }
  }
  return out;
}

/** Fixed width: no quantifiers, alternation or groups left once escapes and classes are collapsed. */
function assertFixedWidth(r: InferResult) {
  for (const c of r.candidates) {
    for (const body of lookbehindBodies(c.pattern)) {
      const flat = body.replace(/\\./g, 'X').replace(/\[[^\]]*\]/g, 'X');
      expect(flat, `lookbehind in ${c.pattern}`).not.toMatch(/[*+?{}|()]/);
    }
  }
}

describe('infer: acceptance test #2', () => {
  // NOTE: the reference input holds FIVE binary values (see acceptance test #1), so with two of
  // them as positives the default candidate yields 5 matches, 3 of them "also matched".
  const pos = [span(INPUT, '01110101'), span(INPUT, '10001010')];
  const r = infer({ text: INPUT, positives: pos });

  it('the default candidate is [01]{8} and extracts every binary value', () => {
    expect(r.defaultIndex).toBeGreaterThanOrEqual(0);
    const c = picked(r);
    expect(c.level).toBe('L1');
    expect(c.pattern).toBe('[01]{8}');
    expect(c.flags).toBe('');
    expect(textsOf(INPUT, r)).toEqual(['01110101', '10001010', '01101110', '10110100', '11111110']);
    expect(c.count).toBe(5);
  });
  it('reports the non-example matches as also matched', () => {
    const c = picked(r);
    expect(c.also).toBe(3);
    expect(c.alsoSpans.map((s) => INPUT.slice(s.start, s.end))).toEqual(['01101110', '10110100', '11111110']);
  });
  it('shows at most 5 candidates and never selects L0', () => {
    expect(r.candidates.length).toBeLessThanOrEqual(5);
    expect(picked(r).level).not.toBe('L0');
    expect(r.conflict).toBeUndefined();
  });
  it('every candidate matches every positive with the exact span', () => {
    for (const c of r.candidates) {
      for (const p of pos) expect(c.matches.some((m) => m.start === p.start && m.end === p.end)).toBe(true);
    }
  });
});

describe('infer: negative examples', () => {
  it('flipping the also-matched quoted values to negative changes the candidate and excludes them', () => {
    const pos = [span(INPUT, '01110101'), span(INPUT, '10001010')];
    const neg = [span(INPUT, '01101110'), span(INPUT, '10110100')];
    const r = infer({ text: INPUT, positives: pos, negatives: neg });
    expect(r.conflict).toBeUndefined();
    const c = picked(r);
    expect(c.pattern).not.toBe('[01]{8}');
    expect(c.pattern).toContain('(?<= )');
    const got = textsOf(INPUT, r);
    expect(got).toEqual(['01110101', '10001010', '11111110']);
    expect(c.also).toBe(1);
    for (const n of neg) {
      expect(c.matches.some((m) => m.start < n.end && m.end > n.start)).toBe(false);
    }
  });
  it('conflicting examples: no valid candidate, and the conflict names the examples', () => {
    const text = 'a 0101 b\na 0101 b';
    const pos = [span(text, '0101', 0)];
    const neg = [span(text, '0101', 1)];
    const r = infer({ text, positives: pos, negatives: neg });
    expect(r.defaultIndex).toBe(-1);
    expect(r.conflict).toBeDefined();
    expect(r.conflict!.negatives).toEqual(neg);
    expect(r.conflict!.message).toContain('"0101"');
    expect(r.conflict!.message).toMatch(/conflict/i);
  });
  it('conflict when all three quoted/line-end values are marked negative but share the positives context', () => {
    const pos = [span(INPUT, '01110101'), span(INPUT, '10001010')];
    const neg = [span(INPUT, '01101110'), span(INPUT, '10110100'), span(INPUT, '11111110')];
    const r = infer({ text: INPUT, positives: pos, negatives: neg });
    expect(r.defaultIndex).toBe(-1);
    expect(r.conflict!.negatives).toEqual([span(INPUT, '11111110')]);
  });
});

describe('infer: candidate levels', () => {
  it('L2 uses a {min,max} range when example lengths differ', () => {
    const text = 'id: deadbeef, cafebabe1234, other zzzz';
    const r = infer({ text, positives: [span(text, 'deadbeef'), span(text, 'cafebabe1234')] });
    const c = picked(r);
    expect(c.level).toBe('L2');
    expect(c.pattern).toBe('[0-9a-f]{8,12}');
    expect(textsOf(text, r)).toEqual(['deadbeef', 'cafebabe1234']);
    expect(c.also).toBe(0);
  });
  it('punctuation stays literal in the shape', () => {
    const text = 'ab-12 cd-34 ef-56';
    const r = infer({ text, positives: [span(text, 'ab-12'), span(text, 'cd-34')] });
    expect(picked(r).pattern).toBe('[0-9a-f]{2}-\\d{2}');
    expect(picked(r).count).toBe(3);
  });
  it('L3 widens to \\w+ / \\S+ when shapes differ, with boundaries', () => {
    const text = 'user=alice id=7 user=bobby9 tag=x';
    const r = infer({ text, positives: [span(text, 'alice'), span(text, 'bobby9')] });
    expect(r.defaultIndex).toBeGreaterThanOrEqual(0);
    const c = picked(r);
    expect(['L2', 'L3']).toContain(c.level);
    expect(c.matches.some((m) => text.slice(m.start, m.end) === 'alice')).toBe(true);
    expect(c.matches.some((m) => text.slice(m.start, m.end) === 'bobby9')).toBe(true);
  });
  it('a literal list (L0) is only a fallback and never auto-selected', () => {
    const text = 'x a b y\nx c d e y';
    const r = infer({ text, positives: [span(text, 'a b'), span(text, 'c d e')] });
    const l0 = r.candidates.filter((c) => c.level === 'L0');
    expect(l0).toHaveLength(1);
    expect(r.candidates[r.candidates.length - 1].level).toBe('L0');
    expect(r.defaultIndex === -1 || r.candidates[r.defaultIndex].level !== 'L0').toBe(true);
    expect(l0[0].pattern).toBe('(?:c d e|a b)');
  });
  it('no positives: nothing to infer', () => {
    const r = infer({ text: 'abc', positives: [] });
    expect(r.candidates).toEqual([]);
    expect(r.defaultIndex).toBe(-1);
    expect(r.conflict).toBeUndefined();
    expect(r.message).toMatch(/positive/i);
  });
});

describe('infer: boundaries and fixed-width lookbehinds', () => {
  it('uses a lookaround boundary when the bare pattern would match inside longer tokens', () => {
    const text = 'x 10101010 y 1010101010101010 z 11110000 w';
    const pos = [span(text, '10101010'), span(text, '11110000')];
    const neg = [span(text, '1010101010101010')];
    const r = infer({ text, positives: pos, negatives: neg });
    const c = picked(r);
    expect(c.pattern).toBe('(?<![01\\w])[01]{8}(?![01\\w])');
    expect(textsOf(text, r)).toEqual(['10101010', '11110000']);
  });
  it('uses a literal context prefix/suffix identical across all positives', () => {
    const text = "k='aa11' k='bb22' k=cc33 z='dd44'";
    const pos = [span(text, 'aa11'), span(text, 'bb22')];
    const neg = [span(text, 'cc33')];
    const r = infer({ text, positives: pos, negatives: neg });
    const c = picked(r);
    // the bare shape and the lookaround variant both also match cc33, so context is needed
    expect(c.pattern).toBe("(?<=k=')[0-9a-f]{4}");
    expect(textsOf(text, r)).toEqual(['aa11', 'bb22']);
  });
  it('context is capped at 3 characters', () => {
    const text = 'name=alpha1; name=beta22; other=gamma3';
    const pos = [span(text, 'alpha1'), span(text, 'beta22')];
    const neg = [span(text, 'gamma3')];
    const r = infer({ text, positives: pos, negatives: neg });
    for (const c of r.candidates) {
      for (const body of lookbehindBodies(c.pattern)) expect(body.replace(/\\./g, 'X').length).toBeLessThanOrEqual(3);
    }
  });
  it('every generated lookbehind is fixed width, across many shapes', () => {
    const cases: [string, string[], string[]][] = [
      [INPUT, ['01110101', '10001010'], ['01101110']],
      ["k='aa11' k='bb22' k=cc33", ['aa11', 'bb22'], ['cc33']],
      ['x [12] y [345] z (6)', ['12', '345'], ['6']],
      ['a.b.c 1.2.3 d.e.f', ['1.2.3'], []],
      ['path=/a/b?q=1&r=2 path=/c/d?q=3', ['/a/b', '/c/d'], []],
      ['tok: AbC123, tok: xyz789, tok: QQ', ['AbC123', 'xyz789'], ['QQ']],
    ];
    for (const [text, p, n] of cases) {
      const r = infer({
        text,
        positives: p.map((s) => span(text, s)),
        negatives: n.map((s) => span(text, s)),
      });
      assertFixedWidth(r);
    }
  });
  it('emoji / surrogate pairs keep spans aligned with text.slice', () => {
    const text = '😀 01110101 😀 10001010 😀';
    const r = infer({ text, positives: [span(text, '01110101'), span(text, '10001010')] });
    expect(textsOf(text, r)).toEqual(['01110101', '10001010']);
    expect(picked(r).matches[0].start).toBe(3);
  });
  it('examples spanning two lines are reported unless matching across the whole text', () => {
    const text = 'ab\ncd';
    const r = infer({ text, positives: [{ start: 0, end: 5 }] });
    expect(r.defaultIndex).toBe(-1);
    expect(r.conflict?.message).toMatch(/line/i);
  });
});
