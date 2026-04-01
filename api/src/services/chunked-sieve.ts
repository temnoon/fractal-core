/**
 * Chunked Sieve Service
 *
 * Handles large prime computations by breaking them into smaller chunks
 * that can be processed within Cloudflare Workers CPU time limits.
 *
 * Uses Workers KV for state persistence between chunks.
 */

import { bpswEngine } from './engines/index.js';

// Configuration
const CHUNK_SIZE = 200_000; // Process 200K candidates per chunk
const CHUNK_TIMEOUT_MS = 25_000; // 25 seconds per chunk (leave margin for 30s default CPU limit)

export interface ChunkState {
  jobId: string;
  mode: 'forward-sieve' | 'around-value' | 'stats-only';
  targetCount: number;
  startValue: bigint;
  currentValue: bigint;
  primes: string[];
  chunksProcessed: number;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  error?: string;
  processingLock?: number; // Advisory lock timestamp (ms)

  // around-value mode fields
  centerPrime?: string;
  beforePrimes?: string[]; // Primes found before center (stored newest-first)
  afterPrimes?: string[];  // Primes found after center
  beforeDone?: boolean;
  afterDone?: boolean;

  // stats-only mode fields (centerPrime shared with around-value above)
  phase?: 'backward' | 'forward';
  remainingBack?: number;
  startPrime?: string;
  primesGenerated?: number;
  lastPrime0?: string;
  lastPrime1?: string;
  countsGaps?: Record<string, number>;
  countsD2?: Record<string, number>;
  countsRatio?: Record<string, number>;
  totalGaps?: number;
  totalD2?: number;
  totalRatio?: number;
  computeGaps?: boolean;
  computeD2?: boolean;
  computeRatio?: boolean;
}

export interface ChunkResult {
  state: ChunkState;
  primesFound: number;
  hasMore: boolean;
}

/**
 * Create initial chunk state for a forward-sieve job
 */
