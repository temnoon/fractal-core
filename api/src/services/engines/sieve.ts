/**
 * Sieve of Eratosthenes - primary prime computation engine
 *
 * Provides prime generation and primality testing for small to medium values.
 * For values beyond sieve limits, use probabilistic engines.
 */

export interface SieveEngine {
  /** Get all primes up to limit */
  primesUpTo(limit: bigint): bigint[];

  /** Get prime by index (0-indexed: p[0] = 2) */
  primeAtIndex(index: number): bigint;

  /** Get primes in range [start, end] */
  primesInRange(start: bigint, end: bigint): bigint[];

  /** Get index of a prime (returns -1 if not prime) */
  indexOfPrime(p: bigint): number;

  /** Check if value is prime */
  isPrime(n: bigint): boolean;

  /** Get primes around an index: [index - k, index + k] */
  primesAroundIndex(index: number, k: number): { primes: bigint[]; indices: number[] };

  /** Get primes around a value within window [-w, +w] */
  primesAroundValue(center: bigint, w: bigint): { primes: bigint[]; indices: number[] };

  /** Find closest prime to value */
  closestPrime(n: bigint): { prime: bigint; index: number };

  /** Find next prime >= value (for n_type=value lookups) */
  nextPrime(n: bigint): { prime: bigint; index: number };

  /** Engine identifier */
  readonly name: 'sieve';
}

// Cache for sieved primes
let cachedPrimes: bigint[] = [];
let sieveLimit = 0n;

/**
 * Generate primes up to limit using Sieve of Eratosthenes
 */
function sieve(limit: bigint): bigint[] {
  if (limit < 2n) return [];

  // Convert to number for array indexing (limit sieve to ~10M for safety)
  const maxLimit = 10_000_000n;
  if (limit > maxLimit) {
    limit = maxLimit;
  }

  const n = Number(limit);
  const isPrime = new Uint8Array(n + 1).fill(1);
  isPrime[0] = 0;
  isPrime[1] = 0;

  for (let i = 2; i * i <= n; i++) {
    if (isPrime[i]) {
      for (let j = i * i; j <= n; j += i) {
        isPrime[j] = 0;
      }
    }
  }

  const primes: bigint[] = [];
  for (let i = 2; i <= n; i++) {
    if (isPrime[i]) {
      primes.push(BigInt(i));
    }
  }

  return primes;
}

/**
 * Ensure cache covers primes up to given limit
 */
function ensureSieved(limit: bigint): void {
  if (limit <= sieveLimit) return;

  // Extend limit with some margin
  const newLimit = limit + 10000n;
  cachedPrimes = sieve(newLimit);
  sieveLimit = newLimit;
}

/**
 * Binary search to find index of value in sorted array
 */
function binarySearch(arr: bigint[], target: bigint): number {
  let lo = 0;
  let hi = arr.length - 1;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (arr[mid] === target) return mid;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }

  return -1;
}

/**
 * Binary search to find insertion point
 */
function lowerBound(arr: bigint[], target: bigint): number {
  let lo = 0;
  let hi = arr.length;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }

  return lo;
}

/**
 * Create a sieve engine instance
 */
export function createSieveEngine(): SieveEngine {
  return {
    name: 'sieve',

    primesUpTo(limit: bigint): bigint[] {
      ensureSieved(limit);
      const idx = lowerBound(cachedPrimes, limit + 1n);
      return cachedPrimes.slice(0, idx);
    },

    primeAtIndex(index: number): bigint {
      // Estimate required sieve limit using prime number theorem
      // p_n ~ n * ln(n) for large n
      let estimate = BigInt(Math.max(100, Math.ceil((index + 1) * Math.log(index + 2) * 1.3)));
      ensureSieved(estimate);

      // Extend if needed
      while (cachedPrimes.length <= index) {
        estimate *= 2n;
        ensureSieved(estimate);
      }

      return cachedPrimes[index];
    },

    primesInRange(start: bigint, end: bigint): bigint[] {
      if (start > end) return [];
      ensureSieved(end);

      const startIdx = lowerBound(cachedPrimes, start);
      const endIdx = lowerBound(cachedPrimes, end + 1n);
      return cachedPrimes.slice(startIdx, endIdx);
    },

    indexOfPrime(p: bigint): number {
      ensureSieved(p);
      return binarySearch(cachedPrimes, p);
    },

    isPrime(n: bigint): boolean {
      if (n < 2n) return false;
      ensureSieved(n);
      return binarySearch(cachedPrimes, n) >= 0;
    },

    primesAroundIndex(index: number, k: number): { primes: bigint[]; indices: number[] } {
      const startIdx = Math.max(0, index - k);
      const endIdx = index + k;

      // Ensure we have enough primes
      this.primeAtIndex(endIdx);

      const primes: bigint[] = [];
      const indices: number[] = [];

      for (let i = startIdx; i <= endIdx && i < cachedPrimes.length; i++) {
        primes.push(cachedPrimes[i]);
        indices.push(i);
      }

      return { primes, indices };
    },

    primesAroundValue(center: bigint, w: bigint): { primes: bigint[]; indices: number[] } {
      const start = center - w > 2n ? center - w : 2n;
      const end = center + w;

      ensureSieved(end);

      const startIdx = lowerBound(cachedPrimes, start);
      const endIdx = lowerBound(cachedPrimes, end + 1n);

      const primes: bigint[] = [];
      const indices: number[] = [];

      for (let i = startIdx; i < endIdx; i++) {
        primes.push(cachedPrimes[i]);
        indices.push(i);
      }

      return { primes, indices };
    },

    closestPrime(n: bigint): { prime: bigint; index: number } {
      if (n < 2n) return { prime: 2n, index: 0 };

      ensureSieved(n + 1000n); // Look ahead a bit

      const idx = lowerBound(cachedPrimes, n);

      // Check if n is exactly a prime
      if (idx < cachedPrimes.length && cachedPrimes[idx] === n) {
        return { prime: n, index: idx };
      }

      // Find closest between idx-1 and idx
      if (idx === 0) {
        return { prime: cachedPrimes[0], index: 0 };
      }

      if (idx >= cachedPrimes.length) {
        return { prime: cachedPrimes[cachedPrimes.length - 1], index: cachedPrimes.length - 1 };
      }

      const lower = cachedPrimes[idx - 1];
      const upper = cachedPrimes[idx];

      if (n - lower <= upper - n) {
        return { prime: lower, index: idx - 1 };
      } else {
        return { prime: upper, index: idx };
      }
    },

    nextPrime(n: bigint): { prime: bigint; index: number } {
      if (n < 2n) return { prime: 2n, index: 0 };

      ensureSieved(n + 1000n); // Look ahead a bit

      const idx = lowerBound(cachedPrimes, n);

      // lowerBound returns first index where prime >= n
      // If exact match, that's our prime. If not, it's the next prime.
      if (idx < cachedPrimes.length) {
        return { prime: cachedPrimes[idx], index: idx };
      }

      // Edge case: n is beyond our sieve, extend and retry
      ensureSieved(n * 2n);
      const newIdx = lowerBound(cachedPrimes, n);
      return { prime: cachedPrimes[newIdx], index: newIdx };
    },
  };
}

// Export singleton instance
export const sieveEngine = createSieveEngine();
