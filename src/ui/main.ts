import './styles.css';
import {
  MAX_INPUT_CHARS,
  computeStats,
  formatOutput,
  lineAt,
  parseSettings,
  resolveOverlaps,
  serializeSettings,
  splitLines,
  TABLE_HEADER,
  tableRows,
} from '../core';
import type { Candidate, InferCandidate, InferResult, Match, OutputFormat, RunResult, Span } from '../core';
import { createRunner, StaleError, TimeoutError } from '../worker/client';
import { clear, h } from './dom';
import { typeClass } from './colors';
import { HIGHLIGHT_LIMIT, describeMatch, renderHighlight } from './highlight';
import { SettingsPanel } from './panel';
import { SAMPLE_INPUT, initialState } from './state';
import { readStorage, removeStorage, writeStorage } from './storage';
import { TeachPanel } from './teach';
import type { TeachState } from './teach';

const SETTINGS_KEY = 'regex-extractor:settings:v1';
const INPUT_KEY = 'regex-extractor:input:v1';
const DEBOUNCE_MS = 150;
const TABLE_ROW_LIMIT = 2000;

const state = initialState();
/** Two workers: a new example must never cancel a running extraction, and vice versa. */
const runner = createRunner();
const inferRunner = createRunner();

const teach: TeachState = {
  text: '',
  positives: [],
  negatives: [],
  result: null,
  selected: -1,
  running: false,
  error: null,
  note: '',
};

/* ---------- restore convenience state ---------- */
{
  const saved = readStorage(SETTINGS_KEY);
  if (saved) {
    const res = parseSettings(saved);
    if (res.ok) {
      state.config = res.settings.config;
      state.output = res.settings.output;
    }
  }
  const lastInput = readStorage(INPUT_KEY);
  if (lastInput !== null && lastInput !== '') {
    state.input = lastInput;
    state.isSample = false;
    state.rememberInput = true;
  }
}

/* ---------- skeleton ---------- */
const inputArea = h('textarea', {
  id: 'input',
  rows: 12,
  spellcheck: false,
  autocomplete: 'off',
  autocapitalize: 'off',
  placeholder: 'Paste logs, CTF output, dumps…',
  value: state.input,
});
const sampleBadge = h('span', { class: 'badge', text: 'Sample input' });
const inputMeta = h('span', { class: 'muted', 'aria-live': 'polite' });
const inputNotice = h('p', { class: 'notice error', role: 'alert', hidden: true });
const hlView = h('pre', { class: 'hl-view', tabindex: 0, 'aria-label': 'Highlighted input' });
const hlNote = h('span', { class: 'muted' });
const teachSummary = h('p', { class: 'teach-summary muted', role: 'status', 'aria-live': 'polite' });

const formatSelect = h(
  'select',
  { id: 'format' },
  ...(
    [
      ['perline', 'Per line'],
      ['flat', 'Flat (one per line)'],
      ['json', 'JSON'],
      ['jsonl', 'JSON Lines'],
      ['csv', 'CSV'],
      ['table', 'Table'],
    ] as [OutputFormat, string][]
  ).map(([v, t]) => h('option', { value: v, text: t })),
);
const copyBtn = h('button', { class: 'primary', text: 'Copy' });
const downloadBtn = h('button', { text: 'Download' });
const statsBar = h('div', { class: 'stats', 'aria-live': 'polite' });
const runNotice = h('p', { class: 'notice error', role: 'alert', hidden: true });
const truncNotice = h('p', { class: 'notice', role: 'status', hidden: true });
const outText = h('textarea', { class: 'out-text', readOnly: true, spellcheck: false, 'aria-label': 'Output', wrap: 'off' });
const tableWrap = h('div', { class: 'table-wrap', hidden: true });
const outStatus = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });

