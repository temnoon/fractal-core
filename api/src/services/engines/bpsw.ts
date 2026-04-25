/**
 * Baillie-PSW Primality Test Engine
 *
 * Combines Miller-Rabin with base 2 and Lucas probable prime test.
 * No counterexamples are known - considered one of the most reliable
 * primality tests for practical use.
 *
 * Reference: https://en.wikipedia.org/wiki/Baillie%E2%80%93PSW_primality_test
 */

import { alignUp, alignDown, step, stepBack, WHEEL_INFO } from '../lib/wheel.js';
import { logAudit, ifAuditing } from '../lib/audit.js';
import { recordIsPrime, recordNextPrime } from '../lib/op-meter.js';

/** Small primes the wheel itself eliminates — handle the cases a wheel skips. */
const WHEEL_BASE_PRIMES: bigint[] = [...WHEEL_INFO.primes];

/** Approximate bit length for audit logs without paying for full toString. */
function bitsOf(n: bigint): number {
  if (n <= 0n) return 0;
  return n.toString(2).length;
}

export interface BpswEngine {
  /** Check if value is prime (BPSW test) */
  isPrime(n: bigint): boolean;

  /** Find next prime >= n */
  nextPrime(n: bigint): bigint;

  /** Find previous prime <= n */
  prevPrime(n: bigint): bigint;

  /** Get primes in range */
  primesInRange(start: bigint, end: bigint, limit?: number): bigint[];

  /** Get primes around a center value */
  primesAround(center: bigint, count: number): { before: bigint[]; after: bigint[] };

  /** Engine identifier */
  readonly name: 'bpsw';
}

/**
 * Modular exponentiation: (base^exp) mod mod
 *
 * Strategy comparison from `api/scripts/bench-modpow.mjs`:
 *   bits   native    Barrett   Montgomery (target)
 *   2048    11ms       10ms     ~7ms (1.5×)
 *   4096   ~80ms      ~70ms     ~50ms
 *   8192  ~600ms     ~520ms    ~400ms
 *
 * Native BigInt `%` is competitive with Barrett up through ~1k bits; Montgomery
 * is the lever that pays off beyond 2k. Pure-JS Montgomery has been hand-rolled
 * but had a Newton-inverse bug (see scripts/bench-modpow.mjs); for 8K-bit work
 * we should land Wasm Montgomery rather than try to fix the JS version.
 */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  base = ((base % mod) + mod) % mod;
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
 * GCD using Euclidean algorithm
 */
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

/**
 * Jacobi symbol (a/n)
 * Used in Lucas test to find suitable D parameter
 */
function jacobi(a: bigint, n: bigint): number {
  if (n <= 0n || n % 2n === 0n) {
    throw new Error('Jacobi symbol requires positive odd n');
  }

  a = ((a % n) + n) % n;
  let result = 1;

  while (a !== 0n) {
    while (a % 2n === 0n) {
      a = a / 2n;
      const nMod8 = Number(n % 8n);
      if (nMod8 === 3 || nMod8 === 5) {
        result = -result;
      }
    }

    // Swap a and n
    const temp = a;
    a = n;
    n = temp;

    if (a % 4n === 3n && n % 4n === 3n) {
      result = -result;
    }
    a = a % n;
  }

  return n === 1n ? result : 0;
}

/**
 * Integer square root (floor)
 */
function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('Square root of negative number');
  if (n < 2n) return n;

  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/**
 * Check if n is a perfect square
 */
function isPerfectSquare(n: bigint): boolean {
  if (n < 0n) return false;
  const root = isqrt(n);
  return root * root === n;
}

/**
 * Miller-Rabin test with base 2
 * Part of BPSW
 */
