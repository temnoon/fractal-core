import { describe, it, expect } from 'vitest';
import { createSieveEngine } from '../../src/services/engines/sieve.js';

describe('sieve engine', () => {
  const engine = createSieveEngine();

  // Known primes for testing
  const knownPrimes = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n];

  it('returns engine name', () => {
    expect(engine.name).toBe('sieve');
  });

  describe('primesUpTo', () => {
    it('returns empty for limit < 2', () => {
      expect(engine.primesUpTo(1n)).toEqual([]);
      expect(engine.primesUpTo(0n)).toEqual([]);
    });

    it('returns primes up to limit', () => {
      expect(engine.primesUpTo(10n)).toEqual([2n, 3n, 5n, 7n]);
      expect(engine.primesUpTo(20n)).toEqual([2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n]);
    });

    it('includes limit if prime', () => {
      expect(engine.primesUpTo(7n)).toContain(7n);
      expect(engine.primesUpTo(11n)).toContain(11n);
    });
  });

  describe('primeAtIndex', () => {
    it('returns correct primes by index', () => {
      for (let i = 0; i < knownPrimes.length; i++) {
        expect(engine.primeAtIndex(i)).toBe(knownPrimes[i]);
      }
    });

    it('handles larger indices', () => {
      expect(engine.primeAtIndex(99)).toBe(541n); // 100th prime
      expect(engine.primeAtIndex(999)).toBe(7919n); // 1000th prime
    });
  });

  describe('isPrime', () => {
    it('returns true for primes', () => {
      for (const p of knownPrimes) {
        expect(engine.isPrime(p)).toBe(true);
      }
    });

    it('returns false for non-primes', () => {
      expect(engine.isPrime(0n)).toBe(false);
      expect(engine.isPrime(1n)).toBe(false);
      expect(engine.isPrime(4n)).toBe(false);
      expect(engine.isPrime(6n)).toBe(false);
      expect(engine.isPrime(100n)).toBe(false);
    });
  });

  describe('indexOfPrime', () => {
    it('returns correct index for primes', () => {
      for (let i = 0; i < knownPrimes.length; i++) {
        expect(engine.indexOfPrime(knownPrimes[i])).toBe(i);
      }
    });

    it('returns -1 for non-primes', () => {
      expect(engine.indexOfPrime(4n)).toBe(-1);
      expect(engine.indexOfPrime(6n)).toBe(-1);
      expect(engine.indexOfPrime(100n)).toBe(-1);
    });
  });

  describe('primesInRange', () => {
    it('returns primes in range', () => {
      expect(engine.primesInRange(5n, 20n)).toEqual([5n, 7n, 11n, 13n, 17n, 19n]);
    });

    it('returns empty for invalid range', () => {
      expect(engine.primesInRange(20n, 5n)).toEqual([]);
    });

    it('includes endpoints if prime', () => {
      const result = engine.primesInRange(7n, 13n);
      expect(result).toContain(7n);
      expect(result).toContain(13n);
    });
  });

  describe('primesAroundIndex', () => {
    it('returns primes around center index', () => {
      const result = engine.primesAroundIndex(5, 2); // center at p[5]=13
      expect(result.primes).toEqual([7n, 11n, 13n, 17n, 19n]);
      expect(result.indices).toEqual([3, 4, 5, 6, 7]);
    });

    it('handles edge at start', () => {
      const result = engine.primesAroundIndex(1, 2);
      expect(result.primes[0]).toBe(2n); // Should start at index 0
    });
  });

  describe('primesAroundValue', () => {
    it('returns primes around center value', () => {
      const result = engine.primesAroundValue(10n, 5n); // 10 +/- 5 = [5, 15]
      expect(result.primes).toEqual([5n, 7n, 11n, 13n]);
    });
  });

  describe('closestPrime', () => {
    it('returns exact match for primes', () => {
      const result = engine.closestPrime(13n);
      expect(result.prime).toBe(13n);
      expect(result.index).toBe(5);
    });

    it('returns closest prime for non-primes', () => {
      expect(engine.closestPrime(10n).prime).toBe(11n); // 11 is closer than 7
      expect(engine.closestPrime(8n).prime).toBe(7n);   // 7 is closer than 11
      expect(engine.closestPrime(9n).prime).toBe(7n);   // 7 and 11 equidistant, prefer lower
    });

    it('handles values below 2', () => {
      expect(engine.closestPrime(0n).prime).toBe(2n);
      expect(engine.closestPrime(1n).prime).toBe(2n);
    });
  });

  describe('nextPrime', () => {
    it('returns exact match when value is prime', () => {
      const result = engine.nextPrime(13n);
      expect(result.prime).toBe(13n);
      expect(result.index).toBe(5);
    });

    it('returns next prime for non-primes (always forward)', () => {
      // 20 is not prime; primes around it: 19, 23
      // nextPrime should return 23 (not 19)
      expect(engine.nextPrime(20n).prime).toBe(23n);

      // 50 is not prime; primes around it: 47, 53
      // nextPrime should return 53 (not 47)
      expect(engine.nextPrime(50n).prime).toBe(53n);

      // 100 is not prime; primes around it: 97, 101
      // nextPrime should return 101 (not 97)
      expect(engine.nextPrime(100n).prime).toBe(101n);
    });

    it('handles values below 2', () => {
      expect(engine.nextPrime(0n).prime).toBe(2n);
      expect(engine.nextPrime(1n).prime).toBe(2n);
    });

    it('returns correct index', () => {
      // 23 is p[8] (0-indexed)
      const result = engine.nextPrime(20n);
      expect(result.index).toBe(8);
    });
  });
});
