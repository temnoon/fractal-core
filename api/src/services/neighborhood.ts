/**
 * Neighborhood computation service
 *
 * Core computation of prime neighborhoods with gaps, second differences, and ratios.
 * Mathematical model:
 *   - Gap: g_n = p_{n+1} - p_n
 *   - Second difference: d2 = g_n - g_{n-1}
 *   - Second ratio: r = d2 / (p_{n+1} - p_{n-1}), always in [-1, 1]
 */

import { primeEngine } from './engines/index.js';
import type { Rational, NeighborhoodData, NType, NeighborhoodMode, IncludeField } from '../types/neighborhood.js';
import type {
  CanonicalRequest,
  NeighborhoodResult,
  ResidueRace,
  ThetaData,
  MaxRef,
  ConstellationMatch,
} from '../types/api.js';
import { lnBigInt, KahanSum } from './lib/precision.js';
import { detectConstellations } from './lib/constellations.js';

export interface ComputeOptions {
  n: bigint;
  nType: NType;
  mode: NeighborhoodMode;
  k?: number;
  w?: bigint;
  include: IncludeField[];
  modulus?: number;
}

/** Extra derived fields that don't fit in NeighborhoodData's bigint-centric shape. */
export interface NeighborhoodExtras {
  merit?: number[];
  maxMerit?: MaxRef;
  cramer?: number[];
  maxCramer?: MaxRef;
  residueRace?: ResidueRace;
  theta?: ThetaData;
  constellations?: ConstellationMatch[];
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

  let centerIndex: number | undefined;
  let centerPrime: bigint;

  // Resolve center based on n_type
  if (nType === 'index') {
    centerIndex = Number(n);
    centerPrime = primeEngine.primeAtIndex(centerIndex);
  } else {
    // n_type === 'value': find next prime >= n (not closest)
    // This ensures we always move forward from the given value
    const next = primeEngine.nextPrime(n);
    centerIndex = next.index; // undefined for primes beyond sieve range
    centerPrime = next.prime;
  }

  let primes: bigint[];
  let indices: number[];

  // Get primes based on mode
  if (mode === 'count') {
    const kValue = k ?? 10;
    if (centerIndex !== undefined) {
      // Have a valid index (within sieve range) — use index-based lookup
      const result = primeEngine.primesAroundIndex(centerIndex, kValue);
      primes = result.primes;
      indices = result.indices;
    } else {
      // Large prime beyond sieve range — use value-based lookup with BPSW
      const result = primeEngine.primesAroundValue(centerPrime, kValue);
      primes = result.primes;
      indices = result.indices ?? [];
    }
  } else {
    // mode === 'span'
    const wValue = w ?? 100n;
    const result = primeEngine.primesAroundValue(centerPrime, Number(wValue));
    primes = result.primes;
    indices = result.indices ?? [];
  }

  // Only compute sequences the caller requested.
  // Merit/Cramér and constellations also need gaps; ratio still implies gaps+d2.
  const inc = new Set(include);
  const needGaps =
    inc.has('gaps') ||
    inc.has('d2') ||
    inc.has('ratio') ||
    inc.has('merit') ||
    inc.has('cramer') ||
    inc.has('constellations');
  const needD2 = inc.has('d2') || inc.has('ratio');
  const needRatio = inc.has('ratio');

  // Compute gaps: g[i] = p[i+1] - p[i]
  const gaps: bigint[] = [];
  if (needGaps) {
    for (let i = 0; i < primes.length - 1; i++) {
      gaps.push(primes[i + 1] - primes[i]);
    }
  }

  // Compute second differences: d2[i] = g[i+1] - g[i]
  const d2: bigint[] = [];
  if (needD2) {
    for (let i = 0; i < gaps.length - 1; i++) {
      d2.push(gaps[i + 1] - gaps[i]);
    }
  }

