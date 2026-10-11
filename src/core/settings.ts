import { DETECTORS, defaultParams } from './detectors';
import { defaultFormatOptions } from './format';
import type { FormatOptions, OutputFormat } from './format';
import { defaultConfig } from './run';
import type { CaptureMode, CustomRegex, DetectorSetting, ExtractConfig, Params } from './types';

export const SETTINGS_SCHEMA = 'regex-extractor-settings';
export const SETTINGS_VERSION = 1;

export interface Settings {
  config: ExtractConfig;
  output: FormatOptions;
}

export type ParseResult = { ok: true; settings: Settings; warnings: string[] } | { ok: false; error: string };

const FORMATS: OutputFormat[] = ['perline', 'flat', 'json', 'jsonl', 'csv', 'table'];
const MAX_CUSTOM = 50;
const MAX_PATTERN = 10_000;

export function serializeSettings(s: Settings): string {
  return JSON.stringify(
    {
      schema: SETTINGS_SCHEMA,
      version: SETTINGS_VERSION,
      config: {
        acrossText: s.config.acrossText,
        detectors: s.config.detectors.map((d) => ({ id: d.id, enabled: d.enabled, params: d.params })),
        custom: s.config.custom.map((c) => ({
          label: c.label,
          pattern: c.pattern,
          flags: c.flags,
          captureMode: c.captureMode,
        })),
      },
      output: s.output,
    },
    null,
    2,
  );
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Own-property read: never walks the prototype chain. */
const own = (o: Obj, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const str = (v: unknown, def: string, max = 200): string => (typeof v === 'string' && v.length <= max ? v : def);
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);

function pickParams(raw: unknown, id: string): Params {
  const det = DETECTORS.find((d) => d.id === id)!;
  const out: Params = Object.create(null);
  const defaults = defaultParams(det);
  const src = isObj(raw) ? raw : (Object.create(null) as Obj);
  for (const def of det.params) {
    const v = own(src, def.key);
    if (def.type === 'number') {
      const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : (defaults[def.key] as number);
      out[def.key] = Math.min(def.max ?? 1_000_000, Math.max(def.min ?? 0, n));
    } else if (def.type === 'boolean') {
      out[def.key] = bool(v, defaults[def.key] as boolean);
    } else {
      const ok = Array.isArray(v) && v.length <= 100 && v.every((x) => typeof x === 'string' && x.length <= 64);
      out[def.key] = ok ? (v as string[]).slice() : (defaults[def.key] as string[]);
    }
  }
  return { ...out };
}

export function parseSettings(json: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'File is not valid JSON.' };
  }
  if (!isObj(raw)) return { ok: false, error: 'Settings must be a JSON object.' };
  if (own(raw, 'schema') !== SETTINGS_SCHEMA) return { ok: false, error: `Not a ${SETTINGS_SCHEMA} file.` };
  if (own(raw, 'version') !== SETTINGS_VERSION) {
    return { ok: false, error: `Unsupported settings version (expected ${SETTINGS_VERSION}).` };
  }
  const warnings: string[] = [];
  const defaults = defaultConfig();

  const cfgRaw = own(raw, 'config');
  const cfgObj = isObj(cfgRaw) ? cfgRaw : (Object.create(null) as Obj);

  // Detectors: explicit field picking, in the canonical order, defaults for anything missing.
  const detRaw = own(cfgObj, 'detectors');
  const seen: Record<string, Obj> = Object.create(null);
  if (Array.isArray(detRaw)) {
    for (const item of detRaw) {
      if (!isObj(item)) continue;
      const id = own(item, 'id');
      if (typeof id !== 'string') continue;
      if (!DETECTORS.some((d) => d.id === id)) {
        warnings.push(`Ignored unknown detector "${id.slice(0, 40)}".`);
        continue;
      }
      seen[id] = item;
    }
  }
  const detectors: DetectorSetting[] = defaults.detectors.map((d) => {
    const item = seen[d.id];
    if (!item) return d;
    return {
      id: d.id,
      enabled: bool(own(item, 'enabled'), d.enabled),
      params: pickParams(own(item, 'params'), d.id),
    };
  });

  const customRaw = own(cfgObj, 'custom');
  const custom: CustomRegex[] = [];
  if (Array.isArray(customRaw)) {
    for (const item of customRaw.slice(0, MAX_CUSTOM)) {
      if (!isObj(item)) continue;
      const modes: CaptureMode[] = ['full', 'group1', 'named'];
      const mode = own(item, 'captureMode');
      const flagsRaw = str(own(item, 'flags'), '', 8);
      custom.push({
        id: `imp${custom.length}`,
        label: str(own(item, 'label'), `custom ${custom.length + 1}`, 100),
        pattern: str(own(item, 'pattern'), '', MAX_PATTERN),
        flags: [...new Set(flagsRaw.split(''))].filter((f) => 'imsu'.includes(f)).join(''),
        captureMode: modes.includes(mode as CaptureMode) ? (mode as CaptureMode) : 'full',
      });
    }
    if (customRaw.length > MAX_CUSTOM) warnings.push(`Only the first ${MAX_CUSTOM} custom regexes were imported.`);
  }

  const outRaw = own(raw, 'output');
  const o = isObj(outRaw) ? outRaw : (Object.create(null) as Obj);
  const od = defaultFormatOptions();
  const fmt = own(o, 'format');
  const quote = own(o, 'quote');
  const scope = own(o, 'uniqueScope');
  const typesRaw = own(o, 'types');
  const output: FormatOptions = {
    format: FORMATS.includes(fmt as OutputFormat) ? (fmt as OutputFormat) : od.format,
    separator: str(own(o, 'separator'), od.separator, 100),
    keepEmptyLines: bool(own(o, 'keepEmptyLines'), od.keepEmptyLines),
    unique: bool(own(o, 'unique'), od.unique),
    uniqueScope: scope === 'line' || scope === 'global' ? scope : od.uniqueScope,
    types:
      Array.isArray(typesRaw) && typesRaw.every((t) => typeof t === 'string' && t.length <= 100)
        ? (typesRaw as string[]).slice(0, 200)
        : null,
    quote: quote === 'single' || quote === 'double' || quote === 'none' ? quote : od.quote,
    prefix: str(own(o, 'prefix'), od.prefix, 100),
    suffix: str(own(o, 'suffix'), od.suffix, 100),
  };

  return {
    ok: true,
    warnings,
    settings: {
      config: { detectors, custom, acrossText: bool(own(cfgObj, 'acrossText'), defaults.acrossText) },
      output,
    },
  };
}
