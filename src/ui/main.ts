import './styles.css';
import { MAX_INPUT_CHARS, computeStats, formatOutput, parseSettings, serializeSettings, tableRows, TABLE_HEADER } from '../core';
import type { OutputFormat, RunResult } from '../core';
import { createRunner, StaleError, TimeoutError } from '../worker/client';
import { clear, h } from './dom';
import { typeClass } from './colors';
import { renderHighlight, HIGHLIGHT_LIMIT } from './highlight';
import { SettingsPanel } from './panel';
import { SAMPLE_INPUT, initialState } from './state';
import { readStorage, removeStorage, writeStorage } from './storage';

const SETTINGS_KEY = 'regex-extractor:settings:v1';
const INPUT_KEY = 'regex-extractor:input:v1';
const DEBOUNCE_MS = 150;
const TABLE_ROW_LIMIT = 2000;

const state = initialState();
const runner = createRunner();

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

const panel = new SettingsPanel(state, {
  onConfigChange: () => {
    persistSettings();
    scheduleRun();
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
});

const settingsToggle = h('button', {
  text: 'Settings',
  'aria-expanded': 'false',
  'aria-controls': 'settings',
  on: {
    click: () => {
      const open = panel.el.hidden;
      panel.el.hidden = !open;
      settingsToggle.setAttribute('aria-expanded', String(open));
      layout.classList.toggle('settings-open', open);
    },
  },
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
    inputNotice,
  ),
  h(
    'section',
    { class: 'pane', 'aria-labelledby': 'hl-h' },
    h('div', { class: 'pane-head' }, h('h2', { id: 'hl-h', text: 'Highlighted view' }), hlNote),
    hlView,
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
const app = document.getElementById('app')!;
app.append(
  h('div', { class: 'app' }, h(
    'header',
    { class: 'topbar' },
    h('h1', { text: 'regex-extractor' }),
    h('span', { class: 'tag', text: 'paste text, get the values · runs 100% in your browser' }),
    h('span', { class: 'spacer' }),
    settingsToggle,
  ), layout),
);

/* ---------- running ---------- */
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

/* ---------- rendering ---------- */
function visibleMatches() {
  return state.result?.matches ?? [];
}

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

function renderInputMeta(): void {
  sampleBadge.hidden = !state.isSample;
  const n = state.input.length;
  const lines = n === 0 ? 0 : state.input.split(/\r\n|\n|\r/).length;
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

function renderHighlightView(): void {
  const r = state.result;
  const matches = r ? r.matches : [];
  const { shown } = renderHighlight(hlView, state.input, matches);
  hlNote.textContent =
    matches.length > HIGHLIGHT_LIMIT
      ? `Highlighting the first ${HIGHLIGHT_LIMIT.toLocaleString()} of ${matches.length.toLocaleString()} matches`
      : shown > 0
        ? 'Hover a highlight for type, offsets, alternatives'
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
    const rows = tableRows(applyTypeFilter());
    const shown = rows.slice(0, TABLE_ROW_LIMIT);
    const head = h('tr', {}, ...TABLE_HEADER.map((t) => h('th', { scope: 'col', text: t })));
    const body = shown.map((row) => h('tr', {}, ...row.map((c) => h('td', { text: c }))));
    tableWrap.append(h('table', {}, h('thead', {}, head), h('tbody', {}, ...body)));
    if (rows.length > shown.length) {
      tableWrap.append(h('p', { class: 'notice', text: `Showing ${shown.length} of ${rows.length} rows. Copy and Download include all rows.` }));
    }
  }
  copyBtn.disabled = text === '';
  downloadBtn.disabled = text === '';
}

function applyTypeFilter() {
  const t = state.output.types;
  const all = visibleMatches();
  return t ? all.filter((m) => t.includes(m.type)) : all;
}

/* ---------- actions ---------- */
function setInput(value: string, sample = false): void {
  state.input = value;
  state.isSample = sample;
  inputArea.value = value;
  persistInput();
  renderInputMeta();
  scheduleRun(true);
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
renderAll();
scheduleRun(true);
