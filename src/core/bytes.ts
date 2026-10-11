// Dependency-free base64 / UTF-8 helpers so src/core needs no DOM or Node APIs.

const STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP: Record<string, number> = Object.create(null);
for (let i = 0; i < STD.length; i++) LOOKUP[STD[i]] = i;
LOOKUP['-'] = 62;
LOOKUP['_'] = 63;

/** Decode base64 or base64url (padding optional). Returns null when invalid. */
export function decodeBase64(input: string): number[] | null {
  let s = input;
  let pad = 0;
  while (s.endsWith('=')) {
    s = s.slice(0, -1);
    pad++;
  }
  if (pad > 2) return null;
  if (s.length % 4 === 1) return null;
  if (pad > 0 && (s.length + pad) % 4 !== 0) return null;
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const v = LOOKUP[s[i]];
    if (v === undefined) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
      acc &= (1 << bits) - 1;
    }
  }
  return out;
}

/** Strict UTF-8 decode into code points; null when the bytes are not valid UTF-8. */
export function utf8CodePoints(bytes: number[]): number[] | null {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let need = 0;
    let cp = 0;
    let min = 0;
    if (b < 0x80) {
      out.push(b);
      i++;
      continue;
    } else if (b >= 0xc2 && b <= 0xdf) {
      need = 1;
      cp = b & 0x1f;
      min = 0x80;
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      cp = b & 0x0f;
      min = 0x800;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      cp = b & 0x07;
      min = 0x10000;
    } else return null;
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    out.push(cp);
    i += need + 1;
  }
  return out;
}

const hex2 = (n: number) => '\\x' + (n < 16 ? '0' : '') + n.toString(16);

/** Printable-or-hex-escaped preview of at most `max` characters. */
export function previewBytes(bytes: number[], max = 80): string {
  const cps = utf8CodePoints(bytes);
  const parts: string[] = [];
  let truncated = false;
  const items: { cp: number; raw: boolean }[] = cps
    ? cps.map((cp) => ({ cp, raw: false }))
    : bytes.map((cp) => ({ cp, raw: true }));
  for (const it of items) {
    if (parts.length >= max) {
      truncated = true;
      break;
    }
    const { cp, raw } = it;
    if (cp === 0x0a) parts.push('\\n');
    else if (cp === 0x0d) parts.push('\\r');
    else if (cp === 0x09) parts.push('\\t');
    else if (cp < 0x20 || cp === 0x7f) parts.push(hex2(cp));
    else if (raw && cp > 0x7e) parts.push(hex2(cp));
    else if (!raw && cp >= 0x80 && cp < 0xa0) parts.push('\\u' + cp.toString(16).padStart(4, '0'));
    else parts.push(String.fromCodePoint(cp));
  }
  return parts.join('') + (truncated ? '…' : '');
}

/** Decode to a JS string when the bytes are valid UTF-8, else null. */
export function bytesToString(bytes: number[]): string | null {
  const cps = utf8CodePoints(bytes);
  if (!cps) return null;
  let s = '';
  for (const cp of cps) s += String.fromCodePoint(cp);
  return s;
}
