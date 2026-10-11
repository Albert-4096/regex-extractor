import type { Candidate, Match } from './types';

/**
 * Greedy overlap resolution. Candidates are sorted by (priority desc, length desc,
 * start asc) and accepted unless they overlap an accepted one. A rejected candidate
 * with exactly the same span is recorded in the winner's `alt`.
 */
export function resolveOverlaps(candidates: Candidate[]): Match[] {
  const sorted = candidates
    .slice()
    .sort((a, b) => b.priority - a.priority || b.end - b.start - (a.end - a.start) || a.start - b.start);

  // Accepted spans are disjoint, so keep them sorted by start for O(log n) overlap checks.
  const acc: { c: Candidate; alt: string[] }[] = [];

  const lowerBound = (start: number): number => {
    let lo = 0;
    let hi = acc.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (acc[mid].c.start < start) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  for (const c of sorted) {
    const i = lowerBound(c.start);
    const prev = i > 0 ? acc[i - 1] : undefined;
    const next = i < acc.length ? acc[i] : undefined;
    const hit =
      prev && prev.c.end > c.start ? prev : next && next.c.start < c.end ? next : undefined;
    if (hit) {
      if (hit.c.start === c.start && hit.c.end === c.end && !hit.alt.includes(c.type) && hit.c.type !== c.type) {
        hit.alt.push(c.type);
      }
      continue;
    }
    acc.splice(i, 0, { c, alt: [] });
  }

  return acc.map(({ c, alt }) => {
    const m: Match = { line: c.line, start: c.start, end: c.end, text: c.text, type: c.type };
    if (c.groups) m.groups = c.groups;
    if (alt.length) m.alt = alt;
    if (c.meta) m.meta = c.meta;
    return m;
  });
}
