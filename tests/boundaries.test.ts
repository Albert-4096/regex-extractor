import { describe, expect, it } from 'vitest';
import { run, texts } from './helpers';

describe('binary boundaries', () => {
  it('ignores the 0 in Circuit[0]', () => {
    expect(texts('Circuit[0] : 1', ['binary'])).toEqual([]);
  });
  it('ignores a bit string glued to a word character', () => {
    expect(texts('x01110101', ['binary'])).toEqual([]);
    expect(texts('01110101x', ['binary'])).toEqual([]);
    expect(texts('_01110101', ['binary'])).toEqual([]);
  });
  it('yields one value for a 16-bit string, not two', () => {
    expect(texts('1010101011110000', ['binary'])).toEqual(['1010101011110000']);
  });
  it('min length 7 vs 8 changes the result', () => {
    expect(texts('a 0111010 b', ['binary'], { binary: { minLength: 8 } })).toEqual([]);
    expect(texts('a 0111010 b', ['binary'], { binary: { minLength: 7 } })).toEqual(['0111010']);
  });
  it('keeps the 0b prefix by default and strips it on request', () => {
    expect(texts('v=0b10101010;', ['binary'])).toEqual(['0b10101010']);
    const r = run('v=0b10101010;', ['binary'], { binary: { stripPrefix: true } });
    expect(r.matches[0].text).toBe('10101010');
    expect(r.matches[0].start).toBe(4);
    expect(r.matches[0].end).toBe(12);
  });
  it('min length counts digits, not the 0b prefix', () => {
    expect(texts('0b1010101', ['binary'], { binary: { minLength: 8 } })).toEqual([]);
  });
  it('honours max length by rejecting longer strings whole', () => {
    expect(texts('1010101010101010', ['binary'], { binary: { maxLength: 8 } })).toEqual([]);
    expect(texts('10101010', ['binary'], { binary: { maxLength: 8 } })).toEqual(['10101010']);
  });
  it('honours the multiple-of parameter', () => {
    expect(texts('0101010101', ['binary'], { binary: { multipleOf: 8 } })).toEqual([]);
    expect(texts('0101010101010101', ['binary'], { binary: { multipleOf: 8 } })).toEqual(['0101010101010101']);
  });
  it('does not split on digits other than 0/1', () => {
    expect(texts('01110102', ['binary'])).toEqual([]);
  });
});
