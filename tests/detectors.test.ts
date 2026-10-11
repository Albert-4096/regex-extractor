import { describe, expect, it } from 'vitest';
import { run, texts } from './helpers';
import { DETECTORS } from '../src/core';

const toBytes = (b: Uint8Array | number[] | string): number[] =>
  typeof b === 'string' ? Array.from(new TextEncoder().encode(b)) : Array.from(b);
const b64 = (b: Uint8Array | number[] | string) => btoa(String.fromCharCode(...toBytes(b)));
const b64url = (b: Uint8Array | number[] | string) => b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (header: object, payload: object, sig = 'c2lnbmF0dXJl') =>
  `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}.${sig}`;
const MD5 = 'd41d8cd98f00b204e9800998ecf8427e';
const SHA1 = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';
const SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const SHA512 = 'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e';

type Case = { id: string; params?: Record<string, never> | Record<string, unknown>; pos: [string, string[]][]; neg: string[] };

const BIG_B64 = b64('The quick brown fox jumps over');
const URLSAFE = b64url(new Uint8Array([0xfb, 0xff, 0xfe, 0xfa, 0xfb, 0xef, 0xbf, 0xbe, 0xff, 0xee, 0xdd, 0xcc]));

const corpora: Case[] = [
  {
    id: 'binary',
    pos: [
      ['01110101', ['01110101']],
      ['a 10101010 b', ['10101010']],
      ["('01101110', '10110100')", ['01101110', '10110100']],
      ['0b10101010', ['0b10101010']],
      ['1010101011110000', ['1010101011110000']],
    ],
    neg: ['0', 'Circuit[0]', 'x01110101', '0111010', '01110102', '0111-0101'],
  },
  {
    id: 'hex',
    pos: [
      ['deadbeef', ['deadbeef']],
      ['0xDEADBEEF', ['0xDEADBEEF']],
      ['id=CAFEBABE12345678;', ['CAFEBABE12345678']],
      ['0x00112233', ['0x00112233']],
      ['a1b2c3d4e5f6', ['a1b2c3d4e5f6']],
    ],
    neg: ['12345678', 'deadbee', '0xzz112233', 'ghijklmn', 'xdeadbeef', 'deadbeefg', '0x1234567'],
  },
  {
    id: 'hash',
    pos: [
      [MD5, [MD5]],
      [`md5: ${SHA1}`, [SHA1]],
      [`(${SHA256})`, [SHA256]],
      [SHA512, [SHA512]],
    ],
    neg: [MD5.slice(1), MD5 + 'a', SHA1 + 'ff', 'g'.repeat(32), SHA256.slice(0, 63), 'x' + MD5],
  },
  {
    id: 'ipv4',
    pos: [
      ['192.168.0.1', ['192.168.0.1']],
      ['ip=10.0.0.255,', ['10.0.0.255']],
      ['0.0.0.0 and 255.255.255.255', ['0.0.0.0', '255.255.255.255']],
      ['(8.8.8.8)', ['8.8.8.8']],
    ],
    neg: ['256.1.1.1', '1.2.3', '1.2.3.4.5', '01.2.3.4', 'a1.2.3.4', '999.999.999.999', 'v1.2.3.4x'],
  },
  {
    id: 'ipv6',
    pos: [
      ['2001:db8::1', ['2001:db8::1']],
      ['addr ::1 ok', ['::1']],
      ['fe80::1ff:fe23:4567:890a', ['fe80::1ff:fe23:4567:890a']],
      ['2001:0db8:85a3:0000:0000:8a2e:0370:7334', ['2001:0db8:85a3:0000:0000:8a2e:0370:7334']],
      ['::ffff:192.168.0.1', ['::ffff:192.168.0.1']],
      ['host 1:: end.', ['1::']],
    ],
    neg: ['12:30:45', '1:2:3:4:5:6:7:8:9', ':::', '2001:db8::1::2', 'gggg::1', 'aa:bb:cc:dd:ee:ff', '::', 'std::vector', '12345678'],
  },
  {
    id: 'mac',
    pos: [
      ['00:1A:2B:3C:4D:5E', ['00:1A:2B:3C:4D:5E']],
      ['00-1a-2b-3c-4d-5e', ['00-1a-2b-3c-4d-5e']],
      ['mac=aa:bb:cc:dd:ee:ff;', ['aa:bb:cc:dd:ee:ff']],
      ['AA:BB:CC:DD:EE:FF', ['AA:BB:CC:DD:EE:FF']],
    ],
    neg: ['00:1A:2B:3C:4D', '00:1A:2B:3C:4D:5E:6F', '00:1A-2B:3C-4D:5E', 'GG:1A:2B:3C:4D:5E', '1:2:3:4:5:6'],
  },
  {
    id: 'uuid',
    pos: [
      ['123e4567-e89b-12d3-a456-426614174000', ['123e4567-e89b-12d3-a456-426614174000']],
      ['ID=123E4567-E89B-12D3-A456-426614174000;', ['123E4567-E89B-12D3-A456-426614174000']],
      ['{123e4567-e89b-12d3-a456-426614174000}', ['123e4567-e89b-12d3-a456-426614174000']],
      ['req-123e4567-e89b-12d3-a456-426614174000', ['123e4567-e89b-12d3-a456-426614174000']],
    ],
    neg: [
      '123e4567-e89b-12d3-a456',
      '123e4567e89b12d3a456426614174000',
      '123e4567-e89b-12d3-a456-42661417400',
      '123e4567-e89b-12d3-a456-42661417400g',
      '123e4567-e89b-12d3-a456-4266141740000',
    ],
  },
  {
    id: 'email',
    pos: [
      ['a@b.co', ['a@b.co']],
      ['john.doe+tag@example.com', ['john.doe+tag@example.com']],
      ['<x_y@sub.domain.org>', ['x_y@sub.domain.org']],
      ['Contact: bob@example.io.', ['bob@example.io']],
    ],
    neg: ['@example.com', 'a@b', 'a@b.c', 'user@@example.com', 'foo@.com', 'no at sign here', '.a@b.com.'.slice(0, 0) + 'a..b@c.com'],
  },
  {
    id: 'url',
    pos: [
      ['http://example.com', ['http://example.com']],
      ['https://example.com/p?q=1&a=2#f', ['https://example.com/p?q=1&a=2#f']],
      ['see (https://en.wikipedia.org/wiki/Foo_(bar)).', ['https://en.wikipedia.org/wiki/Foo_(bar)']],
      ['ftp://files.example.org/a.zip,', ['ftp://files.example.org/a.zip']],
      ['ws://localhost:8080/socket!', ['ws://localhost:8080/socket']],
    ],
    neg: ['example.com', 'http:/example.com', 'htp://x.com', 'mailto:a@b.com', 'http://', 'xhttp://a.com'],
  },
  {
    id: 'base64',
    pos: [
      ['SGVsbG8sIFdvcmxkIQ==', ['SGVsbG8sIFdvcmxkIQ==']],
      [`data: ${BIG_B64}`, [BIG_B64]],
      ['YWJjZGVmZ2hpamtsbW5vcA==', ['YWJjZGVmZ2hpamtsbW5vcA==']],
      [`tok=${URLSAFE}`, [URLSAFE]],
    ],
    neg: [
      'abcdefghijklmnopqrstuvwxyz',
      'HelloWorldThisIsAWord',
      'SGVsbG8=',
      'SGVsbG8sIFdvcmxkIQ=',
      'AAAAAAAAAAAAAAAA===',
      'ab+cd_efghij1234567',
      'snake_case_variable_name',
    ],
  },
  {
    id: 'jwt',
    pos: [
      [jwt({ alg: 'HS256', typ: 'JWT' }, { sub: '1' }), [jwt({ alg: 'HS256', typ: 'JWT' }, { sub: '1' })]],
      [jwt({ alg: 'none' }, { a: 1 }, ''), [jwt({ alg: 'none' }, { a: 1 }, '')]],
      [`Bearer ${jwt({ alg: 'RS256' }, { iss: 'x' })}`, [jwt({ alg: 'RS256' }, { iss: 'x' })]],
      [`"${jwt({ alg: 'ES256', kid: 'k' }, { n: 'v' })}"`, [jwt({ alg: 'ES256', kid: 'k' }, { n: 'v' })]],
    ],
    neg: [
      'a.b.c',
      jwt({ typ: 'JWT' }, { sub: '1' }),
      'notjson.' + b64url('{}') + '.sig',
      'eyJhbGciOiJIUzI1NiJ9.e30',
      'com.example.application.name',
    ],
  },
  {
    id: 'flag',
    pos: [
      ['flag{abc_123}', ['flag{abc_123}']],
      ['picoCTF{hello}', ['picoCTF{hello}']],
      ['got HTB{x} and CTF{a-b-c}', ['HTB{x}', 'CTF{a-b-c}']],
      ['MYEVENT{secret}', ['MYEVENT{secret}']],
    ],
    neg: ['flag{}', 'flag{has space}', 'flag {abc}', '{abc}', 'x{abc}', 'flag{unterminated'],
  },
  {
    id: 'iso8601',
    pos: [
      ['2024-01-15', ['2024-01-15']],
      ['at 2024-01-15T10:30:00Z.', ['2024-01-15T10:30:00Z']],
      ['2024-01-15 10:30:00.123+02:00', ['2024-01-15 10:30:00.123+02:00']],
      ['2024-12-31T23:59', ['2024-12-31T23:59']],
    ],
    neg: ['2024-13-01', '2024-01-32', '24-01-15', '2024/01/15', '2024-01-15T25:00:00', '12024-01-15'],
  },
  {
    id: 'decimal-int',
    pos: [
      ['42', ['42']],
      ['-7 and +15', ['-7', '+15']],
      ['a 007 b', ['007']],
      ['x=100,y=200', ['100', '200']],
    ],
    neg: ['3.14', '1.2.3.4', 'abc123', '0x1F', '1e5', '12ab'],
  },
  {
    id: 'decimal-float',
    pos: [
      ['3.14', ['3.14']],
      ['-0.5', ['-0.5']],
      ['.5', ['.5']],
      ['1.5e10 2.0E-3', ['1.5e10', '2.0E-3']],
      ['+7.25', ['+7.25']],
    ],
    neg: ['42', '1.2.3', '1.', 'abc3.14', '3.14abc'],
  },
  {
    id: 'quoted-string',
    pos: [
      ['"hello world"', ['hello world']],
      ["'abc'", ['abc']],
      [`say "a" and 'b'`, ['a', 'b']],
      ['"esc \\" quote"', ['esc \\" quote']],
    ],
    neg: ['no quotes here', '""', "''", '"unterminated', `'mismatched"`],
  },
];

