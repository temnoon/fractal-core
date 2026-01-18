import { describe, it, expect } from 'vitest';
import { uvarintEncode, uvarintDecode, uvarintSize } from '../../src/encoding/varint.js';

describe('varint encoding', () => {
  it('encodes small values', () => {
    expect(uvarintEncode(0n)).toEqual(new Uint8Array([0]));
    expect(uvarintEncode(1n)).toEqual(new Uint8Array([1]));
    expect(uvarintEncode(127n)).toEqual(new Uint8Array([127]));
  });

  it('encodes values >= 128', () => {
    expect(uvarintEncode(128n)).toEqual(new Uint8Array([0x80, 0x01]));
    expect(uvarintEncode(300n)).toEqual(new Uint8Array([0xac, 0x02]));
  });

  it('encodes large values', () => {
    // 16384 = 0b100000000000000 -> 0x80 0x80 0x01
    expect(uvarintEncode(16384n)).toEqual(new Uint8Array([0x80, 0x80, 0x01]));
  });

  it('throws on negative values', () => {
    expect(() => uvarintEncode(-1n)).toThrow();
  });

  it('decodes small values', () => {
    expect(uvarintDecode(new Uint8Array([0]))).toEqual([0n, 1]);
    expect(uvarintDecode(new Uint8Array([1]))).toEqual([1n, 1]);
    expect(uvarintDecode(new Uint8Array([127]))).toEqual([127n, 1]);
  });

  it('decodes multi-byte values', () => {
    expect(uvarintDecode(new Uint8Array([0x80, 0x01]))).toEqual([128n, 2]);
    expect(uvarintDecode(new Uint8Array([0xac, 0x02]))).toEqual([300n, 2]);
  });

  it('decodes with offset', () => {
    const buf = new Uint8Array([0xff, 0xff, 0xac, 0x02, 0xff]);
    expect(uvarintDecode(buf, 2)).toEqual([300n, 2]);
  });

  it('round-trips correctly', () => {
    const values = [0n, 1n, 127n, 128n, 300n, 16384n, 1000000n, 123456789012345n];
    for (const v of values) {
      const encoded = uvarintEncode(v);
      const [decoded] = uvarintDecode(encoded);
      expect(decoded).toBe(v);
    }
  });

  it('calculates size correctly', () => {
    expect(uvarintSize(0n)).toBe(1);
    expect(uvarintSize(127n)).toBe(1);
    expect(uvarintSize(128n)).toBe(2);
    expect(uvarintSize(16383n)).toBe(2);
    expect(uvarintSize(16384n)).toBe(3);
  });
});
