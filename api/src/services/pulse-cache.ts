/**
 * Pulse Cache
 *
 * For systems with mint_cadence='one-per-tick' (Tonga, Yad), the first mint
 * at a given tick T generates the prime; subsequent mints during the same
 * tick return the same (T, prime) pair from cache.
 *
 * Cache key:  pulse:{system_id}:{T}
 * Cache TTL:  10 × tick_unit_seconds (with floor of 60s, ceiling of 7 days)
 * Storage:    LPP_KV (already bound; no migration needed)
 */

import type { MintedPulse, TimeSystemDescriptor } from '../types/pulse.js';

const KEY_PREFIX = 'pulse';
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 7 * 86400;

interface CachedEntry {
  pulse: MintedPulse;
  cached_at_iso: string;
}

function cacheKey(system_id: string, tick: bigint): string {
  return `${KEY_PREFIX}:${system_id}:${tick.toString()}`;
}

function ttlForSystem(system: TimeSystemDescriptor): number {
  const ideal = system.tick_unit_seconds * 10;
  return Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS, Math.round(ideal)));
}

/**
 * Read a cached pulse for (system, tick), or null if absent.
 * KV failures are non-fatal: returns null and the caller mints fresh.
 */
export async function readCachedPulse(
  kv: KVNamespace | undefined,
  system: TimeSystemDescriptor,
  tick: bigint
): Promise<MintedPulse | null> {
  if (!kv) return null;
  try {
    const raw = await kv.get(cacheKey(system.id, tick));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CachedEntry;
    return entry.pulse;
  } catch {
    return null;
  }
}

/**
 * Write a freshly minted pulse to the cache. Best-effort; failures swallowed.
 */
export async function writeCachedPulse(
  kv: KVNamespace | undefined,
  system: TimeSystemDescriptor,
  tick: bigint,
  pulse: MintedPulse
): Promise<void> {
  if (!kv) return;
  try {
    const entry: CachedEntry = {
      pulse,
      cached_at_iso: new Date().toISOString(),
    };
    await kv.put(cacheKey(system.id, tick), JSON.stringify(entry), {
      expirationTtl: ttlForSystem(system),
    });
  } catch {
    // best-effort
  }
}

export const _internal = {
  cacheKey,
  ttlForSystem,
};
