/**
 * Neighborhood computation service
 *
 * Core computation of prime neighborhoods with gaps, second differences, and ratios.
 * Mathematical model:
 *   - Gap: g_n = p_{n+1} - p_n
 *   - Second difference: d2 = g_n - g_{n-1}
 *   - Second ratio: r = d2 / (p_{n+1} - p_{n-1}), always in [-1, 1]
 */

import { sieveEngine } from './engines/sieve.js';
import type { Rational, NeighborhoodData, NType, NeighborhoodMode, IncludeField } from '../types/neighborhood.js';
import type { CanonicalRequest, NeighborhoodResult } from '../types/api.js';

export interface ComputeOptions {
  n: bigint;
  nType: NType;
  mode: NeighborhoodMode;
  k?: number;
  w?: bigint;
  include: IncludeField[];
}

/**
 * Compute GCD for reducing rationals
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
 * Create a reduced rational
 */
function rational(num: bigint, den: bigint): Rational {
  if (den === 0n) {
    throw new Error('Division by zero in rational');
  }

  // Ensure denominator is positive
  if (den < 0n) {
    num = -num;
    den = -den;
  }

  const g = gcd(num, den);
  return {
    num: (num / g).toString(),
    den: (den / g).toString(),
  };
}

/**
 * Compute prime neighborhood data
 */
export function computeNeighborhood(options: ComputeOptions): NeighborhoodData {
  const { n, nType, mode, k, w, include } = options;

  let centerIndex: number;
  let centerPrime: bigint;

  // Resolve center based on n_type
  if (nType === 'index') {
    centerIndex = Number(n);
    centerPrime = sieveEngine.primeAtIndex(centerIndex);
  } else {
    // n_type === 'value': find next prime >= n (not closest)
    // This ensures we always move forward from the given value
    const next = sieveEngine.nextPrime(n);
    centerIndex = next.index;
    centerPrime = next.prime;
  }

  let primes: bigint[];
  let indices: number[];

  // Get primes based on mode
  if (mode === 'count') {
    const kValue = k ?? 10;
    const result = sieveEngine.primesAroundIndex(centerIndex, kValue);
    primes = result.primes;
    indices = result.indices;
  } else {
    // mode === 'span'
    const wValue = w ?? 100n;
    const result = sieveEngine.primesAroundValue(centerPrime, wValue);
    primes = result.primes;
    indices = result.indices;
  }

  // Compute gaps: g[i] = p[i+1] - p[i]
  const gaps: bigint[] = [];
  for (let i = 0; i < primes.length - 1; i++) {
    gaps.push(primes[i + 1] - primes[i]);
  }

  // Compute second differences: d2[i] = g[i+1] - g[i] = (p[i+2] - p[i+1]) - (p[i+1] - p[i])
  const d2: bigint[] = [];
  for (let i = 0; i < gaps.length - 1; i++) {
    d2.push(gaps[i + 1] - gaps[i]);
  }

  // Compute ratios: r[i] = d2[i] / (p[i+2] - p[i])
  // Always in [-1, 1] since |d2| <= span
  const ratios: Rational[] = [];
  for (let i = 0; i < d2.length; i++) {
    const span = primes[i + 2] - primes[i];
    ratios.push(rational(d2[i], span));
  }

  return {
    centerIndex,
    centerPrime,
    primes,
    indices,
    gaps,
    d2,
    ratios,
  };
}

/**
 * Convert computation result to API response format
 */
export function toNeighborhoodResult(
  request: CanonicalRequest,
  data: NeighborhoodData
): NeighborhoodResult {
  const result: NeighborhoodResult = {
    n: request.n,
    n_type: request.n_type,
    mode: request.mode,
  };

  const include = new Set(request.include);

  // Always include center_prime
  result.center_prime = data.centerPrime.toString();

  if (include.has('primes')) {
    result.primes = data.primes.map((p) => p.toString());
  }

  if (include.has('gaps')) {
    result.gaps = data.gaps.map((g) => g.toString());
  }

  if (include.has('d2')) {
    result.d2 = data.d2.map((d) => d.toString());
  }

  if (include.has('ratio')) {
    result.ratio = data.ratios;
  }

  if (include.has('indices')) {
    result.indices = data.indices;
  }

  return result;
}

/**
 * Parse and normalize request parameters
 */
export function parseComputeOptions(request: CanonicalRequest): ComputeOptions {
  return {
    n: BigInt(request.n),
    nType: request.n_type,
    mode: request.mode,
    k: request.k,
    w: request.w ? BigInt(request.w) : undefined,
    include: request.include,
  };
}
