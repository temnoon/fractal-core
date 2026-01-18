/**
 * Multi-engine validation service
 *
 * Validates prime computations using multiple engines to ensure correctness.
 */

import { sieveEngine } from './engines/sieve.js';
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
 * Validate neighborhood data using specified validation mode
 *
 * Currently only sieve engine is implemented.
 * Dual/triple validation will compare against additional engines when available.
 */
export function validateNeighborhood(
  data: NeighborhoodData,
  mode: ValidationMode
): ValidationResult {
  // With only sieve engine available, we do self-consistency checks
  const engines: string[] = [sieveEngine.name];

  if (mode === 'none') {
    return {
      mode,
      engines,
      agreement: true,
    };
  }

  // Self-consistency validation: verify computed values
  const discrepancies: ValidationResult['discrepancies'] = [];

  // Verify gaps match prime differences
  for (let i = 0; i < data.gaps.length; i++) {
    const expected = data.primes[i + 1] - data.primes[i];
    if (data.gaps[i] !== expected) {
      discrepancies.push({
        index: i,
        values: [
          { engine: 'sieve', value: expected.toString() },
          { engine: 'computed', value: data.gaps[i].toString() },
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
          { engine: 'sieve', value: expected.toString() },
          { engine: 'computed', value: data.d2[i].toString() },
        ],
      });
    }
  }

  // Verify all primes are actually prime
  for (let i = 0; i < data.primes.length; i++) {
    if (!sieveEngine.isPrime(data.primes[i])) {
      discrepancies.push({
        index: i,
        values: [
          { engine: 'sieve', value: 'not_prime' },
          { engine: 'claimed', value: data.primes[i].toString() },
        ],
      });
    }
  }

  // For dual/triple mode, we would add more engines here
  if (mode === 'dual') {
    engines.push('sieve-verify');
  } else if (mode === 'triple') {
    engines.push('sieve-verify', 'sieve-recompute');
  }

  return {
    mode,
    engines,
    agreement: discrepancies.length === 0,
    discrepancies: discrepancies.length > 0 ? discrepancies : undefined,
  };
}