const teachPanel = new TeachPanel({
  select: (i) => {
    teach.selected = i;
    renderTeach();
    renderHighlightView();
  },
  adopt: (c: InferCandidate) => {
    const n = state.config.custom.length + 1;
    panel.addCustom({ label: `learned ${n}`, pattern: c.pattern, flags: c.flags, captureMode: 'full' });
    teach.note = `Added "learned ${n}" to the custom regexes.`;
    renderTeach();
  },
  removeExample: (kind, i) => {
    (kind === 'pos' ? teach.positives : teach.negatives).splice(i, 1);
    examplesChanged();
  },
  clearExamples: () => {
    teach.positives = [];
    teach.negatives = [];
    examplesChanged();
  },
  copyText: (text, what) => copyToClipboard(text, what),
});

const panel = new SettingsPanel(
  state,
  {
    onConfigChange: () => {
      persistSettings();
      scheduleRun();
      scheduleInfer();
    },
    onOutputChange: () => {
      persistSettings();
      renderOutput();
    },
    onPersistChange: () => {
      persistSettings();
      persistInput();
    },
    onReplaced: () => {
      panel.build();
      formatSelect.value = state.output.format;
      persistSettings();
      scheduleRun(true);
      renderOutput();
    },
    download,
    snippets: (pattern, flags) => teachPanel.snippetList(pattern, flags),
  },
  { sections: [teachPanel.el] },
);

function openSettings(open = true): void {
  panel.el.hidden = !open;
  settingsToggle.setAttribute('aria-expanded', String(open));
  layout.classList.toggle('settings-open', open);
}

const settingsToggle = h('button', {
  text: 'Settings',
  'aria-expanded': 'false',
  'aria-controls': 'settings',
  on: { click: () => openSettings(panel.el.hidden) },
});

const clearBtn = h('button', {
  text: 'Clear',
  on: {
    click: () => {
      setInput('');
      inputArea.focus();
    },
  },
});
const sampleBtn = h('button', { text: 'Load sample', on: { click: () => setInput(SAMPLE_INPUT, true) } });
const extractBtn = h('button', {
  class: 'primary',
  text: 'Extract this',
  title: 'Use the selected text as a positive example',
  on: { click: () => addExample('pos') },
});
const notBtn = h('button', {
  text: 'Not this',
  title: 'Use the selected text as a negative example',
  on: { click: () => addExample('neg') },
});

const leftCol = h(
  'div',
  { class: 'col' },
  h(
    'section',
    { class: 'pane', 'aria-labelledby': 'input-h' },
    h(
      'div',
      { class: 'pane-head' },
      h('h2', { id: 'input-h' }, h('label', { for: 'input', text: 'Input' })),
      sampleBadge,
      h('span', { class: 'spacer' }),
      inputMeta,
      sampleBtn,
      clearBtn,
    ),
    inputArea,
    h('div', { class: 'row' }, extractBtn, notBtn, h('span', { class: 'muted', text: 'Select text above, then teach the tool by example.' })),
    inputNotice,
  ),
  h(
    'section',
    { class: 'pane', 'aria-labelledby': 'hl-h' },
    h('div', { class: 'pane-head' }, h('h2', { id: 'hl-h', text: 'Highlighted view' }), hlNote),
    hlView,
    teachSummary,
  ),
);
const rightCol = h(
  'div',
  { class: 'col' },
  h(
    'section',
    { class: 'pane', 'aria-labelledby': 'out-h' },
    h(
      'div',
      { class: 'pane-head' },
      h('h2', { id: 'out-h', text: 'Output' }),
      h('span', { class: 'spacer' }),
      h('label', { for: 'format', class: 'muted', text: 'Format' }),
      formatSelect,
      copyBtn,
      downloadBtn,
    ),
    statsBar,
    runNotice,
    truncNotice,
    outText,
    tableWrap,
    outStatus,
  ),
);

const layout = h('div', { class: 'layout' }, h('main', { class: 'work' }, leftCol, rightCol), panel.el);
document.getElementById('app')!.append(
  h(
    'div',
    { class: 'app' },
    h(
      'header',
      { class: 'topbar' },
      h('h1', { text: 'regex-extractor' }),
      h('span', { class: 'tag', text: 'paste text, get the values · runs 100% in your browser' }),
      h('span', { class: 'spacer' }),
      settingsToggle,
    ),
    layout,
  ),
);