describe('detector registry', () => {
  it('has a corpus for every detector', () => {
    expect(corpora.map((c) => c.id).sort()).toEqual(DETECTORS.map((d) => d.id).sort());
  });
  it('defaults: noisy detectors are off, core ones are on', () => {
    const on = DETECTORS.filter((d) => d.defaultEnabled).map((d) => d.id);
    for (const id of ['binary', 'hex', 'hash', 'base64', 'flag']) expect(on).toContain(id);
    for (const id of ['iso8601', 'decimal-int', 'decimal-float', 'quoted-string']) expect(on).not.toContain(id);
  });
  it('every detector has at least 4 positive and 4 negative cases', () => {
    for (const c of corpora) {
      expect(c.pos.length, c.id).toBeGreaterThanOrEqual(4);
      expect(c.neg.length, c.id).toBeGreaterThanOrEqual(4);
    }
  });
});

for (const c of corpora) {
  describe(`detector: ${c.id}`, () => {
    for (const [input, expected] of c.pos) {
      it(`matches ${JSON.stringify(input.length > 50 ? input.slice(0, 50) + '…' : input)}`, () => {
        expect(texts(input, [c.id], (c.params ?? {}) as never)).toEqual(expected);
      });
    }
    for (const input of c.neg) {
      it(`rejects ${JSON.stringify(input.length > 50 ? input.slice(0, 50) + '…' : input)}`, () => {
        expect(texts(input, [c.id])).toEqual([]);
      });
    }
  });
}

