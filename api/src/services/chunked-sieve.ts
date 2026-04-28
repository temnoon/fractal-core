/**
 * Chunked Sieve Service
 *
 * Handles large prime computations by breaking them into smaller chunks
 * that can be processed within Cloudflare Workers CPU time limits.
 *
 * Uses Workers KV for state persistence between chunks.
 */

import { bpswEngine } from './engines/index.js';
import { alignUp, alignDown, step, stepBack } from './lib/wheel.js';

// Configuration
const CHUNK_SIZE = 200_000; // Process 200K candidates per chunk
// Default chunk budget: leave margin for 30s default CPU limit. Override via
// the CHUNK_TIMEOUT_MS env var (set in wrangler.toml [vars]) when [limits]
// cpu_ms is raised. setChunkTimeoutMs() lets early-startup wiring read env.
let CHUNK_TIMEOUT_MS = 25_000;

export function setChunkTimeoutMs(ms: number): void {
  // Floor of 10 ms intentional — production never wants this small but tests
  // need it low enough to force multi-chunk behaviour deterministically.
  if (ms >= 10 && ms <= 290_000) CHUNK_TIMEOUT_MS = ms;
}

export function getChunkTimeoutMs(): number {
  return CHUNK_TIMEOUT_MS;
}

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

  // Cross-chunk walker resume state (essential at ≥ 4 K bits, where a single
  // isPrime can dominate the chunk budget). When set, the next chunk picks
  // up at exactly this candidate instead of recomputing from beforePrimes[0]
  // / afterPrimes[last] — preventing throw-away work when no prime was found
  // within the prior chunk.
  pendingForwardCandidate?: string;
  pendingForwardWheelIdx?: number;
  pendingBackwardCandidate?: string;
  pendingBackwardWheelIdx?: number;

  /** Total candidates run through isPrime so far (forward + backward, all chunks). */
  candidatesTested?: number;
  /** Exponential moving average of isPrime wall-time, ms. Used to predict whether
   *  another call will fit in the remaining chunk budget. */
  isPrimeEmaMs?: number;

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
 * Update the EMA estimate of isPrime wall-time. Smoothing factor α = 0.3 —
 * fast enough to react when bit-widths jump, stable enough to ignore one-off
 * outlier primes (very smooth or very rough candidates).
 */
function updateIsPrimeEma(state: ChunkState, sampleMs: number): void {
  const prior = state.isPrimeEmaMs ?? sampleMs;
  state.isPrimeEmaMs = prior * 0.7 + sampleMs * 0.3;
}

/**
 * Decide whether another isPrime call would fit inside the chunk budget.
 * Padded by ×1.5 because some candidates are 5-10× slower than the EMA
 * (e.g. those that pass MR base 2 and run the full Lucas chain).
 */
function canAffordAnotherTest(state: ChunkState, elapsedMs: number): boolean {
  const remaining = CHUNK_TIMEOUT_MS - elapsedMs;
  const predicted = (state.isPrimeEmaMs ?? 1) * 1.5;
  return remaining > predicted;
}

/**
 * Process one chunk of bidirectional prime walking (around-value mode).
 *
 * Walks candidate-by-candidate using the wheel sieve, checking the chunk
 * budget after every isPrime call. If we can't afford another test, we
 * checkpoint the current candidate (and wheel index) into ChunkState so the
 * next chunk resumes exactly there — no thrown-away work.
 *
 * Why this matters: at 8K + bits each isPrime can take ~1.5 s and at 16K
 * bits ~12 s. The legacy implementation called bpswEngine.nextPrime() which
 * is a monolithic loop with no checkpoints; a chunk could blow past the CPU
 * budget mid-test. This rewrite gives one isPrime call ↔ one checkpoint, so
 * walks at any bit-width can span as many chunks as needed.
 */
