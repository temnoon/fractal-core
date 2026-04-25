/**
 * Prime k-tuple / constellation support.
 *
 * A constellation is defined by its gap signature, e.g. twin primes [2],
 * sexy triplet [6,6], quadruplet [2,4,2]. Two capabilities here:
 *
 *   - detectConstellations: slide known patterns over an existing gap array
 *   - checkAdmissible: verify a signature covers no complete residue class
 *     mod any small prime (Hardy–Littlewood admissibility)
 */

import type { ConstellationMatch } from '../../types/api.js';

/** Built-in named patterns (gap-signature → human-readable name). */
export const KNOWN_PATTERNS: { name: string; signature: number[] }[] = [
  { name: 'twin', signature: [2] },
  { name: 'cousin', signature: [4] },
  { name: 'sexy', signature: [6] },
  { name: 'triplet_2_4', signature: [2, 4] },
  { name: 'triplet_4_2', signature: [4, 2] },
  { name: 'quadruplet', signature: [2, 4, 2] },
  { name: 'quintuplet_2_4_2_4', signature: [2, 4, 2, 4] },
  { name: 'quintuplet_4_2_4_2', signature: [4, 2, 4, 2] },
  { name: 'sexy_triplet', signature: [6, 6] },
  { name: 'sexy_quadruplet', signature: [6, 6, 6] },
  { name: 'prime_sextuplet', signature: [4, 2, 4, 2, 4] },
];

/**
 * Detect every occurrence of each known pattern inside `gaps`.
 *
 * Positions are indices into the underlying primes[] (not gaps[]): the
 * starting prime of the matched tuple.
 */
export function detectConstellations(gaps: bigint[]): ConstellationMatch[] {
  const matches: ConstellationMatch[] = [];

  for (const { name, signature } of KNOWN_PATTERNS) {
    if (signature.length > gaps.length) continue;
    const positions: number[] = [];
    for (let i = 0; i <= gaps.length - signature.length; i++) {
      let ok = true;
      for (let j = 0; j < signature.length; j++) {
        if (gaps[i + j] !== BigInt(signature[j])) {
          ok = false;
          break;
        }
      }
      if (ok) positions.push(i);
    }
    if (positions.length > 0) {
      matches.push({ pattern_name: name, signature, positions });
    }
  }

  return matches;
}

/**
 * Convert a gap signature into the offset pattern [0, g1, g1+g2, …].
 */
export function signatureToOffsets(signature: number[]): number[] {
  const offsets: number[] = [0];
  let acc = 0;
  for (const g of signature) {
    acc += g;
    offsets.push(acc);
  }
  return offsets;
}

/**
 * Admissibility check: a k-tuple with offset pattern O is admissible iff for
 * every prime q, O (mod q) does not hit every residue class. It suffices to
 * check primes q ≤ k (Hardy–Littlewood / Dickson). Returns the first blocking
 * prime as the `reason` when inadmissible.
 */
export function checkAdmissible(signature: number[]): {
  admissible: boolean;
  reason?: string;
  offsets: number[];
} {
  const offsets = signatureToOffsets(signature);
  const k = offsets.length;

  // Only primes q ≤ k can cover all residues
  const smallPrimes: number[] = [];
  for (let q = 2; q <= k; q++) {
    let isPrime = true;
    for (let d = 2; d * d <= q; d++) {
      if (q % d === 0) {
        isPrime = false;
        break;
      }
    }
    if (isPrime) smallPrimes.push(q);
  }

  for (const q of smallPrimes) {
    const seen = new Set<number>();
    for (const o of offsets) seen.add(((o % q) + q) % q);
    if (seen.size === q) {
      return {
        admissible: false,
        reason: `offsets cover every residue class mod ${q}`,
        offsets,
      };
    }
  }

  return { admissible: true, offsets };
}
