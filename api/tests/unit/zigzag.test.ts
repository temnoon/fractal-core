import { describe, it, expect } from 'vitest';
import { zigzagEncode, zigzagDecode } from '../../src/encoding/zigzag.js';

describe('zigzag encoding', () => {
  it('encodes zero', () => {
    expect(zigzagEncode(0n)).toBe(0n);
  });

  it('encodes positive numbers', () => {
    expect(zigzagEncode(1n)).toBe(2n);
    expect(zigzagEncode(2n)).toBe(4n);
    expect(zigzagEncode(100n)).toBe(200n);
  });

  it('encodes negative numbers', () => {
    expect(zigzagEncode(-1n)).toBe(1n);
    expect(zigzagEncode(-2n)).toBe(3n);
    expect(zigzagEncode(-100n)).toBe(199n);
  });

  it('decodes zero', () => {
    expect(zigzagDecode(0n)).toBe(0n);
  });

  it('decodes to positive numbers', () => {
    expect(zigzagDecode(2n)).toBe(1n);
    expect(zigzagDecode(4n)).toBe(2n);
    expect(zigzagDecode(200n)).toBe(100n);
  });

  it('decodes to negative numbers', () => {
    expect(zigzagDecode(1n)).toBe(-1n);
    expect(zigzagDecode(3n)).toBe(-2n);
    expect(zigzagDecode(199n)).toBe(-100n);
  });

  it('round-trips correctly', () => {
    const values = [0n, 1n, -1n, 2n, -2n, 100n, -100n, 1000000n, -1000000n];
    for (const v of values) {
      const encoded = zigzagEncode(v);
      const decoded = zigzagDecode(encoded);
      expect(decoded).toBe(v);
    }
  });

  it('throws on negative input to decode', () => {
    expect(() => zigzagDecode(-1n)).toThrow();
  });
});