describe('detector specifics', () => {
  it('hash reports its algorithm in the type', () => {
    expect(run(MD5, ['hash']).matches[0].type).toBe('hash:md5');
    expect(run(SHA1, ['hash']).matches[0].type).toBe('hash:sha1');
    expect(run(SHA256, ['hash']).matches[0].type).toBe('hash:sha256');
    expect(run(SHA512, ['hash']).matches[0].type).toBe('hash:sha512');
  });
  it('hex strips 0x on request and shifts the span', () => {
    const r = run('v=0xDEADBEEF', ['hex'], { hex: { stripPrefix: true } });
    expect(r.matches[0].text).toBe('DEADBEEF');
    expect(r.matches[0].start).toBe(4);
  });
  it('hex min length is a parameter', () => {
    expect(texts('beef', ['hex'], { hex: { minLength: 4 } })).toEqual(['beef']);
    expect(texts('beef', ['hex'])).toEqual([]);
  });
  it('base64 puts a decoded preview in meta', () => {
    const r = run('SGVsbG8sIFdvcmxkIQ==', ['base64']);
    expect(r.matches[0].meta?.decoded).toBe('Hello, World!');
  });
  it('base64 escapes non-printable bytes and truncates the preview to 80 chars', () => {
    const bin = b64([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46]);
    const r = run(bin, ['base64']);
    expect(r.matches[0].meta?.decoded).toBe('\\x00\\x01\\x02\\xff\\xfe\\xfdABCDEF');
    const long = b64('Hello, World! '.repeat(30));
    const r2 = run(long, ['base64']);
    expect(r2.matches[0].meta!.decoded).toHaveLength(81);
    expect(r2.matches[0].meta!.decoded.endsWith('…')).toBe(true);
  });
  it('jwt puts decoded header and payload in meta', () => {
    const t = jwt({ alg: 'HS256', typ: 'JWT' }, { sub: 'alice' });
    const r = run(t, ['jwt']);
    expect(r.matches[0].meta?.header).toBe('{"alg":"HS256","typ":"JWT"}');
    expect(r.matches[0].meta?.payload).toBe('{"sub":"alice"}');
  });
  it('flag prefix list is editable', () => {
    expect(texts('FOO{bar} flag{x}', ['flag'], { flag: { prefixes: ['FOO'] } })).toEqual(['FOO{bar}']);
  });
  it('quoted-string span excludes the quotes', () => {
    const t = `x = "abc"`;
    const m = run(t, ['quoted-string']).matches[0];
    expect(t.slice(m.start, m.end)).toBe('abc');
  });
  it('url strips only unbalanced closing brackets and trailing punctuation', () => {
    expect(texts('[https://a.com/x]', ['url'])).toEqual(['https://a.com/x']);
    expect(texts('https://a.com/x?', ['url'])).toEqual(['https://a.com/x']);
    expect(texts('https://a.com/a_(b)', ['url'])).toEqual(['https://a.com/a_(b)']);
  });
  it('ipv6 is checked by a validator, not just a regex', () => {
    expect(texts('1:2:3:4:5:6:7:8', ['ipv6'])).toEqual(['1:2:3:4:5:6:7:8']);
    expect(texts('1:2:3:4:5:6:7', ['ipv6'])).toEqual([]);
    expect(texts('1:2:3:4:5:6:7::', ['ipv6'])).toEqual(['1:2:3:4:5:6:7::']);
    expect(texts('12345::1', ['ipv6'])).toEqual([]);
  });
});
