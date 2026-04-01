/**
 * Multi-engine validation service
 *
 * Validates prime computations using multiple engines to ensure correctness.
 * - Sieve: Fast for small primes (up to 10 million)
 * - Miller-Rabin: Deterministic for primes up to ~10^24
 * - BPSW: Most reliable probabilistic test (no known counterexamples)
 */

import { primeEngine, millerRabinEngine, bpswEngine, sieveEngine } from './engines/index.js';
import type { NeighborhoodData } from '../types/neighborhood.js';
import type { ValidationMode } from '../types/neighborhood.js';

export interface ValidationResult {
  mode: ValidationMode;
  engines: string[];
  agreement: boolean;
  discrepancies?: {
    index: number;
    values: { engine: string; value: string }[];
  }[];
}

/**
 * Check if a value is prime using the specified engine
 */
function isPrimeWithEngine(n: bigint, engine: string): boolean {
  switch (engine) {
    case 'sieve':
      return sieveEngine.isPrime(n);
    case 'miller-rabin':
      return millerRabinEngine.isPrime(n);
    case 'bpsw':
      return bpswEngine.isPrime(n);
    default:
      return primeEngine.isPrime(n);
  }
}

/**
 * Validate neighborhood data using specified validation mode
 *
 * - none: No validation, return immediately
 * - dual: Cross-validate using sieve + Miller-Rabin
 * - triple: Cross-validate using sieve + Miller-Rabin + BPSW
 */
export function validateNeighborhood(
  data: NeighborhoodData,
  mode: ValidationMode
): ValidationResult {
  if (mode === 'none') {
    return {
      mode,
      engines: ['auto'],
      agreement: true,
    };
  }

  const discrepancies: ValidationResult['discrepancies'] = [];

  // Self-consistency checks first
  // Verify gaps match prime differences
  for (let i = 0; i < data.gaps.length; i++) {
    const expected = data.primes[i + 1] - data.primes[i];
    if (data.gaps[i] !== expected) {
      discrepancies.push({
        index: i,
        values: [
          { engine: 'computed-gap', value: expected.toString() },
          { engine: 'stored-gap', value: data.gaps[i].toString() },
        ],
      });
    }
  }

  // Verify d2 matches gap differences
  for (let i = 0; i < data.d2.length; i++) {
    const expected = data.gaps[i + 1] - data.gaps[i];
    if (data.d2[i] !== expected) {
      discrepancies.push({
        index: i,
        values: [
          { engine: 'computed-d2', value: expected.toString() },
          { engine: 'stored-d2', value: data.d2[i].toString() },
        ],
      });
    }
  }

  // Determine which engines to use based on mode
  const engines: string[] = [];

  if (mode === 'dual') {
    engines.push('sieve', 'miller-rabin');
  } else if (mode === 'triple') {
    engines.push('sieve', 'miller-rabin', 'bpsw');
  }

  // Cross-validate primality using multiple engines
  const SIEVE_LIMIT = 10_000_000n;

  for (let i = 0; i < data.primes.length; i++) {
    const p = data.primes[i];
    const results: { engine: string; isPrime: boolean }[] = [];

    for (const engine of engines) {
      // Sieve only works for small primes
      if (engine === 'sieve' && p > SIEVE_LIMIT) {
        continue;
      }

      const isPrime = isPrimeWithEngine(p, engine);
      results.push({ engine, isPrime });
    }

    // Check if all engines agree
    const allTrue = results.every((r) => r.isPrime);
    const allFalse = results.every((r) => !r.isPrime);

    if (!allTrue && !allFalse && results.length > 1) {
      discrepancies.push({
        index: i,
        values: results.map((r) => ({
          engine: r.engine,
          value: r.isPrime ? 'prime' : 'not_prime',
        })),
      });
    }

    if (results.length > 0 && !allTrue) {
      discrepancies.push({
        index: i,
        values: [
          { engine: 'claimed', value: p.toString() },
          ...results.map((r) => ({
            engine: r.engine,
            value: r.isPrime ? 'prime' : 'not_prime',
          })),
        ],
      });
    }
  }

  return {
    mode,
    engines,
    agreement: discrepancies.length === 0,
    discrepancies: discrepancies.length > 0 ? discrepancies : undefined,
  };
}

/**
 * Validate a single prime using all available engines
 */
export function validatePrime(n: bigint): {
  isPrime: boolean;
  engines: { name: string; result: boolean; supported: boolean }[];
} {
  const SIEVE_LIMIT = 10_000_000n;

  const engines = [
    {
      name: 'sieve',
      supported: n <= SIEVE_LIMIT,
      result: n <= SIEVE_LIMIT ? sieveEngine.isPrime(n) : false,
    },
    {
      name: 'miller-rabin',
      supported: true,
      result: millerRabinEngine.isPrime(n),
    },
    {
      name: 'bpsw',
      supported: true,
      result: bpswEngine.isPrime(n),
    },
  ];

  // Use BPSW as the authoritative answer
  const isPrime = bpswEngine.isPrime(n);

  return { isPrime, engines };
}
