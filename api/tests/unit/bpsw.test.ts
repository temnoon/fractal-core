/**
 * BPSW engine tests — guards the long-standing parity bug in primesAround
 * where, for any odd center prime, the backward walk would start even,
 * decrement by 2 forever, never visit an odd candidate, and silently
 * return only [2] for the "before" array. Detected via terrain.html
 * showing gap[0] = 12876466 for a query around p=12876467.
 */

import { describe, it, expect } from 'vitest';
import { bpswEngine } from '../../src/services/engines/bpsw.js';

describe('bpsw engine', () => {
  describe('primesAround — large odd center', () => {
    it('returns the requested number of primes both sides (no parity bug)', () => {
      const center = 12876467n; // prime
      const count = 10;
      const { before, after } = bpswEngine.primesAround(center, count);

      expect(before).toHaveLength(count);
      expect(after).toHaveLength(count);

      // Ascending order, all distinct, none of them == 2 (we are FAR from 2).
      for (let i = 1; i < before.length; i++) {
        expect(before[i]).toBeGreaterThan(before[i - 1]);
      }
      expect(before.every((p) => p > 100n)).toBe(true);

      // The first "after" prime should be the center itself when prime.
      expect(after[0]).toBe(center);
      for (let i = 1; i < after.length; i++) {
        expect(after[i]).toBeGreaterThan(after[i - 1]);
      }
    });

    it('produces small consecutive gaps after the join (the original bug)', () => {
      // Stitch before+after into a single sequence and walk gaps. With the
      // old bug, gap[0] was ~center-1 because before[0] was 2.
      const center = 12876467n;
      const { before, after } = bpswEngine.primesAround(center, 10);
      const all = [...before, ...after];
      const gaps: bigint[] = [];
      for (let i = 1; i < all.length; i++) gaps.push(all[i] - all[i - 1]);
      // Largest plausible local gap at this scale is < 100. The original
      // bug gave gap[0] ≈ 12876466 — orders of magnitude over.
      for (const g of gaps) {
        expect(g).toBeGreaterThan(0n);
        expect(g).toBeLessThan(1000n);
      }
    });
  });

  describe('primesAround — small / edge centers', () => {
    it('handles a center near the bottom of primes (count > available before)', () => {
      const { before } = bpswEngine.primesAround(7n, 10);
      // Only three primes (2, 3, 5) below 7. Walker should return all of them
      // (in ascending order) without spinning forever.
      expect(before).toEqual([2n, 3n, 5n]);
    });

    it('handles even non-prime center', () => {
      const { before, after } = bpswEngine.primesAround(100n, 5);
      expect(before).toHaveLength(5);
      expect(after).toHaveLength(5);
      // 100 is not prime; first "after" should be 101.
      expect(after[0]).toBe(101n);
      // All "before" are primes < 100.
      for (const p of before) expect(p < 100n).toBe(true);
    });
  });
});
