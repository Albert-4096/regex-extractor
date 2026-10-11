import { snippets } from '../core';
import type { InferCandidate, InferResult, Span } from '../core';
import { clear, h, uid } from './dom';

export interface TeachHooks {
  select(index: number): void;
  adopt(c: InferCandidate): void;
  removeExample(kind: 'pos' | 'neg', index: number): void;
  clearExamples(): void;
  copyText(text: string, what: string): void;
}

export interface TeachState {
  text: string;
  positives: Span[];
  negatives: Span[];
  result: InferResult | null;
  selected: number;
  running: boolean;
  error: string | null;
  note: string;
}

const BOUNDARY_LABEL: Record<string, string> = {
  none: 'no boundary',
  lookaround: 'word-edge lookaround',
  prefix: 'literal prefix',
  suffix: 'literal suffix',
  both: 'literal prefix + suffix',
};

const LEVEL_LABEL: Record<string, string> = {
  L0: 'L0 literal list (fallback)',
  L1: 'L1 exact shape',
  L2: 'L2 length range',
  L3: 'L3 widened class',
};

function preview(text: string, s: Span): string {
  const t = text.slice(s.start, s.end);
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
}

/** The teach-by-example section of the settings panel. */
export class TeachPanel {
  readonly el: HTMLDetailsElement;
  private readonly body = h('div', { class: 'body' });

  constructor(private readonly hooks: TeachHooks) {
    this.el = h('details', { open: true, id: 'teach' }, h('summary', { text: 'Teach by example' }), this.body);
  }

  open(): void {
    this.el.open = true;
  }

  update(s: TeachState): void {
    clear(this.body);
    this.body.append(
      h('p', {
        class: 'muted',
        text:
          'Select text in the input, then press "Extract this" (or "Not this"). You can also click a highlight ' +
          'to cycle it: positive, negative, neutral. Lighter, dotted highlights are "also matched".',
      }),
    );
    if (s.note) this.body.append(h('p', { class: 'notice', role: 'status', text: s.note }));

    if (s.positives.length === 0 && s.negatives.length === 0) {
      this.body.append(h('p', { class: 'muted', text: 'No examples yet.' }));
      return;
    }

    this.body.append(this.exampleList('Extract these (positive)', 'pos', s.positives, s.text));
    this.body.append(this.exampleList('Not these (negative)', 'neg', s.negatives, s.text));
    this.body.append(h('div', { class: 'row' }, h('button', { class: 'small', text: 'Clear examples', on: { click: () => this.hooks.clearExamples() } })));

    if (s.running && !s.result) this.body.append(h('p', { class: 'muted', text: 'Inferring…' }));
    if (s.error) this.body.append(h('p', { class: 'notice error', role: 'alert', text: s.error }));
    const r = s.result;
    if (!r) return;
    if (r.conflict) this.body.append(h('p', { class: 'notice error', role: 'alert', text: r.conflict.message }));
    else if (r.candidates.length === 0 || r.defaultIndex === -1) {
      this.body.append(h('p', { class: 'notice', role: 'status', text: r.message }));
    }
    if (r.candidates.length) {
      this.body.append(h('h3', { class: 'muted', text: 'Candidates' }));
      r.candidates.forEach((c, i) => this.body.append(this.candidate(c, i, i === s.selected)));
    }
  }

  private exampleList(title: string, kind: 'pos' | 'neg', spans: Span[], text: string): HTMLElement {
    const list = h('ul', { class: 'examples' });
    if (spans.length === 0) list.append(h('li', { class: 'muted', text: 'none' }));
    spans.forEach((sp, i) => {
      list.append(
        h(
          'li',
          { class: 'row' },
          h('code', { text: preview(text, sp), title: `chars ${sp.start}–${sp.end}` }),
          h('span', { class: 'muted', text: `${sp.start}–${sp.end}` }),
          h('button', {
            class: 'small',
            text: 'Remove',
            'aria-label': `Remove example ${preview(text, sp)}`,
            on: { click: () => this.hooks.removeExample(kind, i) },
          }),
        ),
      );
    });
    return h('div', {}, h('strong', { text: title }), list);
  }

  private candidate(c: InferCandidate, index: number, picked: boolean): HTMLElement {
    const id = uid('cand');
    const radio = h('input', {
      type: 'radio',
      name: 'candidate',
      id,
      checked: picked,
      on: { change: () => this.hooks.select(index) },
    });
    const flagText = c.flags === '' ? 'flags: none' : `flags: ${c.flags}`;
    const head = h(
      'div',
      { class: 'row' },
      radio,
      h('label', { for: id, text: `${LEVEL_LABEL[c.level]} · ${BOUNDARY_LABEL[c.boundary]}` }),
    );
    const snip = h('details', {}, h('summary', { text: 'Copy as…' }));
    snip.addEventListener('toggle', () => {
      if (snip.open && snip.children.length === 1) snip.append(this.snippetList(c.pattern, c.flags));
    });
    return h(
      'div',
      { class: `cand${picked ? ' picked' : ''}` },
      head,
      h('code', { text: c.pattern }),
      h('div', { class: 'muted', text: `${flagText} · ${c.count.toLocaleString()} matches · ${c.also.toLocaleString()} also matched` }),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'small', text: 'Adopt', title: 'Add to the custom regex list', on: { click: () => this.hooks.adopt(c) } }),
        h('button', { class: 'small', text: 'Copy regex', on: { click: () => this.hooks.copyText(c.pattern, 'regex') } }),
      ),
      snip,
    );
  }

  snippetList(pattern: string, flags: string): HTMLElement {
    const wrap = h('div', { class: 'snippets body' });
    for (const sn of snippets(pattern, flags)) {
      wrap.append(
        h(
          'div',
          {},
          h('div', { class: 'row' }, h('strong', { text: sn.title }), h('button', { class: 'small', text: 'Copy', on: { click: () => this.hooks.copyText(sn.code, sn.title) } })),
          h('pre', { text: sn.code }),
          ...sn.warnings.map((w) => h('p', { class: 'notice', text: `Not equivalent: ${w}` })),
        ),
      );
    }
    return wrap;
  }
}
