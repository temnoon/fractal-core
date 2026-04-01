/**
 * Prime Engine - Unified interface for prime computation
 *
 * Automatically selects the most efficient engine based on the size of numbers:
 * - Sieve: For primes up to 10 million (O(1) lookup after sieving)
 * - Miller-Rabin: For larger numbers up to ~10^24 (deterministic)
 * - BPSW: For very large numbers (most reliable probabilistic test)
 */

import { sieveEngine } from './sieve.js';
import { millerRabinEngine } from './miller-rabin.js';
import { bpswEngine } from './bpsw.js';

export type EngineName = 'auto' | 'sieve' | 'miller-rabin' | 'bpsw';

// Threshold for switching from sieve to probabilistic methods
const SIEVE_LIMIT = 10_000_000n;
// Threshold for switching from Miller-Rabin to BPSW
const MR_DETERMINISTIC_LIMIT = 3_317_044_064_679_887_385_961_981n;

export interface PrimeEngine {
  /** Check if value is prime */
  isPrime(n: bigint): boolean;

  /** Find next prime >= n */
  nextPrime(n: bigint): { prime: bigint; index?: number };

  /** Find previous prime <= n */
  prevPrime(n: bigint): { prime: bigint; index?: number };

  /** Get primes around a center index (uses sieve for small indices) */
  primesAroundIndex(
    index: number,
    k: number
  ): { primes: bigint[]; indices: number[] };

  /** Get primes around a center value */
  primesAroundValue(
    center: bigint,
    count: number
  ): { primes: bigint[]; indices?: number[] };

  /** Get prime at specific index (0-indexed) */
  primeAtIndex(index: number): bigint;

  /** Get index of a prime (-1 if not prime or not in sieve range) */
  indexOfPrime(p: bigint): number;

  /** Get engine name being used */
  readonly name: EngineName;
}

/**
 * Create a unified prime engine
 */