/* ---------- running extraction ---------- */
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function scheduleRun(immediate = false): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => void doRun(), immediate ? 0 : DEBOUNCE_MS);
}

async function doRun(): Promise<void> {
  const mine = ++seq;
  if (state.input.length > MAX_INPUT_CHARS) {
    state.result = null;
    state.error = null;
    state.running = false;
    renderAll();
    return;
  }
  state.running = true;
  renderStatus();
  try {
    const res = await runner.run<RunResult>({ op: 'extract', text: state.input, config: state.config });
    if (mine !== seq) return; // a newer run owns the UI
    state.result = res;
    state.error = null;
  } catch (e) {
    if (e instanceof StaleError || mine !== seq) return;
    state.result = null;
    state.error =
      e instanceof TimeoutError
        ? 'Pattern too slow or catastrophic backtracking. The run was stopped after 2 s and the worker was restarted. Simplify the pattern.'
        : `The run failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  state.running = false;
  renderAll();
}

/* ---------- running inference ---------- */
let inferSeq = 0;
let inferTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleInfer(immediate = false): void {
  if (inferTimer !== undefined) clearTimeout(inferTimer);
  if (teach.positives.length === 0) {
    inferSeq++;
    teach.result = null;
    teach.selected = -1;
    teach.running = false;
    teach.error = null;
    renderTeach();
    renderHighlightView();
    return;
  }
  inferTimer = setTimeout(() => void doInfer(), immediate ? 0 : DEBOUNCE_MS);
}

async function doInfer(): Promise<void> {
  const mine = ++inferSeq;
  teach.running = true;
  teach.text = state.input;
  renderTeach();
  try {
    const res = await inferRunner.run<InferResult>({
      op: 'infer',
      text: state.input,
      positives: teach.positives,
      negatives: teach.negatives,
      acrossText: state.config.acrossText,
    });
    if (mine !== inferSeq) return;
    teach.result = res;
    teach.selected = res.defaultIndex;
    teach.error = null;
  } catch (e) {
    if (e instanceof StaleError || mine !== inferSeq) return;
    teach.result = null;
    teach.selected = -1;
    teach.error =
      e instanceof TimeoutError
        ? 'Inference took longer than 2 s and was stopped. Try fewer examples or a shorter input.'
        : `Inference failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  teach.running = false;
  renderTeach();
  renderHighlightView();
}

/* ---------- examples ---------- */
const sameSpan = (a: Span, b: Span) => a.start === b.start && a.end === b.end;

function addExample(kind: 'pos' | 'neg'): void {
  const text = state.input;
  let start = inputArea.selectionStart;
  let end = inputArea.selectionEnd;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  // Only auto-open when the panel sits beside the content; on narrow screens it is an overlay.
  if (window.matchMedia('(min-width: 1201px)').matches) openSettings(true);
  teachPanel.open();
  if (start >= end) {
    teach.note = 'Select some text in the input first, then press the button.';
    renderTeach();
    return;
  }
  setExample({ start, end }, kind);
}

function setExample(sp: Span, kind: 'pos' | 'neg'): void {
  teach.positives = teach.positives.filter((s) => !sameSpan(s, sp));
  teach.negatives = teach.negatives.filter((s) => !sameSpan(s, sp));
  (kind === 'pos' ? teach.positives : teach.negatives).push(sp);
  examplesChanged();
}

/**
 * Click on a highlight cycles its example state. Normal spans: neutral -> positive -> negative ->
 * neutral. "Also matched" spans go to negative first, because that is what the user usually wants.
 */
function cycleExample(sp: Span, alsoMatched = false): void {
  const state: 'none' | 'pos' | 'neg' = teach.positives.some((s) => sameSpan(s, sp))
    ? 'pos'
    : teach.negatives.some((s) => sameSpan(s, sp))
      ? 'neg'
      : 'none';
  const order: ('none' | 'pos' | 'neg')[] = alsoMatched ? ['none', 'neg', 'pos'] : ['none', 'pos', 'neg'];
  const next = order[(order.indexOf(state) + 1) % 3];
  if (next === 'none') {
    teach.positives = teach.positives.filter((s) => !sameSpan(s, sp));
    teach.negatives = teach.negatives.filter((s) => !sameSpan(s, sp));
    examplesChanged();
  } else setExample(sp, next);
}

function examplesChanged(): void {
  teach.positives.sort((a, b) => a.start - b.start);
  teach.negatives.sort((a, b) => a.start - b.start);
  teach.note = '';
  teach.text = state.input;
  renderTeach();
  renderHighlightView();
  renderOutput();
  scheduleInfer();
}

/* ---------- rendering ---------- */
function currentText(): string {
  const r = state.result;
  if (!r) return '';
  return formatOutput(r.matches, r.lineCount, state.output);
}

function renderAll(): void {
  renderInputMeta();
  renderStatus();
  renderHighlightView();
  renderOutput();
  panel.setErrors(state.result?.errors ?? []);
}

function renderTeach(): void {
  teach.text = state.input;
  teachPanel.update(teach);
  const c = teach.result && teach.selected >= 0 ? teach.result.candidates[teach.selected] : undefined;
  teachSummary.textContent = teach.note
    ? teach.note
    : c
      ? `Learned ${c.pattern} · ${c.count.toLocaleString()} matches, ${c.also.toLocaleString()} also matched (lighter highlights).`
      : teach.result?.conflict
        ? teach.result.conflict.message
        : '';
}

function renderInputMeta(): void {
  sampleBadge.hidden = !state.isSample;
  const n = state.input.length;
  const lines = n === 0 ? 0 : splitLines(state.input).length;
  inputMeta.textContent = `${n.toLocaleString()} chars · ${lines.toLocaleString()} lines`;
  if (n > MAX_INPUT_CHARS) {
    inputNotice.hidden = false;
    inputNotice.textContent = `Input is ${(n / 1048576).toFixed(1)} MB. The limit is 5 MB, so nothing was processed. Shorten the input.`;
  } else {
    inputNotice.hidden = true;
  }
}

function renderStatus(): void {
  runNotice.hidden = state.error === null;
  runNotice.textContent = state.error ?? '';
  const r = state.result;
  truncNotice.hidden = !(r && r.truncated);
  truncNotice.textContent = r?.truncated ? 'Truncated: the 100,000 match limit was reached. Later matches are not shown.' : '';
  clear(statsBar);
  if (state.running && !r) {
    statsBar.append(h('span', { class: 'muted', text: 'Running…' }));
    return;
  }
  if (!r) return;
  const stats = computeStats(r.matches);
  statsBar.append(h('strong', { text: `${stats.total.toLocaleString()} match${stats.total === 1 ? '' : 'es'}` }));
  const selected = state.output.types;
  for (const [type, count] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
    const on = selected !== null && selected.includes(type);
    statsBar.append(
      h(
        'button',
        {
          class: `small legend-chip ${typeClass(type)}`,
          'aria-pressed': String(on),
          title: on ? `Showing only ${type}. Click to change the filter.` : `Show only ${type}`,
          on: {
            click: () => {
              const cur = new Set(state.output.types ?? []);
              if (cur.has(type)) cur.delete(type);
              else cur.add(type);
              state.output.types = cur.size ? [...cur] : null;
              persistSettings();
              renderStatus();
              renderOutput();
            },
          },
        },
        h('span', { class: `swatch ${typeClass(type)}`, 'aria-hidden': 'true' }),
        `${type} ${count}`,
      ),
    );
  }
  statsBar.append(h('span', { class: 'muted', text: `${r.elapsedMs} ms${state.running ? ' · running…' : ''}` }));
}

type Role = 'pos' | 'neg' | 'also' | 'match';

/** Detector matches + examples + "also matched" spans, resolved so they never overlap. */
function buildDisplay(): { list: Match[]; roles: Role[]; original: Map<string, Match> } {
  const text = state.input;
  const lines = splitLines(text);
  const cands: Candidate[] = [];
  const original = new Map<string, Match>();
  const lineOf = (s: number) => lineAt(lines, s);
  for (const m of state.result?.matches ?? []) {
    original.set(`${m.start}:${m.end}`, m);
    cands.push({ start: m.start, end: m.end, text: m.text, type: m.type, priority: 1000, line: m.line });
  }
  const sel = teach.result && teach.selected >= 0 ? teach.result.candidates[teach.selected] : undefined;
  if (sel) {
    for (const s of sel.alsoSpans) {
      cands.push({ start: s.start, end: s.end, text: text.slice(s.start, s.end), type: '#also', priority: 2000, line: lineOf(s.start) });
    }
  }
  for (const s of teach.negatives) {
    if (s.end <= text.length) cands.push({ start: s.start, end: s.end, text: text.slice(s.start, s.end), type: '#neg', priority: 3000, line: lineOf(s.start) });
  }
  for (const s of teach.positives) {
    if (s.end <= text.length) cands.push({ start: s.start, end: s.end, text: text.slice(s.start, s.end), type: '#pos', priority: 4000, line: lineOf(s.start) });
  }
  const list = resolveOverlaps(cands);
  const roles: Role[] = list.map((m) => (m.type === '#pos' ? 'pos' : m.type === '#neg' ? 'neg' : m.type === '#also' ? 'also' : 'match'));
  return { list, roles, original };
}

function renderHighlightView(): void {
  const { list, roles, original } = buildDisplay();
  const { shown } = renderHighlight(hlView, state.input, list, {
    baseClass: (m, i) => (roles[i] === 'match' ? undefined : original.get(`${m.start}:${m.end}`) ? typeClass(original.get(`${m.start}:${m.end}`)!.type) : 't7'),
    extraClass: (_m, i) => (roles[i] === 'pos' ? 'ex-pos' : roles[i] === 'neg' ? 'ex-neg' : roles[i] === 'also' ? 'also' : ''),
    title: (m, i) => {
      const orig = original.get(`${m.start}:${m.end}`);
      const base = orig ? describeMatch(orig) : `chars ${m.start}–${m.end}`;
      const label =
        roles[i] === 'pos'
          ? 'Positive example'
          : roles[i] === 'neg'
            ? 'Negative example'
            : roles[i] === 'also'
              ? 'Also matched by the learned pattern'
              : '';
      const hint = roles[i] === 'also' ? 'Click to cycle: negative → positive → neutral' : 'Click to cycle: positive → negative → neutral';
      return label ? `${label} · ${base} · ${hint}` : `${base} · ${hint}`;
    },
    onClickMatch: (i) => {
      const m = list[i];
      if (m) cycleExample({ start: m.start, end: m.end }, roles[i] === 'also');
    },
  });
  const total = list.length;
  hlNote.textContent =
    total > HIGHLIGHT_LIMIT
      ? `Highlighting the first ${HIGHLIGHT_LIMIT.toLocaleString()} of ${total.toLocaleString()} spans`
      : shown > 0
        ? 'Hover a highlight for details. Click one to mark it as an example.'
        : '';
}

function renderOutput(): void {
  state.output.format = formatSelect.value as OutputFormat;
  const r = state.result;
  const text = r ? currentText() : '';
  outText.value = text;
  const table = state.output.format === 'table';
  tableWrap.hidden = !table;
  outText.hidden = table;
  if (table) {
    clear(tableWrap);
    const filtered = applyTypeFilter();
    const rows = tableRows(filtered);
    const shown = Math.min(rows.length, TABLE_ROW_LIMIT);
    const head = h('tr', {}, h('th', { scope: 'col', text: 'example' }), ...TABLE_HEADER.map((t) => h('th', { scope: 'col', text: t })));
    const body: HTMLElement[] = [];
    for (let i = 0; i < shown; i++) {
      const m = filtered[i];
      const sp = { start: m.start, end: m.end };
      const role = teach.positives.some((s) => sameSpan(s, sp)) ? 'positive' : teach.negatives.some((s) => sameSpan(s, sp)) ? 'negative' : 'neutral';
      const symbol = role === 'positive' ? '+' : role === 'negative' ? '−' : '·';
      const btn = h('button', {
        class: 'small',
        text: symbol,
        'aria-label': `Example state of ${m.text}: ${role}. Activate to cycle.`,
        on: { click: () => cycleExample(sp) },
      });
      body.push(h('tr', {}, h('td', {}, btn), ...rows[i].map((c) => h('td', { text: c }))));
    }
    tableWrap.append(h('table', {}, h('thead', {}, head), h('tbody', {}, ...body)));
    if (rows.length > shown) {
      tableWrap.append(h('p', { class: 'notice', text: `Showing ${shown} of ${rows.length} rows. Copy and Download include all rows.` }));
    }
  }
  copyBtn.disabled = text === '';
  downloadBtn.disabled = text === '';
}

function applyTypeFilter(): Match[] {
  const t = state.output.types;
  const all = state.result?.matches ?? [];
  return t ? all.filter((m) => t.includes(m.type)) : all;
}

/* ---------- actions ---------- */
function setInput(value: string, sample = false): void {
  state.input = value;
  state.isSample = sample;
  inputArea.value = value;
  clearExamplesForInputChange();
  persistInput();
  renderInputMeta();
  scheduleRun(true);
}

function clearExamplesForInputChange(): void {
  const had = teach.positives.length + teach.negatives.length > 0;
  teach.positives = [];
  teach.negatives = [];
  teach.result = null;
  teach.selected = -1;
  teach.error = null;
  teach.running = false;
  inferSeq++;
  teach.note = had ? 'Examples were cleared because the input changed.' : '';
  renderTeach();
}

function download(filename: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fallbackSelect(): void {
  const wasHidden = outText.hidden;
  outText.hidden = false;
  outText.focus();
  outText.select();
  try {
    document.execCommand('copy');
  } catch {
    /* the user can press Ctrl+C */
  }
  if (wasHidden) outText.hidden = true;
}

copyBtn.addEventListener('click', () => {
  const text = outText.value;
  const done = () => (outStatus.textContent = `Copied ${text.length.toLocaleString()} characters.`);
  const fail = () => {
    fallbackSelect();
    outStatus.textContent = 'Clipboard access was blocked. The text is selected: press Ctrl+C to copy.';
  };
  if (!navigator.clipboard) {
    fail();
    return;
  }
  navigator.clipboard.writeText(text).then(done, fail);
});

function copyToClipboard(text: string, what: string): void {
  const fail = () => {
    teach.note = `Clipboard access was blocked. Select the ${what} text and press Ctrl+C.`;
    renderTeach();
  };
  if (!navigator.clipboard) {
    fail();
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    teach.note = `Copied ${what}.`;
    renderTeach();
  }, fail);
}

downloadBtn.addEventListener('click', () => {
  const ext: Record<OutputFormat, [string, string]> = {
    perline: ['txt', 'text/plain'],
    flat: ['txt', 'text/plain'],
    json: ['json', 'application/json'],
    jsonl: ['jsonl', 'application/x-ndjson'],
    csv: ['csv', 'text/csv'],
    table: ['tsv', 'text/tab-separated-values'],
  };
  const [e, mime] = ext[state.output.format];
  download(`extracted.${e}`, mime, outText.value);
});

formatSelect.addEventListener('change', () => {
  persistSettings();
  renderOutput();
});

inputArea.addEventListener('input', () => {
  state.input = inputArea.value;
  state.isSample = false;
  clearExamplesForInputChange();
  persistInput();
  renderInputMeta();
  scheduleRun();
});

/* ---------- persistence (convenience only) ---------- */
function persistSettings(): void {
  if (!state.rememberSettings) {
    removeStorage(SETTINGS_KEY);
    return;
  }
  writeStorage(SETTINGS_KEY, serializeSettings({ config: state.config, output: state.output }));
}

function persistInput(): void {
  if (state.rememberInput && !state.isSample) writeStorage(INPUT_KEY, state.input);
  else removeStorage(INPUT_KEY);
}

/* ---------- go ---------- */
formatSelect.value = state.output.format;
renderTeach();
renderAll();
scheduleRun(true);
