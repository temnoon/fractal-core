/**
 * GET /api/v1/isprime?n=<bigint>&verbose=1&audit_level=detail
 *
 * Explicit primality test for a user-supplied integer. The metering unit
 * for the eventual pricing model is "isPrime calls" (bucketed by bit width),
 * so this endpoint exists as the cleanest path to that signal:
 *
 *   - small (≤ 2048 bits): sync, returns immediately with audit log if asked
 *   - medium (≤ 8192 bits): sync still; native BigInt fits within Workers CPU
 *   - large (> 8192 bits):  queued as a chunked job (foundation only here)
 *
 * Empirical timings from `scripts/bench-modpow.mjs`:
 *   2048 bits → 11ms native modPow → ~25ms total isPrime (BPSW)
 *   4096      → ~80ms              → ~200ms
 *   8192      → ~600ms             → ~1.5s
 *  16384      → ~5s                → ~12s   (still inside 30s default cap)
 *  32768      → ~40s               → chunked-async required
 */

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { bpswEngine } from '../services/engines/bpsw.js';
import { withAuditSync, type AuditLevel } from '../services/lib/audit.js';
import { withMeter } from '../services/lib/op-meter.js';

export const isPrimeRoute = new Hono<{ Bindings: Env }>();

/** Hard cap on the synchronous path. Above this, queue async. */
const SYNC_BIT_LIMIT = 16_384;

function bitsOf(n: bigint): number {
  if (n <= 0n) return 0;
  return n.toString(2).length;
}

isPrimeRoute.get('/', (c) => {
  const raw = c.req.query('n');
  if (!raw) return c.json({ error: 'missing required parameter: n' }, 400);

  let n: bigint;
  try {
    n = BigInt(raw);
  } catch {
    return c.json({ error: 'n must be a valid integer (bigint string)' }, 400);
  }
  if (n < 2n) return c.json({ n: raw, bits: 0, prime: false, reason: 'n < 2' });

  const bits = bitsOf(n);
  if (bits > SYNC_BIT_LIMIT) {
    return c.json({
      error: `n is ${bits} bits — exceeds synchronous cap of ${SYNC_BIT_LIMIT}`,
      message: 'Async chunked primality testing for primes above 16K bits is not yet implemented. Reduce n or wait for the next release.',
      bits,
      n: raw,
    }, 413);
  }

  const verbose = c.req.query('verbose') === '1' || c.req.query('verbose') === 'true';
  const auditLevel = (c.req.query('audit_level') ?? 'milestone') as AuditLevel;

  const t0 = performance.now();
  const meterRun = withMeter(() =>
    withAuditSync({ enabled: verbose, level: auditLevel }, () => bpswEngine.isPrime(n)),
  );
  const wallMs = Math.round((performance.now() - t0) * 1000) / 1000;

  c.set('opCounters', meterRun.counters);

  const body: Record<string, unknown> = {
    n: n.toString(),
    bits,
    prime: meterRun.result.result,
    wall_ms: wallMs,
    engine: 'bpsw',
    ops: meterRun.counters,
  };
  if (verbose) {
    body.audit = meterRun.result.events;
    if (meterRun.result.truncated) body.audit_truncated = true;
  }
  return c.json(body);
});
