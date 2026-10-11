import { bytesToString, decodeBase64, previewBytes } from './bytes';
import type { Detector, Params, ParamDef } from './types';

/** Highest priority first. Binary sits above hash/hex on purpose. */
export const DETECTOR_ORDER = [
  'flag', 'jwt', 'url', 'email', 'uuid', 'mac', 'ipv4', 'ipv6', 'binary', 'hash', 'hex',
  'base64', 'iso8601', 'decimal-float', 'decimal-int', 'quoted-string',
] as const;

export const GENERIC_FLAG_PREFIX = '[A-Za-z0-9_]{2,16}';
export const DEFAULT_FLAG_PREFIXES = [
  'flag', 'FLAG', 'ctf', 'CTF', 'htb', 'HTB', 'picoCTF', 'DUCTF', 'ECSC', GENERIC_FLAG_PREFIX,
];

const prio = (id: (typeof DETECTOR_ORDER)[number]) => (DETECTOR_ORDER.length - DETECTOR_ORDER.indexOf(id)) * 10;

function int(v: unknown, def: number, min: number, max = 1_000_000): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.min(max, Math.max(min, n));
}
function bool(v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def;
}
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
}

const minLen = (def: number): ParamDef => ({ key: 'minLength', label: 'Min length', type: 'number', default: def, min: 1 });

/* ---------- validators ---------- */

function isIPv4(s: string): boolean {
  const parts = s.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^(?:0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255);
}

/** Hand-written IPv6 validator (RFC 4291 text forms, incl. :: compression and IPv4 tails). */
export function isValidIPv6(s: string): boolean {
  if (!/^[0-9a-fA-F:.]+$/.test(s)) return false;
  if (s.split(':').length - 1 < 2) return false;
  if (s.includes(':::')) return false;
  const dbl = s.indexOf('::');
  if (dbl !== s.lastIndexOf('::')) return false;
  let head: string[];
  let tail: string[] = [];
  if (dbl >= 0) {
    const l = s.slice(0, dbl);
    const r = s.slice(dbl + 2);
    head = l === '' ? [] : l.split(':');
    tail = r === '' ? [] : r.split(':');
  } else {
    head = s.split(':');
  }
  const groups = [...head, ...tail];
  let count = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const last = i === groups.length - 1;
    if (g.includes('.')) {
      if (!last || (dbl >= 0 && tail.length === 0) || !isIPv4(g)) return false;
      count += 2;
      continue;
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return false;
    count++;
  }
  if (dbl >= 0) return groups.length > 0 && count <= 7;
  return count === 8;
}