  // Compute ratios: r[i] = d2[i] / (p[i+2] - p[i])
  const ratios: Rational[] = [];
  if (needRatio) {
    for (let i = 0; i < d2.length; i++) {
      const span = primes[i + 2] - primes[i];
      ratios.push(rational(d2[i], span));
    }
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
 * Compute the number-theory extras (merit, Cramér, residue races, theta,
 * constellations) from already-populated primes + gaps arrays. Each block is
 * gated on the corresponding `include` flag so unused work is skipped.
 */
export function computeNeighborhoodExtras(
  data: NeighborhoodData,
  include: IncludeField[],
  modulus?: number,
): NeighborhoodExtras {
  const inc = new Set(include);
  const extras: NeighborhoodExtras = {};
  const { primes, gaps } = data;

  // ── Merit + Cramér ──────────────────────────────────────────────────────
  // merit[i] = gaps[i] / ln(primes[i]); cramer[i] = gaps[i] / ln²(primes[i])
  const wantMerit = inc.has('merit');
  const wantCramer = inc.has('cramer');
  if ((wantMerit || wantCramer) && gaps.length > 0) {
    const merit: number[] = [];
    const cramer: number[] = [];
    let maxMerit: MaxRef = { value: -Infinity, index: -1 };
    let maxCramer: MaxRef = { value: -Infinity, index: -1 };

    for (let i = 0; i < gaps.length; i++) {
      const p = primes[i];
      const g = Number(gaps[i]);
      const lnP = lnBigInt(p);
      const m = g / lnP;
      const c = g / (lnP * lnP);
      merit.push(m);
      cramer.push(c);
      if (m > maxMerit.value) maxMerit = { value: m, index: i };
      if (c > maxCramer.value) maxCramer = { value: c, index: i };
    }

    if (wantMerit) {
      extras.merit = merit;
      if (maxMerit.index >= 0) extras.maxMerit = maxMerit;
    }
    if (wantCramer) {
      extras.cramer = cramer;
      if (maxCramer.index >= 0) extras.maxCramer = maxCramer;
    }
  }

  // ── Residue races ───────────────────────────────────────────────────────
  const wantResidue = inc.has('residue');
  const wantRunning = inc.has('residue_running');
  if ((wantResidue || wantRunning) && primes.length > 0) {
    const m = modulus && modulus >= 2 ? modulus : 4;
    const mBig = BigInt(m);
    const counts: Record<string, number> = {};
    const running: Record<string, number[]> = wantRunning ? {} : {};

    for (const p of primes) {
      const r = (p % mBig).toString();
      counts[r] = (counts[r] ?? 0) + 1;
      if (wantRunning) {
        if (!running[r]) running[r] = [];
      }
    }

    if (wantRunning) {
      // Build running cumulative series per residue class, parallel to primes[].
      const cum: Record<string, number> = {};
      for (const key of Object.keys(counts)) {
        cum[key] = 0;
        running[key] = new Array(primes.length).fill(0);
      }
      for (let i = 0; i < primes.length; i++) {
        const r = (primes[i] % mBig).toString();
        cum[r] = (cum[r] ?? 0) + 1;
        for (const key of Object.keys(running)) {
          running[key][i] = cum[key] ?? 0;
        }
      }
    }

    let leader = '';
    let best = -1;
    for (const [k, v] of Object.entries(counts)) {
      if (v > best) {
        best = v;
        leader = k;
      }
    }

    const race: ResidueRace = { modulus: m, counts, leader };
    if (wantRunning) race.running = running;
    extras.residueRace = race;
  }

  // ── Chebyshev theta ────────────────────────────────────────────────────
  if (inc.has('theta') && primes.length > 0) {
    const acc = new KahanSum();
    const values: number[] = [];
    for (const p of primes) {
      acc.add(lnBigInt(p));
      values.push(acc.value);
    }
    const lastPrime = primes[primes.length - 1];
    // PNT says θ(x) ~ x; compare to Number(p_last) with best-effort cast.
    const xApprox = Number(lastPrime);
    extras.theta = {
      values,
      total: acc.value,
      deviation: acc.value - xApprox,
    };
  }

  // ── Constellation detection (sync; operates on gaps already computed) ──
  if (inc.has('constellations') && gaps.length > 0) {
    extras.constellations = detectConstellations(gaps);
  }

  return extras;
}

/**
 * Convert computation result to API response format
 */
export function toNeighborhoodResult(
  request: CanonicalRequest,
  data: NeighborhoodData,
  extras?: NeighborhoodExtras,
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

  if (extras) {
    if (extras.merit) result.merit = extras.merit;
    if (extras.maxMerit) result.max_merit = extras.maxMerit;
    if (extras.cramer) result.cramer = extras.cramer;
    if (extras.maxCramer) result.max_cramer = extras.maxCramer;
    if (extras.residueRace) result.residue_race = extras.residueRace;
    if (extras.theta) result.theta = extras.theta;
    if (extras.constellations) result.constellations = extras.constellations;
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
    modulus: request.modulus,
  };
}