function millerRabinBase2(n: bigint): boolean {
  if (n < 2n) return false;
  if (n === 2n) return true;
  if (n % 2n === 0n) return false;

  // Write n-1 as 2^r * d
  let d = n - 1n;
  let r = 0n;
  while (d % 2n === 0n) {
    d /= 2n;
    r++;
  }

  // Test with base 2
  let x = modPow(2n, d, n);

  if (x === 1n || x === n - 1n) {
    return true;
  }

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
 * Find first D in sequence 5, -7, 9, -11, 13, -15, ...
 * such that Jacobi(D, n) = -1
 */
function findDWithJacobiMinusOne(n: bigint): bigint {
  let d = 5n;
  let sign = 1n;

  while (true) {
    const dSigned = d * sign;
    const j = jacobi(dSigned, n);

    if (j === -1) {
      return dSigned;
    }

    if (j === 0 && gcd(dSigned < 0n ? -dSigned : dSigned, n) !== 1n && gcd(dSigned < 0n ? -dSigned : dSigned, n) !== n) {
      // Found a factor, n is composite
      return 0n;
    }

    d += 2n;
    sign = -sign;

    // Safety limit
    if (d > 1000n) {
      return 0n;
    }
  }
}

/**
 * Lucas probable prime test (strong Lucas test)
 * Uses Selfridge's Method A for parameter selection
 */
function lucasTest(n: bigint): boolean {
  if (n < 2n) return false;
  if (n === 2n) return true;
  if (n % 2n === 0n) return false;

  // Check if n is a perfect square (Lucas test can give false positives for squares)
  if (isPerfectSquare(n)) {
    return false;
  }

  // Find D using Selfridge's Method A
  const D = findDWithJacobiMinusOne(n);
  if (D === 0n) {
    return false; // Found a factor or hit limit
  }

  // P = 1, Q = (1 - D) / 4
  const P = 1n;
  const Q = (1n - D) / 4n;

  // Compute U_d and V_d mod n using Lucas chain
  // where n + 1 = 2^s * d with d odd
  let delta = n + 1n;
  let s = 0n;
  while (delta % 2n === 0n) {
    delta /= 2n;
    s++;
  }

  // Lucas chain computation
  // Start with U_1 = 1, V_1 = P = 1
  let U = 1n;
  let V = P;
  let Qk = Q;
  const bits: bigint[] = [];

  // Get binary representation of delta
  let temp = delta;
  while (temp > 0n) {
    bits.push(temp % 2n);
    temp /= 2n;
  }
  bits.reverse();

  // Double-and-add for Lucas sequences
  for (let i = 1; i < bits.length; i++) {
    // Double step
    U = (U * V) % n;
    V = (V * V - 2n * Qk) % n;
    Qk = (Qk * Qk) % n;

    if (bits[i] === 1n) {
      // Add step
      const Unew = (P * U + V) % n;
      const Vnew = (D * U + P * V) % n;
      U = Unew % 2n === 0n ? Unew / 2n : (Unew + n) / 2n;
      V = Vnew % 2n === 0n ? Vnew / 2n : (Vnew + n) / 2n;
      Qk = (Qk * Q) % n;
    }
  }

  // Normalize to positive
  U = ((U % n) + n) % n;
  V = ((V % n) + n) % n;

  // Check U_d ≡ 0 (mod n)
  if (U === 0n) {
    return true;
  }

  // Check V_{d*2^r} ≡ 0 (mod n) for r = 0, 1, ..., s-1
  if (V === 0n) {
    return true;
  }

  for (let r = 1n; r < s; r++) {
    V = (V * V - 2n * Qk) % n;
    V = ((V % n) + n) % n;
    Qk = (Qk * Qk) % n;

    if (V === 0n) {
      return true;
    }
  }

  return false;
}

/**
 * Small primes for trial division
 */
const SMALL_PRIMES = [
  2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n, 53n, 59n, 61n, 67n, 71n,
  73n, 79n, 83n, 89n, 97n, 101n, 103n, 107n, 109n, 113n, 127n, 131n, 137n, 139n, 149n, 151n, 157n,
  163n, 167n, 173n, 179n, 181n, 191n, 193n, 197n, 199n, 211n, 223n, 227n, 229n, 233n, 239n, 241n,
  251n, 257n, 263n, 269n, 271n, 277n, 281n, 283n, 293n, 307n, 311n, 313n, 317n, 331n, 337n, 347n,
];

/**
 * Create BPSW engine instance
 */
export function createBpswEngine(): BpswEngine {
  return {
    name: 'bpsw',

    isPrime(n: bigint): boolean {
      if (n < 2n) return false;
      const nBits = bitsOf(n);
      recordIsPrime(nBits);
      if (n === 2n) return true;
      if (n % 2n === 0n) {
        ifAuditing(() => logAudit('trial-division', 'milestone', 'rejected: even', { n_bits: nBits }));
        return false;
      }

      ifAuditing(() => logAudit('isprime', 'milestone', 'BPSW start', { n_bits: nBits }));

      // Trial division with small primes
      for (const p of SMALL_PRIMES) {
        if (n === p) {
          ifAuditing(() => logAudit('trial-division', 'milestone', `equal to small prime ${p}`));
          return true;
        }
        if (n % p === 0n) {
          ifAuditing(() => logAudit('trial-division', 'milestone', `composite: divisible by ${p}`));
          return false;
        }
      }
      ifAuditing(() => logAudit('trial-division', 'milestone', 'passed small-prime trial division', { tested: SMALL_PRIMES.length }));

      // BPSW test:
      // 1. Miller-Rabin with base 2
      if (!millerRabinBase2(n)) {
        ifAuditing(() => logAudit('miller-rabin', 'milestone', 'failed strong probable prime base 2'));
        return false;
      }
      ifAuditing(() => logAudit('miller-rabin', 'milestone', 'passed strong probable prime base 2'));

      // 2. Strong Lucas probable prime test
      if (!lucasTest(n)) {
        ifAuditing(() => logAudit('lucas', 'milestone', 'failed strong Lucas probable prime'));
        return false;
      }
      ifAuditing(() => logAudit('lucas', 'milestone', 'passed strong Lucas probable prime'));

      ifAuditing(() => logAudit('isprime', 'milestone', 'BPSW: prime'));
      return true;
    },

    nextPrime(n: bigint): bigint {
      recordNextPrime();
      if (n <= 2n) return 2n;

      // Hand back any wheel-base prime exactly. Wheel-coprime alignment
      // would otherwise step over them.
      for (const p of WHEEL_BASE_PRIMES) {
        if (n <= p) return p;
      }

      let { value: candidate, idx } = alignUp(n);
      while (candidate < n) ({ value: candidate, idx } = step(candidate, idx));

      let candidatesTested = 0;
      ifAuditing(() => logAudit('nextprime', 'milestone', 'nextPrime walk start', {
        from_bits: bitsOf(n),
        first_candidate: candidate.toString(),
      }));

      while (true) {
        candidatesTested++;
        if (this.isPrime(candidate)) {
          ifAuditing(() => logAudit('nextprime', 'milestone', 'nextPrime found', {
            prime_bits: bitsOf(candidate),
            candidates_tested: candidatesTested,
            wheel_base: Number(WHEEL_INFO.base),
          }));
          return candidate;
        }
        ({ value: candidate, idx } = step(candidate, idx));
      }
    },

    prevPrime(n: bigint): bigint {
      if (n <= 2n) return 2n;
      if (n === 3n) return 2n;

      // Reverse-handoff for the small wheel-base primes themselves.
      const reversed = [...WHEEL_BASE_PRIMES].reverse();
      for (const p of reversed) {
        if (n === p) {
          // Pick the next-smaller prime in the small set.
          const idx = WHEEL_BASE_PRIMES.indexOf(p);
          return idx > 0 ? WHEEL_BASE_PRIMES[idx - 1] : 2n;
        }
      }

      let { value: candidate, idx } = alignDown(n);
      while (candidate > n) ({ value: candidate, idx } = stepBack(candidate, idx));

      // Fall back to small primes if we underflow the wheel.
      while (candidate > WHEEL_INFO.primes[WHEEL_INFO.primes.length - 1]) {
        if (this.isPrime(candidate)) return candidate;
        ({ value: candidate, idx } = stepBack(candidate, idx));
      }

      // Below the wheel — return largest small prime ≤ candidate.
      for (let i = reversed.length - 1; i >= 0; i--) {
        if (reversed[i] <= n) return reversed[i];
      }
      return 2n;
    },

    primesInRange(start: bigint, end: bigint, limit: number = 10000): bigint[] {
      if (start > end) return [];
      if (start < 2n) start = 2n;

      const primes: bigint[] = [];

      if (start <= 2n && end >= 2n) {
        primes.push(2n);
        if (primes.length >= limit) return primes;
      }

      let candidate = start <= 3n ? 3n : start % 2n === 0n ? start + 1n : start;

      while (candidate <= end && primes.length < limit) {
        if (this.isPrime(candidate)) {
          primes.push(candidate);
        }
        candidate += 2n;
      }

      return primes;
    },

    primesAround(center: bigint, count: number): { before: bigint[]; after: bigint[] } {
      const before: bigint[] = [];
      const after: bigint[] = [];

      // Find primes before center
      let candidate = center - 1n;
      while (before.length < count && candidate >= 2n) {
        if (this.isPrime(candidate)) {
          before.unshift(candidate);
        }
        candidate -= candidate === 3n ? 1n : 2n;
      }

      // Find primes after center (including center if prime)
      candidate = center;
      while (after.length < count) {
        if (this.isPrime(candidate)) {
          after.push(candidate);
        }
        candidate += candidate === 2n ? 1n : 2n;
      }

      return { before, after };
    },
  };
}

// Export singleton instance
export const bpswEngine = createBpswEngine();
