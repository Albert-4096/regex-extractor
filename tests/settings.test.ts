import { describe, expect, it } from 'vitest';
import { defaultConfig, defaultFormatOptions, parseSettings, serializeSettings } from '../src/core';

const base = () => ({ config: defaultConfig(), output: defaultFormatOptions() });

describe('settings export/import', () => {
  it('round-trips', () => {
    const s = base();
    s.config.custom.push({ id: 'x', label: 'mine', pattern: '(?<a>\\d+)', flags: 'i', captureMode: 'named' });
    s.config.detectors.find((d) => d.id === 'binary')!.params = { minLength: 12, maxLength: 0, multipleOf: 8, stripPrefix: true };
    s.output.separator = '\\t';
    s.output.format = 'csv';
    const r = parseSettings(serializeSettings(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.settings.output.separator).toBe('\\t');
    expect(r.settings.output.format).toBe('csv');
    expect(r.settings.config.custom[0]).toMatchObject({ label: 'mine', pattern: '(?<a>\\d+)', flags: 'i', captureMode: 'named' });
    expect(r.settings.config.detectors.find((d) => d.id === 'binary')!.params.multipleOf).toBe(8);
  });
  it('carries a schema name and version', () => {
    const j = JSON.parse(serializeSettings(base()));
    expect(j.schema).toBe('regex-extractor-settings');
    expect(j.version).toBe(1);
  });
  it('rejects wrong schema, wrong version, and non-JSON', () => {
    expect(parseSettings('nope').ok).toBe(false);
    expect(parseSettings('[]').ok).toBe(false);
    expect(parseSettings(JSON.stringify({ schema: 'other', version: 1 })).ok).toBe(false);
    expect(parseSettings(JSON.stringify({ schema: 'regex-extractor-settings', version: 99 })).ok).toBe(false);
  });
  it('is immune to prototype pollution and ignores unknown fields', () => {
    const evil =
      '{"schema":"regex-extractor-settings","version":1,"__proto__":{"polluted":true},' +
      '"config":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},' +
      '"detectors":[{"id":"binary","enabled":true,"params":{"__proto__":{"polluted":true},"minLength":9,"evil":1}}],' +
      '"custom":[{"label":"a","pattern":"b","flags":"gy","captureMode":"full","__proto__":{"polluted":true}}]}}';
    const r = parseSettings(evil);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bin = r.settings.config.detectors.find((d) => d.id === 'binary')!;
    expect(bin.params.minLength).toBe(9);
    expect('evil' in bin.params).toBe(false);
    expect(r.settings.config.custom[0].flags).toBe('');
    expect((r.settings.config as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('validates and clamps field types', () => {
    const r = parseSettings(
      JSON.stringify({
        schema: 'regex-extractor-settings',
        version: 1,
        config: { detectors: [{ id: 'binary', enabled: 'yes', params: { minLength: 'abc' } }], custom: [{ label: 5, pattern: 'x' }] },
        output: { format: 'nonsense', separator: 5 },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bin = r.settings.config.detectors.find((d) => d.id === 'binary')!;
    expect(bin.enabled).toBe(true); // falls back to the default
    expect(bin.params.minLength).toBe(8);
    expect(r.settings.output.format).toBe('perline');
    expect(r.settings.output.separator).toBe(', ');
    expect(r.settings.config.custom[0].label).toBe('custom 1');
  });
});
