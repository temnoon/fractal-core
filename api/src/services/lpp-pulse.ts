/**
 * LPP Pulse Service
 *
 * Manages the pulse epoch, generates pulse events, and computes fingerprints.
 * The pulse is the heartbeat of the Lamish Pulse Protocol.
 */

import { primeEngine } from './engines/index.js';
import { saveEpoch, loadEpoch } from './lpp-storage.js';
import type { PulseEpoch, PulseEvent, Residue, ResidueResponse, ChannelScheduleEntry } from '../types/lpp.js';
import { RESIDUE_MAP } from '../types/lpp.js';

// Default pulse interval: 1 second
const DEFAULT_INTERVAL_MS = 1000;

// Current epoch state (cached in memory, persisted to KV)
let currentEpoch: PulseEpoch | null = null;
let epochStartTime: number = 0;
let initialized: boolean = false;

/**
 * Initialize epoch from storage or create new
 */
export async function initializeEpoch(intervalMs: number = DEFAULT_INTERVAL_MS): Promise<PulseEpoch> {
  if (initialized && currentEpoch) {
    return currentEpoch;
  }

  // Try to load from KV
  const stored = await loadEpoch();
  if (stored) {
    currentEpoch = stored;
    epochStartTime = new Date(stored.started_at).getTime();
    initialized = true;
    return currentEpoch;
  }

  // Create new epoch
  return createNewEpoch(intervalMs);
}

/**
 * Create a new epoch (and persist it)
 */
async function createNewEpoch(intervalMs: number): Promise<PulseEpoch> {
  const now = new Date();
  currentEpoch = {
    epoch_id: `epoch_${now.toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`,
    started_at: now.toISOString(),
    interval_ms: intervalMs,
    origin_domain: 'fractal-core.com',
  };
  epochStartTime = now.getTime();
  initialized = true;

  // Persist to KV
  await saveEpoch(currentEpoch);

  return currentEpoch;
}

/**
 * Synchronous getter (uses cached epoch, creates new if needed)
 */
export function getOrCreateEpoch(intervalMs: number = DEFAULT_INTERVAL_MS): PulseEpoch {
  if (!currentEpoch) {
    const now = new Date();
    currentEpoch = {
      epoch_id: `epoch_${now.toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`,
      started_at: now.toISOString(),
      interval_ms: intervalMs,
      origin_domain: 'fractal-core.com',
    };
    epochStartTime = now.getTime();
    // Note: won't persist without await, but needed for sync compatibility
  }
  return currentEpoch;
}

/**
 * Reset the epoch (for server restarts or manual reset)
 */
export async function resetEpoch(intervalMs: number = DEFAULT_INTERVAL_MS): Promise<PulseEpoch> {
  currentEpoch = null;
  initialized = false;
  return createNewEpoch(intervalMs);
}

/**
 * Calculate current prime index based on elapsed time since epoch start.
 *
 * For large indices (beyond sieve range), the prime engine uses PNT estimate
 * + Miller-Rabin to find a deterministic prime without sequential counting.
 */
export function getCurrentPrimeIndex(): number {
  const epoch = getOrCreateEpoch();
  const elapsed = Date.now() - epochStartTime;
  return Math.floor(elapsed / epoch.interval_ms) + 1; // 1-indexed
}

/**
 * Compute fingerprint (4 second ratios) at a given prime index
 */
export function computeFingerprint(index: number, length: number = 4): number[] {
  // Need index-1 to index+length+1 primes to compute 'length' ratios
  const startIndex = Math.max(1, index - 1);
  const result = primeEngine.primesAroundIndex(startIndex, length + 2);
  const primes = result.primes;

  // Compute gaps
  const gaps: bigint[] = [];
  for (let i = 0; i < primes.length - 1; i++) {
    gaps.push(primes[i + 1] - primes[i]);
  }

  // Compute second differences
  const d2: bigint[] = [];
  for (let i = 0; i < gaps.length - 1; i++) {
    d2.push(gaps[i + 1] - gaps[i]);
  }

  // Compute ratios (as floats for fingerprint)
  const ratios: number[] = [];
  for (let i = 0; i < Math.min(length, d2.length); i++) {
    const span = primes[i + 2] - primes[i];
    const ratio = Number(d2[i]) / Number(span);
    // Round to 2 decimal places for fingerprint
    ratios.push(Math.round(ratio * 100) / 100);
  }

  return ratios;
}

/**
 * Get the current second difference at a prime index
 */
export function getSecondDifference(index: number): number {
  const result = primeEngine.primesAroundIndex(index - 1, 2);
  const primes = result.primes;

  if (primes.length < 3) return 0;

  const g1 = primes[1] - primes[0];
  const g2 = primes[2] - primes[1];
  return Number(g2 - g1);
}

/**
 * Generate the current pulse event
 */