function daysIn(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Returns decoded bytes when `s` looks like (and decodes as) real base64/base64url. */
function checkBase64(s: string): number[] | null {
  let body = s;
  let pad = 0;
  while (body.endsWith('=')) {
    body = body.slice(0, -1);
    pad++;
  }
  if (pad > 2 || body.length === 0) return null;
  const hasStd = /[+/]/.test(body);
  const hasUrl = /[-_]/.test(body);
  if (hasStd && hasUrl) return null;
  if (/^\d+$/.test(body)) return null; // plain numbers are not base64
  const signal = /\d/.test(body) || hasStd || pad > 0 || (hasUrl && /[A-Z]/.test(body) && /[a-z]/.test(body));
  if (!signal) return null;
  const len = body.length + pad;
  if (pad > 0 && len % 4 !== 0) return null;
  if (pad === 0 && hasStd && len % 4 !== 0) return null;
  const bytes = decodeBase64(s);
  return bytes && bytes.length > 0 ? bytes : null;
}

function b64urlJson(seg: string): { text: string; value: unknown } | null {
  if (seg.length === 0 || seg.length % 4 === 1) return null;
  const bytes = decodeBase64(seg);
  if (!bytes) return null;
  const text = bytesToString(bytes);
  if (text === null) return null;
  try {
    return { text, value: JSON.parse(text) };
  } catch {
    return null;
  }
}

function trimUrl(u: string): string {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  let s = u;
  for (;;) {
    const last = s[s.length - 1];
    if (last !== undefined && '.,;:!?'.includes(last)) {
      s = s.slice(0, -1);
      continue;
    }
    const open = last === undefined ? undefined : pairs[last];
    if (open) {
      const opens = s.split(open).length - 1;
      const closes = s.split(last).length - 1;
      if (closes > opens) {
        s = s.slice(0, -1);
        continue;
      }
    }
    return s;
  }
}

const HASH_TYPES: Record<number, string> = { 32: 'hash:md5', 40: 'hash:sha1', 64: 'hash:sha256', 128: 'hash:sha512' };

/* ---------- detectors ---------- */

export const DETECTORS: Detector[] = [
  {
    id: 'flag',
    label: 'Flag',
    priority: prio('flag'),
    defaultEnabled: true,
    params: [
      {
        key: 'prefixes',
        label: 'Prefixes',
        type: 'strings',
        default: DEFAULT_FLAG_PREFIXES,
        help: `Literal prefixes; the entry ${GENERIC_FLAG_PREFIX} is treated as a pattern.`,
      },
    ],
    describe: '(?<!\\w)(?:<prefix>|…)\\{[^}\\s]{1,200}\\}',
    build(p) {
      const list = Array.isArray(p.prefixes) ? p.prefixes : DEFAULT_FLAG_PREFIXES;
      const alts = list
        .filter((x): x is string => typeof x === 'string' && x.length > 0)
        .map((x) => (x === GENERIC_FLAG_PREFIX ? x : escapeRegExp(x)));
      const head = alts.length ? alts.join('|') : '(?!)';
      return new RegExp(`(?<!\\w)(?:${head})\\{[^}\\s]{1,200}\\}`);
    },
  },
  {
    id: 'jwt',
    label: 'JWT',
    priority: prio('jwt'),
    defaultEnabled: true,
    params: [],
    describe: '(?<![\\w.-])[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]*(?![\\w-]|\\.[\\w-])  + header must be JSON with "alg"',
    build: () => /(?<![\w.-])[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*(?![\w-]|\.[\w-])/,
    refine(m) {
      const [h, pl] = m[0].split('.');
      const header = b64urlJson(h);
      if (!header || typeof header.value !== 'object' || header.value === null || !('alg' in header.value)) return null;
      const meta: Record<string, string> = { header: header.text.slice(0, 200) };
      const payload = b64urlJson(pl);
      if (payload) meta.payload = payload.text.slice(0, 200);
      else {
        const bytes = pl.length % 4 === 1 ? null : decodeBase64(pl);
        if (bytes) meta.payload = previewBytes(bytes, 200);
      }
      return { text: m[0], offset: 0, meta };
    },
  },
  {
    id: 'url',
    label: 'URL',
    priority: prio('url'),
    defaultEnabled: true,
    params: [],
    describe: '(?<!\\w)(?:https?|ftp|wss?)://[^\\s<>"\'`]+  (trailing .,;:!? and unbalanced )]} trimmed)',
    build: () => /(?<!\w)(?:https?|ftp|wss?):\/\/[^\s<>"'`]+/i,
    refine(m) {
      const t = trimUrl(m[0]);
      const schemeEnd = t.indexOf('://') + 3;
      if (!/^[A-Za-z0-9[]/.test(t.slice(schemeEnd))) return null;
      return { text: t, offset: 0 };
    },
  },
  {
    id: 'email',
    label: 'Email',
    priority: prio('email'),
    defaultEnabled: true,
    params: [],
    describe: '(?<![\\w.%+-])[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\\.)+[A-Za-z]{2,}(?!\\w)',
    build: () => /(?<![\w.%+-])[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?!\w)/,
    validate(m) {
      const local = m[0].slice(0, m[0].indexOf('@'));
      return !local.startsWith('.') && !local.endsWith('.') && !local.includes('..');
    },
  },
  {
    id: 'uuid',
    label: 'UUID',
    priority: prio('uuid'),
    defaultEnabled: true,
    params: [],
    describe: '(?<!\\w)[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?!\\w)',
    build: () => /(?<!\w)[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?!\w)/,
  },
  {
    id: 'mac',
    label: 'MAC address',
    priority: prio('mac'),
    defaultEnabled: true,
    params: [],
    describe: '(?<![\\w:-])[0-9a-fA-F]{2}([:-])(?:[0-9a-fA-F]{2}\\1){4}[0-9a-fA-F]{2}(?!\\w|[:-][0-9a-fA-F])',
    build: () => /(?<![\w:-])[0-9a-fA-F]{2}([:-])(?:[0-9a-fA-F]{2}\1){4}[0-9a-fA-F]{2}(?!\w|[:-][0-9a-fA-F])/,
  },
  {
    id: 'ipv4',
    label: 'IPv4',
    priority: prio('ipv4'),
    defaultEnabled: true,
    params: [],
    describe: '(?<![\\w.])OCT(?:\\.OCT){3}(?!\\w|\\.\\d), OCT = 25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d',
    build() {
      const o = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
      return new RegExp(`(?<![\\w.])${o}(?:\\.${o}){3}(?!\\w|\\.\\d)`);
    },
  },
  {
    id: 'ipv6',
    label: 'IPv6',
    priority: prio('ipv6'),
    defaultEnabled: true,
    params: [],
    describe: '(?<![\\w:.])[0-9a-fA-F:.]{2,}(?![\\w:])  + hand-written validator',
    build: () => /(?<![\w:.])[0-9a-fA-F:.]{2,}(?![\w:])/,
    refine(m) {
      const t = m[0].replace(/\.+$/, '');
      return t.length >= 2 && isValidIPv6(t) ? { text: t, offset: 0 } : null;
    },
  },
  {
    id: 'binary',
    label: 'Binary',
    priority: prio('binary'),
    defaultEnabled: true,
    params: [
      minLen(8),
      { key: 'maxLength', label: 'Max length (0 = none)', type: 'number', default: 0, min: 0 },
      { key: 'multipleOf', label: 'Length multiple of', type: 'number', default: 1, min: 1 },
      { key: 'stripPrefix', label: 'Strip 0b prefix', type: 'boolean', default: false },
    ],
    describe: '(?<!\\w)(?:0[bB])?[01]{N,M}(?!\\w)',
    build(p) {
      const min = int(p.minLength, 8, 1);
      const max = int(p.maxLength, 0, 0);
      const hi = max > 0 ? String(Math.max(max, min)) : '';
      return new RegExp(`(?<!\\w)(?:0[bB])?[01]{${min},${hi}}(?!\\w)`);
    },
    validate(m, p) {
      const mult = int(p.multipleOf, 1, 1);
      const digits = /^0[bB]/.test(m[0]) ? m[0].length - 2 : m[0].length;
      return digits % mult === 0;
    },
    refine(m, p) {
      if (bool(p.stripPrefix, false) && /^0[bB][01]/.test(m[0])) return { text: m[0].slice(2), offset: 2 };
      return { text: m[0], offset: 0 };
    },
  },
  {
    id: 'hash',
    label: 'Hash',
    priority: prio('hash'),
    defaultEnabled: true,
    params: [],
    describe: '(?<!\\w)[0-9a-fA-F]{32|40|64|128}(?!\\w)  → hash:md5 / sha1 / sha256 / sha512',
    build: () =>
      /(?<!\w)(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{64}|[0-9a-fA-F]{40}|[0-9a-fA-F]{32})(?!\w)/,
    refine(m) {
      return { text: m[0], offset: 0, type: HASH_TYPES[m[0].length] };
    },
  },
  {
    id: 'hex',
    label: 'Hex',
    priority: prio('hex'),
    defaultEnabled: true,
    params: [minLen(8), { key: 'stripPrefix', label: 'Strip 0x prefix', type: 'boolean', default: false }],
    describe: '(?<!\\w)(?:0[xX][0-9a-fA-F]{N,}|[0-9a-fA-F]{N,})(?!\\w)  (bare hex needs one a-f letter)',
    build(p) {
      const n = int(p.minLength, 8, 1);
      return new RegExp(`(?<!\\w)(?:0[xX][0-9a-fA-F]{${n},}|[0-9a-fA-F]{${n},})(?!\\w)`);
    },
    validate(m) {
      return /^0[xX]/.test(m[0]) || /[a-fA-F]/.test(m[0]);
    },
    refine(m, p) {
      if (bool(p.stripPrefix, false) && /^0[xX]/.test(m[0])) return { text: m[0].slice(2), offset: 2 };
      return { text: m[0], offset: 0 };
    },
  },
  {
    id: 'base64',
    label: 'Base64 / base64url',
    priority: prio('base64'),
    defaultEnabled: true,
    params: [minLen(16)],
    describe: '(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{N,}={0,2}(?![A-Za-z0-9+/_=-])  + padding + decode checks',
    build(p) {
      const n = int(p.minLength, 16, 1);
      return new RegExp(`(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{${n},}={0,2}(?![A-Za-z0-9+/_=-])`);
    },
    refine(m) {
      const bytes = checkBase64(m[0]);
      if (!bytes) return null;
      return { text: m[0], offset: 0, meta: { decoded: previewBytes(bytes, 80) } };
    },
  },
  {
    id: 'iso8601',
    label: 'ISO 8601 date/time',
    priority: prio('iso8601'),
    defaultEnabled: false,
    params: [],
    describe: '(?<!\\w)\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}(?::\\d{2}(?:[.,]\\d+)?)?(?:Z|[+-]\\d{2}(?::?\\d{2})?)?)?(?!\\w)',
    build: () =>
      /(?<!\w)(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?(?!\w)/,
    validate(m) {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return false;
      if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59)) return false;
      if (m[6] !== undefined && Number(m[6]) > 60) return false;
      return true;
    },
  },
  {
    id: 'decimal-float',
    label: 'Decimal float',
    priority: prio('decimal-float'),
    defaultEnabled: false,
    params: [],
    describe: '(?<![\\w.])[+-]?(?:\\d+\\.\\d+|\\.\\d+)(?:[eE][+-]?\\d+)?(?!\\w|\\.\\d)',
    build: () => /(?<![\w.])[+-]?(?:\d+\.\d+|\.\d+)(?:[eE][+-]?\d+)?(?!\w|\.\d)/,
  },
  {
    id: 'decimal-int',
    label: 'Decimal integer',
    priority: prio('decimal-int'),
    defaultEnabled: false,
    params: [],
    describe: '(?<![\\w.])[+-]?\\d+(?!\\w|\\.\\d)',
    build: () => /(?<![\w.])[+-]?\d+(?!\w|\.\d)/,
  },
  {
    id: 'quoted-string',
    label: 'Quoted string',
    priority: prio('quoted-string'),
    defaultEnabled: false,
    params: [],
    describe: `(["'])((?:\\\\.|(?!\\1)[^\\\\\\r\\n])*)\\1  → content without the quotes`,
    build: () => /(["'])((?:\\.|(?!\1)[^\\\r\n])*)\1/,
    refine(m) {
      return m[2].length > 0 ? { text: m[2], offset: 1 } : null;
    },
  },
];

const BY_ID: Record<string, Detector> = Object.create(null);
for (const d of DETECTORS) BY_ID[d.id] = d;

export function getDetector(id: string): Detector | undefined {
  return BY_ID[id];
}

export function defaultParams(d: Detector): Params {
  const out: Params = {};
  for (const p of d.params) out[p.key] = Array.isArray(p.default) ? [...p.default] : p.default;
  return out;
}
