/**
 * Domain types for prime neighborhood computation
 */

/** Rational number representation for second ratios */
export interface Rational {
  num: string;  // Signed bigint string (numerator)
  den: string;  // Unsigned bigint string (denominator)
}

/** Measurement at a prime index - raw computation result */
export interface PrimeMeasurement {
  index: number;        // Index n in sequence of primes
  pPrev: bigint;        // p_{n-1}
  p: bigint;            // p_n (center prime)
  pNext: bigint;        // p_{n+1}
  gPrev: bigint;        // g_{n-1} = p_n - p_{n-1}
  g: bigint;            // g_n = p_{n+1} - p_n
  d2: bigint;           // Δ² = g_n - g_{n-1}
  span: bigint;         // p_{n+1} - p_{n-1}
  r: Rational;          // r = Δ² / span, always in [-1, 1]
}

/** Neighborhood data - computed prime sequences */
export interface NeighborhoodData {
  centerIndex: number;
  centerPrime: bigint;
  primes: bigint[];
  indices: number[];
  gaps: bigint[];       // unsigned gaps
  d2: bigint[];         // signed second differences
  ratios: Rational[];   // normalized ratios
}

/** Engine identifier for prime computation */
export type EngineType = 'auto' | 'sieve' | 'mr64' | 'bpsw' | 'mr-prob' | 'precomputed';

/** Validation mode for multi-engine verification */
export type ValidationMode = 'none' | 'dual' | 'triple';

/** Proof level */
export type ProofLevel = 'none' | 'receipt' | 'signed';

/** Output format */
export type OutputFormat = 'json' | 'bin';

/** Compression type */
export type CompressionType = 'none' | 'gzip' | 'zstd';

/** N-type: how to interpret the anchor value */
export type NType = 'index' | 'value';

/** Mode: how to determine neighborhood size */
export type NeighborhoodMode = 'count' | 'span';

/** Include flags for response */
export type IncludeField = 'primes' | 'gaps' | 'd2' | 'ratio' | 'indices';
