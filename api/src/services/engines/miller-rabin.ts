/**
 * Miller-Rabin Primality Test Engine
 *
 * Provides probabilistic primality testing for arbitrarily large numbers.
 * Uses deterministic witnesses for numbers up to 3,317,044,064,679,887,385,961,981
 * and falls back to probabilistic testing for larger numbers.
 */

export interface MillerRabinEngine {
  /** Check if value is prime */
  isPrime(n: bigint): boolean;

  /** Check if value is probably prime with k rounds */
  isProbablePrime(n: bigint, k?: number): boolean;

  /** Find next prime >= n */
  nextPrime(n: bigint): bigint;

  /** Find previous prime <= n */
  prevPrime(n: bigint): bigint;

  /** Get primes in range using Miller-Rabin (slower but works for large ranges) */
  primesInRange(start: bigint, end: bigint, limit?: number): bigint[];

  /** Engine identifier */
  readonly name: 'miller-rabin';
}

/**
 * Modular exponentiation: (base^exp) mod mod
 * Uses binary exponentiation for efficiency
 */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = (result * base) % mod;
    }
    exp = exp >> 1n;
    base = (base * base) % mod;
  }
  return result;
}

/**
 * Check if n is a strong probable prime to base a
 * (Witness test in Miller-Rabin)
 */
function isStrongProbablePrime(n: bigint, a: bigint): boolean {
  if (n < 2n) return false;
  if (n === 2n) return true;
  if (n % 2n === 0n) return false;

  // Write n-1 as 2^r * d where d is odd
  let d = n - 1n;
  let r = 0n;
  while (d % 2n === 0n) {
    d /= 2n;
    r++;
  }

  // Compute a^d mod n
  let x = modPow(a, d, n);

  if (x === 1n || x === n - 1n) {
    return true;
  }

  // Square r-1 times
  for (let i = 1n; i < r; i++) {
    x = (x * x) % n;
    if (x === n - 1n) {
      return true;
    }
    if (x === 1n) {
      return false;
    }
  }

  return false;
}

/**
 * Deterministic witnesses for various bounds
 * These witness sets guarantee correct results up to specified limits
 */
const WITNESS_SETS: { limit: bigint; witnesses: bigint[] }[] = [
  { limit: 2047n, witnesses: [2n] },
  { limit: 1373653n, witnesses: [2n, 3n] },
  { limit: 9080191n, witnesses: [31n, 73n] },
  { limit: 25326001n, witnesses: [2n, 3n, 5n] },
  { limit: 3215031751n, witnesses: [2n, 3n, 5n, 7n] },
  { limit: 4759123141n, witnesses: [2n, 7n, 61n] },
  { limit: 1122004669633n, witnesses: [2n, 13n, 23n, 1662803n] },
  { limit: 2152302898747n, witnesses: [2n, 3n, 5n, 7n, 11n] },
  { limit: 3474749660383n, witnesses: [2n, 3n, 5n, 7n, 11n, 13n] },
  { limit: 341550071728321n, witnesses: [2n, 3n, 5n, 7n, 11n, 13n, 17n] },
  { limit: 3825123056546413051n, witnesses: [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n] },
  {
    limit: 318665857834031151167461n,
    witnesses: [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n],
  },
  {
    limit: 3317044064679887385961981n,
    witnesses: [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n],
  },
];

/**
 * Get witnesses for deterministic Miller-Rabin test
 */
function getWitnesses(n: bigint): bigint[] {
  for (const { limit, witnesses } of WITNESS_SETS) {
    if (n < limit) {
      return witnesses;
    }
  }
  // For very large numbers, use the largest deterministic set
  // plus some additional random-ish witnesses based on n
  return [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n, 53n];
}

/**
 * Small primes for quick trial division
 */
const SMALL_PRIMES = [
  2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n, 53n, 59n, 61n, 67n, 71n,
  73n, 79n, 83n, 89n, 97n, 101n, 103n, 107n, 109n, 113n, 127n, 131n, 137n, 139n, 149n, 151n, 157n,
  163n, 167n, 173n, 179n, 181n, 191n, 193n, 197n, 199n, 211n, 223n, 227n, 229n, 233n, 239n, 241n,
  251n, 257n, 263n, 269n, 271n, 277n, 281n, 283n, 293n, 307n, 311n, 313n, 317n, 331n, 337n, 347n,
  349n, 353n, 359n, 367n, 373n, 379n, 383n, 389n, 397n, 401n, 409n, 419n, 421n, 431n, 433n, 439n,
  443n, 449n, 457n, 461n, 463n, 467n, 479n, 487n, 491n, 499n, 503n, 509n, 521n, 523n, 541n,
];

/**
 * Quick trial division with small primes
 */
function trialDivision(n: bigint): boolean | null {
  for (const p of SMALL_PRIMES) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  // No small factor found, need further testing
  return null;
}

/**
 * Create Miller-Rabin engine instance
 */
export function createMillerRabinEngine(): MillerRabinEngine {
  return {
    name: 'miller-rabin',

    isPrime(n: bigint): boolean {
      if (n < 2n) return false;
      if (n === 2n || n === 3n) return true;
      if (n % 2n === 0n) return false;

      // Try trial division first
      const trialResult = trialDivision(n);
      if (trialResult !== null) return trialResult;

      // Use deterministic witnesses
      const witnesses = getWitnesses(n);
      for (const a of witnesses) {
        if (a >= n) continue;
        if (!isStrongProbablePrime(n, a)) {
          return false;
        }
      }

      return true;
    },

    isProbablePrime(n: bigint, k: number = 20): boolean {
      if (n < 2n) return false;
      if (n === 2n || n === 3n) return true;
      if (n % 2n === 0n) return false;

      // Trial division
      const trialResult = trialDivision(n);
      if (trialResult !== null) return trialResult;

      // Use k random witnesses
      for (let i = 0; i < k; i++) {
        // Use deterministic "random" witnesses based on i and n
        const a = 2n + BigInt(i * 3) + (n % BigInt(100 + i));
        if (a >= n - 1n) continue;
        if (!isStrongProbablePrime(n, a < 2n ? 2n : a)) {
          return false;
        }
      }

      return true;
    },

    nextPrime(n: bigint): bigint {
      if (n <= 2n) return 2n;

      // Start from next odd number
      let candidate = n % 2n === 0n ? n + 1n : n;

      while (true) {
        if (this.isPrime(candidate)) {
          return candidate;
        }
        candidate += 2n;
      }
    },

    prevPrime(n: bigint): bigint {
      if (n <= 2n) return 2n;
      if (n === 3n) return 2n;

      // Start from previous odd number
      let candidate = n % 2n === 0n ? n - 1n : n;

      while (candidate > 2n) {
        if (this.isPrime(candidate)) {
          return candidate;
        }
        candidate -= 2n;
      }

      return 2n;
    },

    primesInRange(start: bigint, end: bigint, limit: number = 10000): bigint[] {
      if (start > end) return [];
      if (start < 2n) start = 2n;

      const primes: bigint[] = [];

      // Handle 2 specially
      if (start <= 2n && end >= 2n) {
        primes.push(2n);
        if (primes.length >= limit) return primes;
      }

      // Start from next odd number
      let candidate = start <= 3n ? 3n : start % 2n === 0n ? start + 1n : start;

      while (candidate <= end && primes.length < limit) {
        if (this.isPrime(candidate)) {
          primes.push(candidate);
        }
        candidate += 2n;
      }

      return primes;
    },
  };
}

// Export singleton instance
export const millerRabinEngine = createMillerRabinEngine();