export function createPrimeEngine(preferredEngine: EngineName = 'auto'): PrimeEngine {
  return {
    name: preferredEngine,

    isPrime(n: bigint): boolean {
      if (preferredEngine === 'sieve' || (preferredEngine === 'auto' && n <= SIEVE_LIMIT)) {
        return sieveEngine.isPrime(n);
      }
      if (preferredEngine === 'miller-rabin' || (preferredEngine === 'auto' && n <= MR_DETERMINISTIC_LIMIT)) {
        return millerRabinEngine.isPrime(n);
      }
      return bpswEngine.isPrime(n);
    },

    nextPrime(n: bigint): { prime: bigint; index?: number } {
      if (preferredEngine === 'sieve' || (preferredEngine === 'auto' && n <= SIEVE_LIMIT)) {
        const result = sieveEngine.nextPrime(n);
        return { prime: result.prime, index: result.index };
      }
      if (preferredEngine === 'miller-rabin') {
        return { prime: millerRabinEngine.nextPrime(n) };
      }
      if (preferredEngine === 'bpsw') {
        return { prime: bpswEngine.nextPrime(n) };
      }
      // Auto mode for large n
      if (n <= MR_DETERMINISTIC_LIMIT) {
        return { prime: millerRabinEngine.nextPrime(n) };
      }
      return { prime: bpswEngine.nextPrime(n) };
    },

    prevPrime(n: bigint): { prime: bigint; index?: number } {
      if (n <= SIEVE_LIMIT) {
        // For small numbers, use sieve for index tracking
        const primes = sieveEngine.primesUpTo(n);
        if (primes.length === 0) return { prime: 2n, index: 0 };
        const lastPrime = primes[primes.length - 1];
        if (lastPrime === n && sieveEngine.isPrime(n)) {
          return { prime: n, index: primes.length - 1 };
        }
        // Find largest prime <= n
        for (let i = primes.length - 1; i >= 0; i--) {
          if (primes[i] <= n) {
            return { prime: primes[i], index: i };
          }
        }
        return { prime: 2n, index: 0 };
      }
      // Large numbers - no index available
      if (preferredEngine === 'miller-rabin') {
        return { prime: millerRabinEngine.prevPrime(n) };
      }
      return { prime: bpswEngine.prevPrime(n) };
    },

    primesAroundIndex(index: number, k: number): { primes: bigint[]; indices: number[] } {
      // For index-based lookups, we need the sieve
      // Estimate the prime size and decide
      const estimatedPrime = BigInt(Math.ceil(index * Math.log(index + 2) * 1.3));

      if (estimatedPrime <= SIEVE_LIMIT) {
        return sieveEngine.primesAroundIndex(index, k);
      }

      // For large indices, we need to work differently
      // First, find the prime at the center index
      const centerPrime = this.primeAtIndex(index);

      // Then find k primes on each side
      const primes: bigint[] = [];
      const indices: number[] = [];

      // Get primes before center
      let prevP = centerPrime;
      const before: bigint[] = [];
      for (let i = 0; i < k; i++) {
        prevP = bpswEngine.prevPrime(prevP - 1n);
        before.unshift(prevP);
      }

      // Add center and after
      primes.push(...before);
      primes.push(centerPrime);

      let nextP = centerPrime;
      for (let i = 0; i < k; i++) {
        nextP = bpswEngine.nextPrime(nextP + 1n);
        primes.push(nextP);
      }

      // Generate indices
      const startIndex = index - k;
      for (let i = 0; i < primes.length; i++) {
        indices.push(startIndex + i);
      }

      return { primes, indices };
    },

    primesAroundValue(center: bigint, count: number): { primes: bigint[]; indices?: number[] } {
      if (center <= SIEVE_LIMIT) {
        // Use sieve with index tracking
        const result = sieveEngine.primesAroundValue(center, BigInt(count * 20)); // Estimate window
        // Trim to count on each side
        const centerIdx = result.primes.findIndex(p => p >= center);
        const startIdx = Math.max(0, centerIdx - count);
        const endIdx = Math.min(result.primes.length, centerIdx + count + 1);
        return {
          primes: result.primes.slice(startIdx, endIdx),
          indices: result.indices.slice(startIdx, endIdx),
        };
      }

      // For large values, use BPSW
      const { before, after } = bpswEngine.primesAround(center, count + 1);
      const primes = [...before, ...after];

      // Remove center if it appears twice
      const uniquePrimes = [...new Set(primes.map(p => p.toString()))].map(s => BigInt(s));
      uniquePrimes.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

      return { primes: uniquePrimes };
    },

    primeAtIndex(index: number): bigint {
      // Estimate the size of the prime
      const estimate = BigInt(Math.ceil((index + 1) * Math.log(index + 2) * 1.3));

      if (estimate <= SIEVE_LIMIT) {
        return sieveEngine.primeAtIndex(index);
      }

      // For large indices, we need to count primes
      // This is expensive but necessary without precomputation
      // Use sieve up to limit, then count remaining with BPSW
      const sievePrimes = sieveEngine.primesUpTo(SIEVE_LIMIT);

      if (index < sievePrimes.length) {
        return sievePrimes[index];
      }

      // Need to find more primes beyond sieve limit
      let count = sievePrimes.length;
      let candidate = SIEVE_LIMIT + 1n;
      if (candidate % 2n === 0n) candidate++;

      while (count <= index) {
        if (bpswEngine.isPrime(candidate)) {
          count++;
          if (count > index) {
            return candidate;
          }
        }
        candidate += 2n;
      }

      return candidate;
    },

    indexOfPrime(p: bigint): number {
      if (p <= SIEVE_LIMIT) {
        return sieveEngine.indexOfPrime(p);
      }

      // For large primes, check if prime first
      if (!bpswEngine.isPrime(p)) {
        return -1;
      }

      // Count all primes up to p (expensive)
      // First count sieve primes
      const sievePrimes = sieveEngine.primesUpTo(SIEVE_LIMIT);
      let count = sievePrimes.length;

      // Then count remaining
      let candidate = SIEVE_LIMIT + 1n;
      if (candidate % 2n === 0n) candidate++;

      while (candidate < p) {
        if (bpswEngine.isPrime(candidate)) {
          count++;
        }
        candidate += 2n;
      }

      return count;
    },
  };
}

// Export singleton auto engine
export const primeEngine = createPrimeEngine('auto');

// Re-export individual engines
export { sieveEngine } from './sieve.js';
export { millerRabinEngine } from './miller-rabin.js';
export { bpswEngine } from './bpsw.js';
