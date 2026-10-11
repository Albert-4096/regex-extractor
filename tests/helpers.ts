import { defaultConfig, extract } from '../src/core';
import type { CustomRegex, ExtractConfig, Params, RunResult } from '../src/core';

/** Config with only the given detector ids enabled. */
export function only(
  ids: string[],
  params: Record<string, Params> = {},
  extra: Partial<ExtractConfig> = {},
): ExtractConfig {
  const base = defaultConfig();
  return {
    ...base,
    ...extra,
    detectors: base.detectors.map((d) => ({
      id: d.id,
      enabled: ids.includes(d.id),
      params: params[d.id] ?? d.params,
    })),
  };
}

export function run(text: string, ids: string[], params: Record<string, Params> = {}, extra: Partial<ExtractConfig> = {}): RunResult {
  return extract(text, only(ids, params, extra));
}

export function texts(text: string, ids: string[], params: Record<string, Params> = {}): string[] {
  return run(text, ids, params).matches.map((m) => m.text);
}

export function custom(entries: Partial<CustomRegex>[], extra: Partial<ExtractConfig> = {}): ExtractConfig {
  return {
    ...only([], {}, extra),
    custom: entries.map((e, i) => ({
      id: `c${i}`,
      label: `custom${i}`,
      pattern: '',
      flags: '',
      captureMode: 'full' as const,
      ...e,
    })),
  };
}
