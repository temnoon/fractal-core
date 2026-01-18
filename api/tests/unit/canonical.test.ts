import { describe, it, expect } from 'vitest';
import { canonicalStringify, canonicalBytes, canonicalParse } from '../../src/crypto/canonical.js';

describe('canonical JSON', () => {
  it('stringifies null', () => {
    expect(canonicalStringify(null)).toBe('null');
  });

  it('stringifies booleans', () => {
    expect(canonicalStringify(true)).toBe('true');
    expect(canonicalStringify(false)).toBe('false');
  });

  it('stringifies numbers', () => {
    expect(canonicalStringify(0)).toBe('0');
    expect(canonicalStringify(42)).toBe('42');
    expect(canonicalStringify(-123.456)).toBe('-123.456');
  });

  it('stringifies strings', () => {
    expect(canonicalStringify('hello')).toBe('"hello"');
    expect(canonicalStringify('')).toBe('""');
    expect(canonicalStringify('with "quotes"')).toBe('"with \\"quotes\\""');
  });

  it('stringifies bigints as strings', () => {
    expect(canonicalStringify(123n)).toBe('"123"');
    expect(canonicalStringify(-456n)).toBe('"-456"');
  });

  it('stringifies arrays preserving order', () => {
    expect(canonicalStringify([1, 2, 3])).toBe('[1,2,3]');
    expect(canonicalStringify(['a', 'b'])).toBe('["a","b"]');
    expect(canonicalStringify([])).toBe('[]');
  });

  it('stringifies objects with sorted keys', () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalStringify({ z: 1, m: 2, a: 3 })).toBe('{"a":3,"m":2,"z":1}');
    expect(canonicalStringify({})).toBe('{}');
  });

  it('stringifies nested structures', () => {
    const obj = {
      z: [1, 2],
      a: { y: 'hello', x: 42 },
    };
    expect(canonicalStringify(obj)).toBe('{"a":{"x":42,"y":"hello"},"z":[1,2]}');
  });

  it('produces no whitespace', () => {
    const result = canonicalStringify({ a: 1, b: [2, 3] });
    expect(result).not.toMatch(/\s/);
  });

  it('handles undefined as null', () => {
    expect(canonicalStringify(undefined)).toBe('null');
  });

  it('omits undefined object values', () => {
    expect(canonicalStringify({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  it('throws on non-finite numbers', () => {
    expect(() => canonicalStringify(Infinity)).toThrow();
    expect(() => canonicalStringify(-Infinity)).toThrow();
    expect(() => canonicalStringify(NaN)).toThrow();
  });

  it('produces correct bytes', () => {
    const bytes = canonicalBytes({ a: 1 });
    expect(bytes).toEqual(new TextEncoder().encode('{"a":1}'));
  });

  it('parses back to original', () => {
    const obj = { a: 1, b: 'hello', c: [1, 2, 3] };
    const json = canonicalStringify(obj);
    const parsed = canonicalParse<typeof obj>(json);
    expect(parsed).toEqual(obj);
  });
});
