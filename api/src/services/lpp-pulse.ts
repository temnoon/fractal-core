/**
 * LPP Pulse Service
 *
 * Manages the pulse epoch, generates pulse events, and computes fingerprints.
 * The pulse is the heartbeat of the Lamish Pulse Protocol.
 */

import { primeEngine } from './engines/index.js';
import { saveEpoch, loadEpoch } from './lpp-storage.js';
import type { PulseEpoch, PulseEvent } from '../types/lpp.js';

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
 * Calculate current prime index based on elapsed time since epoch start
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
