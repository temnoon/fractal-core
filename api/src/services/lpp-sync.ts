/**
 * LPP Synchronization Service
 *
 * Matches observed Δ² sequences to known prime positions.
 * Enables nodes to "lock on" to the pulse by pattern recognition.
 */

import { primeEngine } from './engines/index.js';
import type { SyncResult } from '../types/lpp.js';

// Cache of precomputed Δ² values for fast matching
// In production, this could be stored in KV or a database
const d2Cache: Map<number, number> = new Map();
const MAX_CACHE_INDEX = 100000; // Cache first 100k second differences

/**
 * Precompute and cache Δ² values for fast matching
 */
export function warmCache(maxIndex: number = MAX_CACHE_INDEX): void {
  if (d2Cache.size >= maxIndex) return;

  const startIndex = Math.max(2, d2Cache.size + 2);
  const batchSize = 1000;

  for (let i = startIndex; i <= maxIndex; i += batchSize) {
    const endIndex = Math.min(i + batchSize, maxIndex);
    const result = primeEngine.primesAroundIndex(i, endIndex - i + 2);
    const primes = result.primes;

    for (let j = 0; j < primes.length - 2; j++) {
      const g1 = primes[j + 1] - primes[j];
      const g2 = primes[j + 2] - primes[j + 1];
      const d2 = Number(g2 - g1);
      d2Cache.set(i + j, d2);
    }
  }
}

/**
 * Get Δ² at a specific index
 */
export function getD2AtIndex(index: number): number {
  if (d2Cache.has(index)) {
    return d2Cache.get(index)!;
  }

  // Compute on demand
  const result = primeEngine.primesAroundIndex(index - 1, 2);
  const primes = result.primes;

  if (primes.length < 3) return 0;

  const g1 = primes[1] - primes[0];
  const g2 = primes[2] - primes[1];
  return Number(g2 - g1);
}

/**
 * Get a sequence of Δ² values starting at an index
 */
export function getD2Sequence(startIndex: number, length: number): number[] {
  const sequence: number[] = [];
  for (let i = 0; i < length; i++) {
    sequence.push(getD2AtIndex(startIndex + i));
  }
  return sequence;
}

/**
 * Check if two sequences match within tolerance
 */
function sequencesMatch(a: number[], b: number[], tolerance: number): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
}

/**
 * Match an observed Δ² sequence to find position in prime sequence
 *
 * @param observed - Array of observed second differences
 * @param tolerance - Allowed deviation per value (for noisy observations)
 * @param searchRange - How many indices to search (default 100k)
 * @returns SyncResult with candidate positions and confidence
 */
export function matchD2Sequence(
  observed: number[],
  tolerance: number = 0,
  searchRange: number = MAX_CACHE_INDEX
): SyncResult {
  // Ensure cache is warm
  warmCache(searchRange);

  const candidates: number[] = [];
  const seqLength = observed.length;

  // Search through cached values
  for (let i = 2; i <= searchRange - seqLength; i++) {
    const dbSeq = getD2Sequence(i, seqLength);
    if (sequencesMatch(observed, dbSeq, tolerance)) {
      candidates.push(i);
    }
  }

  // Calculate confidence based on number of matches
  let confidence: number;
  if (candidates.length === 0) {
    confidence = 0;
  } else if (candidates.length === 1) {
    confidence = 0.99;
  } else if (candidates.length <= 3) {
    confidence = 0.95;
  } else if (candidates.length <= 10) {
    confidence = 0.8;
  } else if (candidates.length <= 50) {
    confidence = 0.6;
  } else {
    confidence = 0.3;
  }

  // Get next prime estimate if we have a unique match
  let nextPrime = '0';
  let nextGapEstimate = 0;
  if (candidates.length > 0) {
    const bestCandidate = candidates[0];
    const nextIndex = bestCandidate + seqLength;
    nextPrime = primeEngine.primeAtIndex(nextIndex).toString();

    // Estimate gap to next prime
    const currentPrime = primeEngine.primeAtIndex(nextIndex - 1);
    nextGapEstimate = Number(BigInt(nextPrime) - currentPrime);
  }

  return {
    candidates,
    confidence,
    next_prime: nextPrime,
    next_gap_estimate: nextGapEstimate,
    matched_at: new Date().toISOString(),
  };
}

/**
 * Reverse lookup: get Δ² sequence for a known prime index
 */
export function getSequenceAtPrime(primeIndex: number, length: number = 4): {
  index: number;
  prime: string;
  d2_sequence: number[];
  fingerprint: number[];
} {
  const prime = primeEngine.primeAtIndex(primeIndex);
  const d2Sequence = getD2Sequence(primeIndex, length);

  // Compute fingerprint (ratios)
  const result = primeEngine.primesAroundIndex(primeIndex - 1, length + 2);
  const primes = result.primes;

  const fingerprint: number[] = [];
  for (let i = 0; i < Math.min(length, primes.length - 2); i++) {
    const span = primes[i + 2] - primes[i];
    const d2 = d2Sequence[i];
    const ratio = d2 / Number(span);
    fingerprint.push(Math.round(ratio * 100) / 100);
  }

  return {
    index: primeIndex,
    prime: prime.toString(),
    d2_sequence: d2Sequence,
    fingerprint,
  };
}

/**
 * Compute hash of fingerprint for address generation
 */
export function fingerprintHash(fingerprint: number[]): string {
  // Simple hash: concatenate rounded values as hex
  const normalized = fingerprint.map(r => {
    const byte = Math.floor((r + 1) * 127.5); // Map [-1,1] to [0,255]
    return byte.toString(16).padStart(2, '0');
  });
  return normalized.join('');
}