export function getCurrentPulse(): PulseEvent {
  const epoch = getOrCreateEpoch();
  const index = getCurrentPrimeIndex();
  const prime = primeEngine.primeAtIndex(index);
  const fingerprint = computeFingerprint(index);
  const d2 = getSecondDifference(index);

  return {
    epoch_id: epoch.epoch_id,
    index,
    prime: prime.toString(),
    timestamp: new Date().toISOString(),
    fingerprint,
    d2,
    interval_ms: epoch.interval_ms,
  };
}

/**
 * Get pulse at a specific index (for historical queries)
 */
export function getPulseAtIndex(index: number): Omit<PulseEvent, 'timestamp'> & { timestamp?: string } {
  const epoch = getOrCreateEpoch();
  const prime = primeEngine.primeAtIndex(index);
  const fingerprint = computeFingerprint(index);
  const d2 = getSecondDifference(index);

  // Calculate when this pulse would have occurred
  const pulseTime = epochStartTime + (index - 1) * epoch.interval_ms;
  const timestamp = pulseTime <= Date.now() ? new Date(pulseTime).toISOString() : undefined;

  return {
    epoch_id: epoch.epoch_id,
    index,
    prime: prime.toString(),
    timestamp,
    fingerprint,
    d2,
    interval_ms: epoch.interval_ms,
  };
}

/**
 * Compute time until next pulse
 */
export function timeToNextPulse(): number {
  const epoch = getOrCreateEpoch();
  const elapsed = Date.now() - epochStartTime;
  const inCurrentInterval = elapsed % epoch.interval_ms;
  return epoch.interval_ms - inCurrentInterval;
}

/**
 * Get epoch info
 */
export function getEpochInfo(): PulseEpoch & { current_index: number; uptime_ms: number } {
  const epoch = getOrCreateEpoch();
  return {
    ...epoch,
    current_index: getCurrentPrimeIndex(),
    uptime_ms: Date.now() - epochStartTime,
  };
}

// ============================================================================
// LPP2 Residue / Catuskoti Channel Computation
// ============================================================================

/**
 * Compute residue channel from a prime value.
 * All primes > 5 end in 1, 3, 7, or 9 (i.e., prime mod 10 ∈ {1,3,7,9}).
 * These four residues map to the four catuskoti truth-values.
 */
export function computeResidue(prime: bigint): { residue: Residue; channel: string; catuskoti: string; bits: string } {
  const mod = Number(prime % 10n) as Residue;
  // Primes 2 and 5 don't end in 1/3/7/9; treat them as edge cases
  if (!(mod in RESIDUE_MAP)) {
    // 2 mod 10 = 2, 5 mod 10 = 5 — map to agreement as default for these two primes
    return { residue: 1 as Residue, ...RESIDUE_MAP[1] };
  }
  return { residue: mod, ...RESIDUE_MAP[mod] };
}

/**
 * Get full residue response at a given prime index
 */
export function getResidueAtIndex(index: number, includeNeighborhood: boolean = false, k: number = 10): ResidueResponse {
  const prime = primeEngine.primeAtIndex(index);
  const { residue, channel, catuskoti, bits } = computeResidue(prime);

  const response: ResidueResponse = {
    pulseIndex: index,
    prime: prime.toString(),
    residue,
    channel: channel as ResidueResponse['channel'],
    catuskoti: catuskoti as ResidueResponse['catuskoti'],
    quaternaryBits: bits as ResidueResponse['quaternaryBits'],
  };

  if (includeNeighborhood) {
    const result = primeEngine.primesAroundIndex(index, k);
    const primes = result.primes;
    const residues = primes.map(p => {
      const mod = Number(p % 10n);
      return (mod in RESIDUE_MAP ? mod : 1) as Residue;
    });
    const stream = residues.map(r => RESIDUE_MAP[r].bits).join('');

    response.neighborhood = {
      k,
      primes: primes.map(p => p.toString()),
      residues,
      stream,
    };
  }

  return response;
}

/**
 * Get current residue (at current pulse index)
 */
export function getCurrentResidue(includeNeighborhood: boolean = false, k: number = 10): ResidueResponse {
  const index = getCurrentPrimeIndex();
  return getResidueAtIndex(index, includeNeighborhood, k);
}

/**
 * Compute channel schedule for the next N pulses from a starting index
 */
export function getChannelSchedule(fromIndex: number, count: number): ChannelScheduleEntry[] {
  const schedule: ChannelScheduleEntry[] = [];

  for (let i = 0; i < count; i++) {
    const idx = fromIndex + i;
    const prime = primeEngine.primeAtIndex(idx);
    const { residue, channel, catuskoti, bits } = computeResidue(prime);

    schedule.push({
      pulseIndex: idx,
      prime: prime.toString(),
      residue,
      channel: channel as ChannelScheduleEntry['channel'],
      catuskoti: catuskoti as ChannelScheduleEntry['catuskoti'],
      quaternaryBits: bits as ChannelScheduleEntry['quaternaryBits'],
    });
  }

  return schedule;
}
