/**
 * Per-request operation counters for primality work.
 *
 * The audit log captures *what* happened; the op-meter captures *how many
 * billable ops* happened. Both share the same AsyncLocalStorage trick to stay
 * concurrent-safe across requests in a single Workers isolate.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { OpCounters } from '../../types/user.js';

const BIG_PRIME_BITS = 2048;

const storage = new AsyncLocalStorage<OpCounters>();

export function withMeter<T>(fn: () => T): { result: T; counters: OpCounters } {
  const counters: OpCounters = {
    isprime_total: 0,
    nextprime_total: 0,
    big_isprime_total: 0,
    isprime_bit_calls: 0,
  };
  return storage.run(counters, () => {
    const result = fn();
    return { result, counters };
  });
}

export function recordIsPrime(bits: number): void {
  const c = storage.getStore();
  if (!c) return;
  c.isprime_total += 1;
  c.isprime_bit_calls += bits;
  if (bits >= BIG_PRIME_BITS) c.big_isprime_total += 1;
}

export function recordNextPrime(): void {
  const c = storage.getStore();
  if (!c) return;
  c.nextprime_total += 1;
}

/** Combine two counter records (for periodic accumulation in KV). */
export function mergeCounters(a: OpCounters | undefined, b: OpCounters): OpCounters {
  const base = a ?? {
    isprime_total: 0,
    nextprime_total: 0,
    big_isprime_total: 0,
    isprime_bit_calls: 0,
  };
  return {
    isprime_total: base.isprime_total + b.isprime_total,
    nextprime_total: base.nextprime_total + b.nextprime_total,
    big_isprime_total: base.big_isprime_total + b.big_isprime_total,
    isprime_bit_calls: base.isprime_bit_calls + b.isprime_bit_calls,
  };
}
