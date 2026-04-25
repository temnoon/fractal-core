/**
 * Benchmark endpoint — empirical timing for primality engines.
 *
 * GET /api/v1/bench/isprime?bits=256,512,1024,2048&trials=5
 *   Times isPrime + nextPrime at each bit-width, returns
 *   per-call ms, ops/sec, and max single-call ms (the chunk-budget driver).
 */

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { bpswEngine } from '../services/engines/bpsw.js';

export const benchRoute = new Hono<{ Bindings: Env }>();

const DEFAULT_BITS = [256, 512, 1024, 2048];
const MAX_TRIALS = 20;
const MAX_BITS = 4096; // bench-ceiling — true 8K isPrime is its own endpoint

interface BenchRow {
  bits: number;
  trials: number;
  isprime_total_ms: number;
  isprime_avg_ms: number;
  isprime_max_ms: number;
  isprime_ops_per_sec: number;
  nextprime_total_ms: number;
  nextprime_avg_ms: number;
  nextprime_max_ms: number;
  candidates_per_call_avg: number;
}

/**
 * Build a deterministic-but-varied probable-prime seed at b bits, large odd.
 * Math.random isn't viable in Workers; use crypto for the seed.
 */
function seedAtBits(b: number): bigint {
  // Top bit set, bottom bit set → odd, and ≥ 2^(b-1).
  const bytes = new Uint8Array(Math.ceil(b / 8));
  crypto.getRandomValues(bytes);
  let n = 0n;
  for (const x of bytes) n = (n << 8n) | BigInt(x);
  // Mask to exactly b bits
  n = n & ((1n << BigInt(b)) - 1n);
  n = n | (1n << BigInt(b - 1));
  if (n % 2n === 0n) n += 1n;
  return n;
}

function benchOne(bits: number, trials: number): BenchRow {
  let isprimeTotal = 0;
  let isprimeMax = 0;
  let nextTotal = 0;
  let nextMax = 0;
  let totalCandidates = 0;

  for (let t = 0; t < trials; t++) {
    const n = seedAtBits(bits);

    // isPrime — single call timing
    const t0 = performance.now();
    bpswEngine.isPrime(n);
    const dt = performance.now() - t0;
    isprimeTotal += dt;
    if (dt > isprimeMax) isprimeMax = dt;

    // nextPrime — counts wheel-coprime candidates evaluated
    const t1 = performance.now();
    const found = bpswEngine.nextPrime(n + 1n);
    const dt2 = performance.now() - t1;
    nextTotal += dt2;
    if (dt2 > nextMax) nextMax = dt2;
    // Approximate candidates from gap; underestimates slightly because
    // wheel skips composites without testing.
    totalCandidates += Number((found - n) / 2n);
  }

  return {
    bits,
    trials,
    isprime_total_ms: round(isprimeTotal),
    isprime_avg_ms: round(isprimeTotal / trials),
    isprime_max_ms: round(isprimeMax),
    isprime_ops_per_sec: round(1000 * trials / isprimeTotal),
    nextprime_total_ms: round(nextTotal),
    nextprime_avg_ms: round(nextTotal / trials),
    nextprime_max_ms: round(nextMax),
    candidates_per_call_avg: round(totalCandidates / trials),
  };
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

benchRoute.get('/isprime', (c) => {
  const bitsParam = c.req.query('bits');
  const trials = Math.min(MAX_TRIALS, Math.max(1, parseInt(c.req.query('trials') || '3', 10)));
  let bits: number[];
  if (bitsParam) {
    bits = bitsParam.split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n >= 8 && n <= MAX_BITS);
  } else {
    bits = DEFAULT_BITS;
  }
  if (bits.length === 0) return c.json({ error: `bits must be CSV of integers in [8, ${MAX_BITS}]` }, 400);

  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const rows = bits.map((b) => benchOne(b, trials));
  const wallMs = round(performance.now() - t0);

  return c.json({
    started_at: startedAt,
    wall_ms: wallMs,
    engine: 'bpsw',
    wheel_base: 30030,
    note: 'isprime_max_ms is the chunk-budget driver — keep CHUNK_TIMEOUT_MS > isprime_max_ms × 2',
    rows,
  });
});