export function createChunkState(
  jobId: string,
  startValue: bigint,
  targetCount: number
): ChunkState {
  const now = new Date().toISOString();
  return {
    jobId,
    mode: 'forward-sieve',
    targetCount,
    startValue,
    currentValue: startValue,
    primes: [],
    chunksProcessed: 0,
    completed: false,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Create initial chunk state for an around-value job
 */
export function createAroundValueState(
  jobId: string,
  centerValue: bigint,
  k: number
): ChunkState {
  const now = new Date().toISOString();
  // Find the actual center prime
  const centerPrime = bpswEngine.isPrime(centerValue)
    ? centerValue
    : bpswEngine.nextPrime(centerValue);

  return {
    jobId,
    mode: 'around-value',
    targetCount: k,
    startValue: centerValue,
    currentValue: centerPrime,
    primes: [],
    chunksProcessed: 0,
    completed: false,
    createdAt: now,
    updatedAt: now,
    centerPrime: centerPrime.toString(),
    beforePrimes: [],
    afterPrimes: [],
    beforeDone: false,
    afterDone: false,
  };
}

/**
 * Create initial chunk state for stats-only processing
 */
export function createStatsState(
  jobId: string,
  centerPrime: bigint,
  k: number,
  computeGaps: boolean,
  computeD2: boolean,
  computeRatio: boolean
): ChunkState {
  const now = new Date().toISOString();
  return {
    jobId,
    mode: 'stats-only',
    targetCount: k,
    startValue: centerPrime,
    currentValue: centerPrime,
    primes: [],
    chunksProcessed: 0,
    completed: false,
    createdAt: now,
    updatedAt: now,
    phase: 'backward',
    remainingBack: k,
    centerPrime: centerPrime.toString(),
    startPrime: undefined,
    primesGenerated: 0,
    countsGaps: {},
    countsD2: {},
    countsRatio: {},
    totalGaps: 0,
    totalD2: 0,
    totalRatio: 0,
    computeGaps,
    computeD2,
    computeRatio,
  };
}

/**
 * Process one chunk of prime candidates (forward sieve mode)
 * Returns the updated state and whether more processing is needed
 */
export function processChunk(state: ChunkState): ChunkResult {
  const startTime = Date.now();
  let current = BigInt(state.currentValue);
  const target = state.targetCount;
  let primesFound = 0;

  // Start from next odd number if current is even (and > 2)
  if (current > 2n && current % 2n === 0n) {
    current++;
  }

  // Special case for 2
  if (current <= 2n && state.primes.length === 0) {
    state.primes.push('2');
    current = 3n;
    primesFound++;
  }

  // Process candidates until we hit limits
  let candidatesChecked = 0;
  while (
    state.primes.length < target &&
    candidatesChecked < CHUNK_SIZE &&
    Date.now() - startTime < CHUNK_TIMEOUT_MS
  ) {
    if (bpswEngine.isPrime(current)) {
      state.primes.push(current.toString());
      primesFound++;
    }

    current += 2n; // Skip even numbers
    candidatesChecked++;
  }

  // Update state
  state.currentValue = current;
  state.chunksProcessed++;
  state.updatedAt = new Date().toISOString();

  // Check if we've reached our target
  const hasMore = state.primes.length < target;
  if (!hasMore) {
    state.completed = true;
  }

  return {
    state,
    primesFound,
    hasMore,
  };
}

/**
 * Process one chunk of bidirectional prime walking (around-value mode)
 * Walks both before and after the center prime, bounded by CHUNK_TIMEOUT_MS
 */
export function processChunkAroundValue(state: ChunkState): ChunkResult {
  const startTime = Date.now();
  const k = state.targetCount;
  let primesFound = 0;

  const beforePrimes = state.beforePrimes ?? [];
  const afterPrimes = state.afterPrimes ?? [];
  const centerPrime = BigInt(state.centerPrime!);

  // Walk backward from center
  if (!state.beforeDone && beforePrimes.length < k) {
    let prev = beforePrimes.length > 0
      ? BigInt(beforePrimes[0]) - 1n
      : centerPrime - 1n;

    while (
      beforePrimes.length < k &&
      Date.now() - startTime < CHUNK_TIMEOUT_MS / 2
    ) {
      if (prev <= 2n) {
        if (prev === 2n && beforePrimes.length < k && (beforePrimes[0] !== '2')) {
          beforePrimes.unshift('2');
          primesFound++;
        }
        state.beforeDone = true;
        break;
      }
      // Step back before searching to avoid repeating the same prime
      prev = bpswEngine.prevPrime(prev - 1n);
      beforePrimes.unshift(prev.toString());
      primesFound++;
    }

    if (beforePrimes.length >= k) {
      state.beforeDone = true;
    }
  }

  // Walk forward from center
  if (!state.afterDone && afterPrimes.length < k) {
    let next = afterPrimes.length > 0
      ? BigInt(afterPrimes[afterPrimes.length - 1]) + 1n
      : centerPrime + 1n;

    while (
      afterPrimes.length < k &&
      Date.now() - startTime < CHUNK_TIMEOUT_MS
    ) {
      // Step forward before searching to avoid repeating the same prime
      next = bpswEngine.nextPrime(next + 1n);
      afterPrimes.push(next.toString());
      primesFound++;
    }

    if (afterPrimes.length >= k) {
      state.afterDone = true;
    }
  }

  // Update state
  state.beforePrimes = beforePrimes;
  state.afterPrimes = afterPrimes;
  state.chunksProcessed++;
  state.updatedAt = new Date().toISOString();

  // Check completion
  const hasMore = !(state.beforeDone && state.afterDone);
  if (!hasMore) {
    // Assemble final primes array: before + center + after
    state.primes = [
      ...beforePrimes,
      state.centerPrime!,
      ...afterPrimes,
    ];
    state.completed = true;
  }

  return {
    state,
    primesFound,
    hasMore,
  };
}

function incCount(map: Record<string, number>, key: string): void {
  map[key] = (map[key] || 0) + 1;
}

function computeGcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/**
 * Process one chunk of stats-only processing
 */
export function processChunkStatsOnly(state: ChunkState): ChunkResult {
  const startTime = Date.now();
  const k = state.targetCount;
  let primesFound = 0;

  if (state.phase === 'backward') {
    let current = BigInt(state.currentValue);
    let remaining = state.remainingBack ?? k;
    while (remaining > 0 && Date.now() - startTime < CHUNK_TIMEOUT_MS / 2) {
      current = bpswEngine.prevPrime(current - 1n);
      remaining--;
    }
    state.currentValue = current;
    state.remainingBack = remaining;
    state.chunksProcessed++;
    state.updatedAt = new Date().toISOString();
    if (remaining === 0) {
      state.startPrime = current.toString();
      state.phase = 'forward';
      state.currentValue = current;
      state.primesGenerated = 0;
      state.lastPrime0 = undefined;
      state.lastPrime1 = undefined;
    }
    return { state, primesFound, hasMore: !state.completed };
  }

  // forward phase
  let current = BigInt(state.currentValue);
  const total = 2 * k + 1;
  let generated = state.primesGenerated ?? 0;

  while (generated < total && Date.now() - startTime < CHUNK_TIMEOUT_MS) {
    if (generated > 0) {
      current = bpswEngine.nextPrime(current + 1n);
    }

    const p2 = current;
    const p1 = state.lastPrime1 ? BigInt(state.lastPrime1) : null;
    const p0 = state.lastPrime0 ? BigInt(state.lastPrime0) : null;

    if (p1 !== null && state.computeGaps) {
      const gap = p2 - p1;
      incCount(state.countsGaps!, gap.toString());
      state.totalGaps = (state.totalGaps ?? 0) + 1;
    }

    if (p0 !== null && p1 !== null) {
      const gap1 = p1 - p0;
      const gap2 = p2 - p1;
      const d2 = gap2 - gap1;
      if (state.computeD2) {
        incCount(state.countsD2!, d2.toString());
        state.totalD2 = (state.totalD2 ?? 0) + 1;
      }
      if (state.computeRatio) {
        const span = p2 - p0;
        const g = computeGcd(d2, span);
        const num = (d2 / g).toString();
        const den = (span / g).toString();
        incCount(state.countsRatio!, `${num}/${den}`);
        state.totalRatio = (state.totalRatio ?? 0) + 1;
      }
    }

    state.lastPrime0 = state.lastPrime1;
    state.lastPrime1 = p2.toString();
    generated++;
    primesFound++;
  }

  state.currentValue = current;
  state.primesGenerated = generated;
  state.chunksProcessed++;
  state.updatedAt = new Date().toISOString();

  if (generated >= total) {
    state.completed = true;
  }

  return {
    state,
    primesFound,
    hasMore: !state.completed,
  };
}

/**
 * Serialize state for KV storage
 */
export function serializeState(state: ChunkState): string {
  return JSON.stringify({
    ...state,
    startValue: state.startValue.toString(),
    currentValue: state.currentValue.toString(),
  });
}

/**
 * Deserialize state from KV storage
 */
export function deserializeState(json: string): ChunkState {
  const parsed = JSON.parse(json);
  return {
    ...parsed,
    startValue: BigInt(parsed.startValue),
    currentValue: BigInt(parsed.currentValue),
  };
}

/**
 * Get KV key for a chunk job
 */
export function getChunkKey(jobId: string): string {
  return `chunk:${jobId}`;
}

/**
 * Store chunk state in KV
 */
export async function storeChunkState(
  kv: KVNamespace,
  state: ChunkState
): Promise<void> {
  const key = getChunkKey(state.jobId);
  await kv.put(key, serializeState(state), {
    expirationTtl: 86400, // 24 hours
  });
}

/**
 * Load chunk state from KV
 */
export async function loadChunkState(
  kv: KVNamespace,
  jobId: string
): Promise<ChunkState | null> {
  const key = getChunkKey(jobId);
  const json = await kv.get(key);
  if (!json) return null;
  return deserializeState(json);
}

/**
 * Delete chunk state from KV
 */
export async function deleteChunkState(
  kv: KVNamespace,
  jobId: string
): Promise<void> {
  const key = getChunkKey(jobId);
  await kv.delete(key);
}

/**
 * Process a large prime request in chunks
 * This is meant to be called repeatedly until completion
 */
export async function processLargeRequest(
  kv: KVNamespace | undefined,
  jobId: string,
  startValue: bigint,
  targetCount: number
): Promise<{
  primes: string[];
  completed: boolean;
  chunksProcessed: number;
  progress: number;
}> {
  // If no KV, process synchronously (limited to small requests)
  if (!kv) {
    const state = createChunkState(jobId, startValue, Math.min(targetCount, 1000));
    while (!state.completed && state.chunksProcessed < 10) {
      const result = processChunk(state);
      if (!result.hasMore) break;
    }
    return {
      primes: state.primes,
      completed: state.completed,
      chunksProcessed: state.chunksProcessed,
      progress: state.completed ? 100 : (state.primes.length / targetCount) * 100,
    };
  }

  // Try to load existing state
  let state = await loadChunkState(kv, jobId);

  // Create new state if not exists
  if (!state) {
    state = createChunkState(jobId, startValue, targetCount);
  }

  // Check if already completed
  if (state.completed) {
    return {
      primes: state.primes,
      completed: true,
      chunksProcessed: state.chunksProcessed,
      progress: 100,
    };
  }

  // Process one chunk
  processChunk(state);

  // Save state
  await storeChunkState(kv, state);

  return {
    primes: state.primes,
    completed: state.completed,
    chunksProcessed: state.chunksProcessed,
    progress: state.completed ? 100 : (state.primes.length / targetCount) * 100,
  };
}

/**
 * Create initial chunk state for a large-index job.
 * Uses prime number theorem to estimate center, then walks outward.
 */
export function createLargeIndexState(
  jobId: string,
  centerIndex: number,
  k: number
): ChunkState {
  const now = new Date().toISOString();

  // Estimate center prime via PNT: p_n ~ n * (ln(n) + ln(ln(n)))
  const n = centerIndex;
  const lnN = Math.log(n);
  const estimate = BigInt(Math.ceil(n * (lnN + Math.log(lnN))));
  const centerPrime = bpswEngine.nextPrime(estimate);

  return {
    jobId,
    mode: 'around-value',
    targetCount: k,
    startValue: centerPrime,
    currentValue: centerPrime,
    primes: [],
    chunksProcessed: 0,
    completed: false,
    createdAt: now,
    updatedAt: now,
    centerPrime: centerPrime.toString(),
    beforePrimes: [],
    afterPrimes: [],
    beforeDone: false,
    afterDone: false,
  };
}

/**
 * Find primes around a large index using chunked processing.
 * For small indices (< 1M), computes synchronously.
 * For large indices, returns a ChunkState for incremental processing.
 */
export async function findPrimesAroundLargeIndex(
  kv: KVNamespace | undefined,
  centerIndex: number,
  k: number
): Promise<{
  primes: bigint[];
  indices: number[];
  centerPrime: bigint;
  completed: boolean;
}> {
  // For small indices, use the regular engine
  if (centerIndex < 1_000_000) {
    const { primeEngine } = await import('./engines/index.js');
    const result = primeEngine.primesAroundIndex(centerIndex, k);
    const centerPrime = primeEngine.primeAtIndex(centerIndex);
    return {
      primes: result.primes,
      indices: result.indices,
      centerPrime,
      completed: true,
    };
  }

  // For large indices with small k, can still do synchronously within timeout
  if (k <= 200) {
    const n = centerIndex;
    const lnN = Math.log(n);
    const estimate = Math.ceil(n * (lnN + Math.log(lnN)));
    const centerPrime = bpswEngine.nextPrime(BigInt(estimate));

    const primes: bigint[] = [];
    const indices: number[] = [];

    const before: bigint[] = [];
    let prev = centerPrime;
    for (let i = 0; i < k; i++) {
      prev = bpswEngine.prevPrime(prev - 1n);
      before.unshift(prev);
    }

    primes.push(...before);
    primes.push(centerPrime);

    let next = centerPrime;
    for (let i = 0; i < k; i++) {
      next = bpswEngine.nextPrime(next + 1n);
      primes.push(next);
    }

    const startIndex = centerIndex - k;
    for (let i = 0; i < primes.length; i++) {
      indices.push(startIndex + i);
    }

    return { primes, indices, centerPrime, completed: true };
  }

  // Large index + large k: should not reach here — caller must use chunked path
  throw new Error('Large index with k > 200 must use chunked processing via processAroundValueJob');
}