export function processChunkAroundValue(state: ChunkState): ChunkResult {
  const startTime = Date.now();
  const k = state.targetCount;
  let primesFound = 0;
  let candidatesThisChunk = 0;

  const beforePrimes = state.beforePrimes ?? [];
  const afterPrimes = state.afterPrimes ?? [];
  const centerPrime = BigInt(state.centerPrime!);

  // ── Backward walk ─────────────────────────────────────────────────────
  // Half the chunk budget is reserved for the backward pass so a long
  // backward walk doesn't starve the forward walk inside the same chunk.
  const backwardBudget = CHUNK_TIMEOUT_MS / 2;
  if (!state.beforeDone && beforePrimes.length < k) {
    let cand: bigint;
    let idx: number;
    if (state.pendingBackwardCandidate) {
      cand = BigInt(state.pendingBackwardCandidate);
      idx = state.pendingBackwardWheelIdx ?? 0;
    } else {
      // Resume from the lowest known prime (or center) and step one wheel
      // position below it; alignDown gives the largest wheel-coprime ≤ that.
      const startFrom =
        beforePrimes.length > 0 ? BigInt(beforePrimes[0]) - 1n : centerPrime - 1n;
      ({ value: cand, idx } = alignDown(startFrom));
    }

    let backwardTested = 0;
    while (beforePrimes.length < k) {
      if (cand <= 2n) {
        if (cand === 2n && beforePrimes[0] !== '2') {
          beforePrimes.unshift('2');
          primesFound++;
        }
        state.beforeDone = true;
        break;
      }

      const elapsed = Date.now() - startTime;
      if (elapsed >= backwardBudget) break;
      // Always allow the first test of this direction so the EMA can
      // self-correct — otherwise an over-large EMA seeded by a prior chunk
      // can deadlock the walker (refuse-to-run never updates the EMA).
      if (backwardTested > 0 && !canAffordAnotherTest(state, elapsed)) break;

      const t0 = performance.now();
      const isPrime = bpswEngine.isPrime(cand);
      updateIsPrimeEma(state, performance.now() - t0);
      candidatesThisChunk++;
      backwardTested++;

      if (isPrime) {
        beforePrimes.unshift(cand.toString());
        primesFound++;
      }

      ({ value: cand, idx } = stepBack(cand, idx));
    }

    if (beforePrimes.length >= k) {
      state.beforeDone = true;
      state.pendingBackwardCandidate = undefined;
      state.pendingBackwardWheelIdx = undefined;
    } else if (!state.beforeDone) {
      state.pendingBackwardCandidate = cand.toString();
      state.pendingBackwardWheelIdx = idx;
    }
  }

  // ── Forward walk ──────────────────────────────────────────────────────
  if (!state.afterDone && afterPrimes.length < k) {
    let cand: bigint;
    let idx: number;
    if (state.pendingForwardCandidate) {
      cand = BigInt(state.pendingForwardCandidate);
      idx = state.pendingForwardWheelIdx ?? 0;
    } else {
      const startFrom =
        afterPrimes.length > 0
          ? BigInt(afterPrimes[afterPrimes.length - 1]) + 1n
          : centerPrime + 1n;
      ({ value: cand, idx } = alignUp(startFrom));
    }

    let forwardTested = 0;
    while (afterPrimes.length < k) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= CHUNK_TIMEOUT_MS) break;
      // Same first-test-always rule as the backward direction.
      if (forwardTested > 0 && !canAffordAnotherTest(state, elapsed)) break;

      const t0 = performance.now();
      const isPrime = bpswEngine.isPrime(cand);
      updateIsPrimeEma(state, performance.now() - t0);
      candidatesThisChunk++;
      forwardTested++;

      if (isPrime) {
        afterPrimes.push(cand.toString());
        primesFound++;
      }

      ({ value: cand, idx } = step(cand, idx));
    }

    if (afterPrimes.length >= k) {
      state.afterDone = true;
      state.pendingForwardCandidate = undefined;
      state.pendingForwardWheelIdx = undefined;
    } else {
      state.pendingForwardCandidate = cand.toString();
      state.pendingForwardWheelIdx = idx;
    }
  }

  // Update state
  state.beforePrimes = beforePrimes;
  state.afterPrimes = afterPrimes;
  state.candidatesTested = (state.candidatesTested ?? 0) + candidatesThisChunk;
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

  // ── Backward phase ────────────────────────────────────────────────────
  // Walk k prevPrime calls from center, *retaining* each prime in
  // state.beforePrimes (oldest-first). The forward phase replays them
  // through the sliding window without re-testing — saves ~k isPrime calls,
  // i.e. ~33% of the stats-only walk for large k.
  //
  // Edge case: when the center is at or near p=2, prevPrime(1) returns 2
  // forever. We detect "no more progress backward" via next >= current and
  // halt early; the forward phase then runs on a shorter (or empty) backward
  // buffer, which is a correct partial neighborhood rather than a corrupt
  // run of duplicates.
  if (state.phase === 'backward') {
    let current = BigInt(state.currentValue);
    let remaining = state.remainingBack ?? k;
    if (!state.beforePrimes) state.beforePrimes = [];
    const beforePrimes = state.beforePrimes;
    let exhaustedBackward = false;
    while (remaining > 0 && Date.now() - startTime < CHUNK_TIMEOUT_MS / 2) {
      const next = bpswEngine.prevPrime(current - 1n);
      if (next >= current) {
        exhaustedBackward = true;
        break;
      }
      current = next;
      // Maintain ascending order (oldest first) — replays naturally forward.
      beforePrimes.unshift(current.toString());
      remaining--;
      primesFound++;
    }
    state.currentValue = current;
    state.remainingBack = remaining;
    state.chunksProcessed++;
    state.updatedAt = new Date().toISOString();
    if (remaining === 0 || exhaustedBackward) {
      state.startPrime = current.toString();
      state.phase = 'forward';
      state.currentValue = current;
      state.primesGenerated = 0;
      state.lastPrime0 = undefined;
      state.lastPrime1 = undefined;
    }
    return { state, primesFound, hasMore: !state.completed };
  }

  // ── Forward phase ─────────────────────────────────────────────────────
  // Drain the backward buffer first (no isPrime calls), then continue with
  // the center prime and walk forward k more nextPrime calls.
  const total = 2 * k + 1;
  let generated = state.primesGenerated ?? 0;
  const buffered = state.beforePrimes ?? [];
  let current = BigInt(state.currentValue);

  while (generated < total && Date.now() - startTime < CHUNK_TIMEOUT_MS) {
    let p2: bigint;
    if (generated < buffered.length) {
      // Replay a backward-found prime — already known, no test needed.
      p2 = BigInt(buffered[generated]);
    } else if (generated === buffered.length) {
      // Center prime: already cached on state.centerPrime by the caller.
      p2 = state.centerPrime ? BigInt(state.centerPrime) : current;
    } else {
      // Walk forward — only here do we incur a fresh isPrime walk.
      p2 = bpswEngine.nextPrime(current + 1n);
    }

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
        // span === 0 means p2 == p0 — degenerate (e.g. start of sequence
        // edge cases). Skip rather than divide by zero.
        if (span !== 0n) {
          const g = computeGcd(d2, span);
          const denom = g === 0n ? 1n : g;
          const num = (d2 / denom).toString();
          const den = (span / denom).toString();
          incCount(state.countsRatio!, `${num}/${den}`);
          state.totalRatio = (state.totalRatio ?? 0) + 1;
        }
      }
    }

    state.lastPrime0 = state.lastPrime1;
    state.lastPrime1 = p2.toString();
    current = p2;
    generated++;
    primesFound++;
  }

  state.currentValue = current;
  state.primesGenerated = generated;
  state.chunksProcessed++;
  state.updatedAt = new Date().toISOString();

  if (generated >= total) {
    state.completed = true;
    // Drop the backward buffer once fully replayed; saves KV bytes.
    state.beforePrimes = undefined;
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
