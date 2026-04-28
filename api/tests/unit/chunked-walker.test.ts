/**
 * Multi-chunk walker regression tests.
 *
 * The around-value walker must produce the same prime sequence regardless
 * of how many chunks the work is split across — including the corner cases
 * where a chunk finds zero primes (always true for 8K+ bit walks).
 *
 * We force multi-chunk behaviour by setting a tiny CHUNK_TIMEOUT_MS so the
 * walker bails out part-way through, then reload state and continue. The
 * primes found across all chunks must equal what a single-shot walk produces.
 */

import { describe, it, expect } from 'vitest';
import {
  createAroundValueState,
  createStatsState,
  processChunkAroundValue,
  processChunkStatsOnly,
  setChunkTimeoutMs,
  getChunkTimeoutMs,
  serializeState,
  deserializeState,
} from '../../src/services/chunked-sieve.js';

function runToCompletion(state: ReturnType<typeof createAroundValueState>, maxChunks = 200) {
  let chunks = 0;
  while (!state.completed && chunks < maxChunks) {
    processChunkAroundValue(state);
    chunks++;
  }
  return chunks;
}

describe('chunked around-value walker', () => {
  it('finds the same primes regardless of chunk count', () => {
    const center = 1_000_003n; // a prime
    const k = 5;

    // Reference: single big chunk.
    const original = getChunkTimeoutMs();
    setChunkTimeoutMs(60_000);
    const ref = createAroundValueState('ref', center, k);
    runToCompletion(ref);
    expect(ref.completed).toBe(true);
    expect(ref.beforePrimes!.length).toBe(k);
    expect(ref.afterPrimes!.length).toBe(k);

    // Stress: tight chunks. EMA prediction × 1.5 just barely exceeds the
    // chunk budget, so each chunk runs exactly one isPrime (the always-allow-
    // first-test rule) then bails.
    setChunkTimeoutMs(50);
    const stressed = createAroundValueState('stressed', center, k);
    stressed.isPrimeEmaMs = 1_000; // remaining ≪ 1500 → bail after first test
    const chunks = runToCompletion(stressed, 5_000);
    setChunkTimeoutMs(original);

    expect(stressed.completed).toBe(true);
    expect(chunks).toBeGreaterThan(1); // proved it actually multi-chunked
    expect(stressed.beforePrimes).toEqual(ref.beforePrimes);
    expect(stressed.afterPrimes).toEqual(ref.afterPrimes);
  });

  it('survives KV serialization round-trips between chunks', () => {
    const original = getChunkTimeoutMs();
    setChunkTimeoutMs(50);

    const center = 1_000_003n;
    let state = createAroundValueState('round-trip', center, 3);
    state.isPrimeEmaMs = 1_000;

    let chunks = 0;
    while (!state.completed && chunks < 200) {
      processChunkAroundValue(state);
      const json = serializeState(state);
      state = deserializeState(json);
      chunks++;
    }
    setChunkTimeoutMs(original);

    expect(state.completed).toBe(true);
    expect(state.primes.length).toBe(7); // k=3 each side + center
  });

  it('does not divide by zero when stats walk starts at p=2', () => {
    // Regression: at center=2, prevPrime(1) returns 2 forever, which used to
    // fill beforePrimes with k duplicate '2' strings. Forward replay then
    // produced span = p2 - p0 = 0 → BigInt 0/0 → "Division by zero".
    const original = getChunkTimeoutMs();
    setChunkTimeoutMs(60_000);
    const state = createStatsState('zero-walk', 2n, 50, true, true, true);
    let chunks = 0;
    while (!state.completed && chunks < 50) {
      processChunkStatsOnly(state);
      chunks++;
    }
    setChunkTimeoutMs(original);

    expect(state.completed).toBe(true);
    expect(state.totalGaps).toBeGreaterThan(0);
    expect(state.totalRatio).toBeGreaterThan(0);
    // The leading gap 2→3 should be present in the d2 frequency table.
    expect(state.countsGaps?.['1']).toBeDefined();
  });

  it('checkpoints pendingForwardCandidate when no prime found in a chunk', () => {
    const original = getChunkTimeoutMs();
    setChunkTimeoutMs(50);

    // Tiny budget + huge EMA → backward and forward each run one test then
    // bail. With 1_000_003 as center, the test on candidates 1_000_001 and
    // 1_000_005 will both be composite, so afterPrimes stays empty for at
    // least the first chunk and the walker must save pending state.
    const state = createAroundValueState('starved', 1_000_003n, 3);
    state.isPrimeEmaMs = 1_000;

    processChunkAroundValue(state);
    // Walker must save where to resume — exact prime counts vary because the
    // first-test-always rule may catch a prime on the first try.
    expect(
      state.pendingForwardCandidate !== undefined ||
        (state.afterPrimes ?? []).length > 0,
    ).toBe(true);

    setChunkTimeoutMs(original);
  });
});
