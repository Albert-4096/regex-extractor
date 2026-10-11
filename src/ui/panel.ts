import { DETECTORS, defaultConfig, defaultFormatOptions, defaultParams, parseSettings, serializeSettings } from '../core';
import type { CaptureMode, CustomError, CustomRegex, Detector, ParamDef } from '../core';
import { clear, h, uid } from './dom';
import { typeClass } from './colors';
import type { AppState } from './state';

export interface PanelHooks {
  /** Detector / custom / matching settings changed: re-run extraction. */
  onConfigChange(): void;
  /** Output formatting changed: re-render only. */
  onOutputChange(): void;
  /** Persistence checkboxes changed. */
  onPersistChange(): void;
  /** Settings were replaced wholesale (import / reset). */
  onReplaced(): void;
  download(filename: string, mime: string, text: string): void;
  /** Builds the "copy as" snippet list for a pattern (lazy, on expand). */
  snippets(pattern: string, flags: string): HTMLElement;
}

/** Extra sections (e.g. teach-by-example) mounted by the app at the top of the panel. */
export interface PanelExtras {
  sections: HTMLElement[];
}

export class SettingsPanel {
  readonly el: HTMLElement;
  private customList = h('div', { class: 'body' });
  private errorNodes = new Map<string, HTMLElement>();
  private status = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });
  private nextCustom = 1;

  constructor(
    private readonly state: AppState,
    private readonly hooks: PanelHooks,
    private readonly extras: PanelExtras = { sections: [] },
  ) {
    this.el = h('aside', { class: 'settings', id: 'settings', 'aria-label': 'Settings', hidden: true });
    this.build();
  }

  /** Rebuild everything from state (after import / reset). */
  build(): void {
    clear(this.el);
    this.errorNodes.clear();
    for (const s of this.extras.sections) this.el.append(s);
    this.el.append(
      this.detectorsSection(),
      this.customSection(),
      this.matchingSection(),
      this.outputSection(),
      this.dataSection(),
    );
  }

  setErrors(errors: CustomError[]): void {
    for (const node of this.errorNodes.values()) {
      node.textContent = '';
      node.hidden = true;
    }
    for (const e of errors) {
      const node = this.errorNodes.get(e.id);
      if (node) {
        node.textContent = e.message;
        node.hidden = false;
      }
    }
  }

  rebuildCustom(): void {
    this.fillCustom();
  }

  /* ---------- detectors ---------- */

  private detectorsSection(): HTMLElement {
    const body = h('div', { class: 'body' });
    for (const det of DETECTORS) body.append(this.detectorRow(det));
    return h('details', { open: true }, h('summary', { text: 'Built-in detectors' }), body);
  }

  private detectorRow(det: Detector): HTMLElement {
    const setting = this.state.config.detectors.find((d) => d.id === det.id)!;
    const cbId = uid('det');
    const cb = h('input', {
      type: 'checkbox',
      id: cbId,
      checked: setting.enabled,
      on: {
        change: () => {
          setting.enabled = cb.checked;
          this.hooks.onConfigChange();
        },
      },
    });
    const head = h(
      'div',
      { class: 'det-head' },
      h('span', { class: `swatch ${typeClass(det.id)}`, 'aria-hidden': 'true' }),
      cb,
      h('label', { for: cbId, text: det.label, title: det.describe }),
      h('code', { class: 'muted', text: det.id }),
    );
    const row = h('div', { class: 'det' }, head);
    if (det.params.length) {
      const params = h('div', { class: 'det-params' });
      const defaults = defaultParams(det);
      for (const def of det.params) params.append(this.paramInput(det, def, setting.params, defaults));
      row.append(params);
    }
    return row;
  }

  private paramInput(det: Detector, def: ParamDef, params: Record<string, unknown>, defaults: Record<string, unknown>): HTMLElement {
    const id = uid(`p-${det.id}-${def.key}`);
    const cur = params[def.key] ?? defaults[def.key];
    const changed = () => this.hooks.onConfigChange();
    if (def.type === 'boolean') {
      const input = h('input', {
        type: 'checkbox',
        id,
        checked: Boolean(cur),
        on: {
          change: () => {
            params[def.key] = input.checked;
            changed();
          },
        },
      });
      return h('label', { for: id }, input, def.label);
    }
    if (def.type === 'number') {
      const input = h('input', {
        type: 'number',
        id,
        min: def.min ?? 0,
        step: 1,
        value: String(cur),
        on: {
          input: () => {
            const n = Math.floor(Number(input.value));
            if (input.value !== '' && Number.isFinite(n)) {
              params[def.key] = Math.max(def.min ?? 0, n);
              changed();
            }
          },
        },
      });
      return h('div', { class: 'field' }, h('label', { for: id, text: def.label }), input);
    }
    const area = h('textarea', {
      id,
      rows: 3,
      spellcheck: false,
      value: (Array.isArray(cur) ? cur : []).join('\n'),
      'aria-describedby': `${id}-help`,
      on: {
        input: () => {
          params[def.key] = area.value.split('\n').map((s) => s.trim()).filter(Boolean);
          changed();
        },
      },
    });
    return h(
      'div',
      { class: 'field' },
      h('label', { for: id, text: `${def.label} (one per line)` }),
      area,
      h('span', { id: `${id}-help`, text: def.help ?? '' }),
    );
  }

  /* ---------- custom regexes ---------- */

  private customSection(): HTMLElement {
    this.fillCustom();
    const add = h('button', {
      text: 'Add regex',
      on: {
        click: () => {
          this.addCustom({ label: `custom ${this.state.config.custom.length + 1}`, pattern: '', flags: '', captureMode: 'full' });
        },
      },
    });
    return h(
      'details',
      { open: true },
      h('summary', { text: 'Custom regexes' }),
      this.customList,
      h('div', { class: 'row' }, add),
      h('p', {
        class: 'muted',
        text: 'JavaScript RegExp syntax. Custom matches outrank built-ins; earlier entries outrank later ones.',
      }),
    );
  }

  /** Append a custom regex (also used by "Adopt" in teach-by-example). */
  addCustom(entry: Omit<CustomRegex, 'id'>): void {
    this.state.config.custom.push({ ...entry, id: `c${Date.now().toString(36)}${this.nextCustom++}` });
    this.fillCustom();
    this.hooks.onConfigChange();
  }

  private fillCustom(): void {
    clear(this.customList);
    const list = this.state.config.custom;
    if (list.length === 0) {
      this.customList.append(h('p', { class: 'muted', text: 'No custom regexes yet.' }));
      return;
    }
    list.forEach((entry, i) => this.customList.append(this.customRow(entry, i, list.length)));
  }

  private customRow(entry: CustomRegex, index: number, total: number): HTMLElement {
    const base = uid('cx');
    const label = h('input', {
      type: 'text',
      id: `${base}-label`,
      value: entry.label,
      on: {
        input: () => {
          entry.label = label.value;
          this.hooks.onConfigChange();
        },
      },
    });
    const pattern = h('input', {
      type: 'text',
      id: `${base}-pattern`,
      value: entry.pattern,
      spellcheck: false,
      autocomplete: 'off',
      placeholder: '(?<a>[01]{8}) -> .* -> (?<b>[01]{8})',
      on: {
        input: () => {
          entry.pattern = pattern.value;
          this.hooks.onConfigChange();
        },
      },
    });
    const flags = h('div', { class: 'row' });
    for (const f of ['i', 'm', 's', 'u']) {
      const fid = `${base}-f-${f}`;
      const cb = h('input', {
        type: 'checkbox',
        id: fid,
        checked: entry.flags.includes(f),
        on: {
          change: () => {
            const set = new Set(entry.flags.split('').filter(Boolean));
            if (cb.checked) set.add(f);
            else set.delete(f);
            entry.flags = ['i', 'm', 's', 'u'].filter((x) => set.has(x)).join('');
            this.hooks.onConfigChange();
          },
        },
      });
      flags.append(h('label', { for: fid, class: 'mono' }, cb, f));
    }
    const mode = h(
      'select',
      {
        id: `${base}-mode`,
        on: {
          change: () => {
            entry.captureMode = mode.value as CaptureMode;
            this.hooks.onConfigChange();
          },
        },
      },
      h('option', { value: 'full', text: 'Whole match' }),
      h('option', { value: 'group1', text: 'Group 1' }),
      h('option', { value: 'named', text: 'Named groups' }),
    );
    mode.value = entry.captureMode;
    const err = h('p', { class: 'field-error', role: 'alert', hidden: true });
    this.errorNodes.set(entry.id, err);
    const move = (delta: number) => () => {
      const to = index + delta;
      const list = this.state.config.custom;
      if (to < 0 || to >= list.length) return;
      [list[index], list[to]] = [list[to], list[index]];
      this.fillCustom();
      this.hooks.onConfigChange();
    };
    const remove = () => {
      this.state.config.custom.splice(index, 1);
      this.errorNodes.delete(entry.id);
      this.fillCustom();
      this.hooks.onConfigChange();
    };
    const copyAs = h('details', {}, h('summary', { text: 'Copy as…' }));
    copyAs.addEventListener('toggle', () => {
      if (!copyAs.open) return;
      while (copyAs.children.length > 1) copyAs.lastElementChild?.remove();
      if (entry.pattern !== '') copyAs.append(this.hooks.snippets(entry.pattern, entry.flags));
    });
    return h(
      'div',
      { class: 'custom-entry' },
      h('div', { class: 'field' }, h('label', { for: `${base}-label`, text: 'Label' }), label),
      h('div', { class: 'field' }, h('label', { for: `${base}-pattern`, text: 'Pattern' }), pattern),
      h(
        'div',
        { class: 'row' },
        flags,
        h('label', { for: `${base}-mode`, class: 'muted', text: 'Capture' }),
        mode,
        h('span', { class: 'spacer' }),
        h('button', { class: 'small', text: '↑', 'aria-label': 'Move up', disabled: index === 0, on: { click: move(-1) } }),
        h('button', { class: 'small', text: '↓', 'aria-label': 'Move down', disabled: index === total - 1, on: { click: move(1) } }),
        h('button', { class: 'small', text: 'Remove', on: { click: remove } }),
      ),
      err,
      copyAs,
    );
  }

  /* ---------- matching / output / data ---------- */

  private matchingSection(): HTMLElement {
    const id = uid('across');
    const cb = h('input', {
      type: 'checkbox',
      id,
      checked: this.state.config.acrossText,
      on: {
        change: () => {
          this.state.config.acrossText = cb.checked;
          this.hooks.onConfigChange();
        },
      },
    });
    return h(
      'details',
      { open: true },
      h('summary', { text: 'Matching' }),
      h(
        'div',
        { class: 'body' },
        h('label', { for: id }, cb, 'Match across the whole text'),
        h('p', { class: 'muted', text: 'Off: each line is matched on its own, so ^ and $ are per line.' }),
      ),
    );
  }

  private outputSection(): HTMLElement {
    const o = this.state.output;
    const change = () => this.hooks.onOutputChange();
    const sepId = uid('sep');
    const sep = h('input', {
      type: 'text',
      id: sepId,
      value: o.separator,
      spellcheck: false,
      on: {
        input: () => {
          o.separator = sep.value;
          change();
        },
      },
    });
    const keepId = uid('keep');
    const keep = h('input', {
      type: 'checkbox',
      id: keepId,
      checked: o.keepEmptyLines,
      on: {
        change: () => {
          o.keepEmptyLines = keep.checked;
          change();
        },
      },
    });
    const uniqId = uid('uniq');
    const uniq = h('input', {
      type: 'checkbox',
      id: uniqId,
      checked: o.unique,
      on: {
        change: () => {
          o.unique = uniq.checked;
          change();
        },
      },
    });
    const scopeId = uid('scope');
    const scope = h(
      'select',
      {
        id: scopeId,
        on: {
          change: () => {
            o.uniqueScope = scope.value as 'line' | 'global';
            change();
          },
        },
      },
      h('option', { value: 'global', text: 'across all lines' }),
      h('option', { value: 'line', text: 'within each line' }),
    );
    scope.value = o.uniqueScope;
    const quoteId = uid('quote');
    const quote = h(
      'select',
      {
        id: quoteId,
        on: {
          change: () => {
            o.quote = quote.value as 'none' | 'single' | 'double';
            change();
          },
        },
      },
      h('option', { value: 'none', text: 'none' }),
      h('option', { value: 'single', text: "single ' '" }),
      h('option', { value: 'double', text: 'double " "' }),
    );
    quote.value = o.quote;
    const preId = uid('prefix');
    const pre = h('input', {
      type: 'text',
      id: preId,
      value: o.prefix,
      on: {
        input: () => {
          o.prefix = pre.value;
          change();
        },
      },
    });
    const sufId = uid('suffix');
    const suf = h('input', {
      type: 'text',
      id: sufId,
      value: o.suffix,
      on: {
        input: () => {
          o.suffix = suf.value;
          change();
        },
      },
    });
    return h(
      'details',
      { open: true },
      h('summary', { text: 'Output options' }),
      h(
        'div',
        { class: 'body' },
        h('div', { class: 'field' }, h('label', { for: sepId, text: 'Separator (per-line format; \\t and \\n allowed)' }), sep),
        h('label', { for: keepId }, keep, 'Keep empty lines'),
        h('div', { class: 'row' }, h('label', { for: uniqId }, uniq, 'Unique values'), scope),
        h('div', { class: 'row' }, h('label', { for: quoteId, class: 'muted', text: 'Quote' }), quote),
        h(
          'div',
          { class: 'row' },
          h('div', { class: 'field' }, h('label', { for: preId, text: 'Prefix' }), pre),
          h('div', { class: 'field' }, h('label', { for: sufId, text: 'Suffix' }), suf),
        ),
        h('p', { class: 'muted', text: 'Quote, prefix and suffix apply to the per-line and flat formats.' }),
      ),
    );
  }

  private dataSection(): HTMLElement {
    const fileId = uid('import');
    const file = h('input', {
      type: 'file',
      id: fileId,
      accept: 'application/json,.json',
      class: 'sr-only',
      on: {
        change: () => {
          const f = file.files?.[0];
          if (!f) return;
          void f.text().then((txt) => {
            const res = parseSettings(txt);
            if (!res.ok) {
              this.status.textContent = `Import failed: ${res.error}`;
            } else {
              this.state.config = res.settings.config;
              this.state.output = res.settings.output;
              this.status.textContent = res.warnings.length ? `Imported. ${res.warnings.join(' ')}` : 'Settings imported.';
              this.hooks.onReplaced();
            }
            file.value = '';
          });
        },
      },
    });
    const rememberS = h('input', {
      type: 'checkbox',
      id: uid('remS'),
      checked: this.state.rememberSettings,
      on: {
        change: () => {
          this.state.rememberSettings = rememberS.checked;
          this.hooks.onPersistChange();
        },
      },
    });
    const rememberI = h('input', {
      type: 'checkbox',
      id: uid('remI'),
      checked: this.state.rememberInput,
      on: {
        change: () => {
          this.state.rememberInput = rememberI.checked;
          this.hooks.onPersistChange();
        },
      },
    });
    return h(
      'details',
      { open: true },
      h('summary', { text: 'Settings file' }),
      h(
        'div',
        { class: 'body' },
        h(
          'div',
          { class: 'row' },
          h('button', {
            text: 'Export settings',
            on: {
              click: () =>
                this.hooks.download(
                  'regex-extractor-settings.json',
                  'application/json',
                  serializeSettings({ config: this.state.config, output: this.state.output }),
                ),
            },
          }),
          h('button', { text: 'Import settings…', on: { click: () => file.click() } }),
          h('button', {
            text: 'Reset to defaults',
            on: {
              click: () => {
                this.state.config = defaultConfig();
                this.state.output = defaultFormatOptions();
                this.status.textContent = 'Settings reset.';
                this.hooks.onReplaced();
              },
            },
          }),
        ),
        file,
        h('label', { for: rememberS.id }, rememberS, 'Remember settings in this browser'),
        h('label', { for: rememberI.id }, rememberI, 'Remember the last input (off by default)'),
        this.status,
      ),
    );
  }
}
