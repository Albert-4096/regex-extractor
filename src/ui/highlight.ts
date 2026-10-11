import type { Match } from '../core';
import { clear, h } from './dom';
import { typeClass } from './colors';

export const HIGHLIGHT_LIMIT = 3000;

export function describeMatch(m: Match): string {
  const parts = [`${m.type}`, `line ${m.line}`, `chars ${m.start}–${m.end}`];
  if (m.alt?.length) parts.push(`also: ${m.alt.join(', ')}`);
  if (m.meta) for (const k of Object.keys(m.meta)) parts.push(`${k}: ${m.meta[k]}`);
  if (m.groups) for (const k of Object.keys(m.groups)) parts.push(`${k} = ${m.groups[k]}`);
  return parts.join(' · ');
}

export interface HighlightOptions {
  /** Extra CSS classes for the span of match `i`. */
  extraClass?: (m: Match, i: number) => string;
  onClickMatch?: (i: number) => void;
}

/** Renders `text` with a <span> per match. Offsets are the same UTF-16 offsets the core uses. */
export function renderHighlight(
  container: HTMLElement,
  text: string,
  matches: Match[],
  opts: HighlightOptions = {},
): { shown: number } {
  clear(container);
  if (text === '') {
    container.append(h('span', { class: 'muted', text: 'Nothing to highlight.' }));
    return { shown: 0 };
  }
  const frag = document.createDocumentFragment();
  const shown = Math.min(matches.length, HIGHLIGHT_LIMIT);
  let pos = 0;
  for (let i = 0; i < shown; i++) {
    const m = matches[i];
    if (m.start < pos) continue;
    if (m.start > pos) frag.append(text.slice(pos, m.start));
    const cls = ['hl', typeClass(m.type), opts.extraClass?.(m, i) ?? ''].filter(Boolean).join(' ');
    const span = h('span', { class: cls, title: describeMatch(m), 'data-i': String(i) }, text.slice(m.start, m.end));
    frag.append(span);
    pos = m.end;
  }
  if (pos < text.length) frag.append(text.slice(pos));
  container.append(frag);
  if (opts.onClickMatch) {
    const cb = opts.onClickMatch;
    container.onclick = (ev) => {
      const t = (ev.target as HTMLElement | null)?.closest?.('.hl');
      const idx = t?.getAttribute('data-i');
      if (idx !== null && idx !== undefined) cb(Number(idx));
    };
  }
  return { shown };
}
