/**
 * KV-backed job queue for async processing
 *
 * Supports chunked processing for large calculations that would
 * exceed Workers CPU time limits. Falls back to in-memory when
 * KV is unavailable.
 *
 * KV key schema:
 *   job:{id}        — Job metadata JSON (status, request, timestamps)  TTL 24h
 *   result:{id}     — Completed SignedResponse JSON                    TTL 24h
 *   chunk:{id}      — ChunkState JSON (managed by chunked-sieve)      TTL 24h
 *   user-jobs:{uid} — string[] of active job IDs                      TTL 24h
 */

import { bytesToHex } from '@noble/hashes/utils';
import type { Job, CanonicalRequest, SignedResponse, Receipt, NeighborhoodResult } from '../types/api.js';
import { computeNeighborhood, computeNeighborhoodExtras, parseComputeOptions, toNeighborhoodResult } from './neighborhood.js';
import { validateNeighborhood } from './validation.js';
import { computeRequestHash, computeResultHash } from '../crypto/hashing.js';
import { signResponse } from '../crypto/signing.js';
import { getPrimaryKeyPair } from '../config/keys.js';
import {
  createAroundValueState,
  createLargeIndexState,
  processChunkAroundValue,
  loadChunkState,
  storeChunkState,
  findPrimesAroundLargeIndex,
  createStatsState,
  processChunkStatsOnly,
  type ChunkState,
} from './chunked-sieve.js';
import { primeEngine } from './engines/index.js';

// In-memory fallback storage (used when JOBS_KV is not bound)
const memJobs = new Map<string, Job>();
const memResults = new Map<string, SignedResponse>();
const memJobsByUser = new Map<string, Set<string>>();

// Configuration
const MAX_JOBS = 100;
const KV_TTL = 86400; // 24 hours
const LOCK_TIMEOUT_MS = 15_000; // Advisory lock timeout
const LARGE_INDEX_THRESHOLD = 500_000;
const LARGE_VALUE_THRESHOLD = 10_000_000n;
const LARGE_K_THRESHOLD = 1_000;
const ASYNC_VALUE_K_THRESHOLD = 500;
const HARD_K_LIMIT = 200_000;

/**
 * GCD for rational reduction
 */
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a === 0n ? 1n : a;
}

/**
 * Generate a unique job ID
 */
function generateJobId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

// ── KV helpers ──────────────────────────────────────────────────────────────

async function kvGetJob(kv: KVNamespace, id: string): Promise<Job | null> {
  const json = await kv.get(`job:${id}`);
  return json ? JSON.parse(json) : null;
}

async function kvPutJob(kv: KVNamespace, job: Job): Promise<void> {
  await kv.put(`job:${job.id}`, JSON.stringify(job), { expirationTtl: KV_TTL });
}

async function kvGetResult(kv: KVNamespace, id: string): Promise<SignedResponse | null> {
  const json = await kv.get(`result:${id}`);
  return json ? JSON.parse(json) : null;
}

async function kvPutResult(kv: KVNamespace, id: string, result: SignedResponse): Promise<void> {
  await kv.put(`result:${id}`, JSON.stringify(result), { expirationTtl: KV_TTL });
}

async function kvGetUserJobs(kv: KVNamespace, userId: string): Promise<string[]> {
  const json = await kv.get(`user-jobs:${userId}`);
  return json ? JSON.parse(json) : [];
}

async function kvPutUserJobs(kv: KVNamespace, userId: string, jobIds: string[]): Promise<void> {
  await kv.put(`user-jobs:${userId}`, JSON.stringify(jobIds), { expirationTtl: KV_TTL });
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Determine if a request should be processed asynchronously
 */
export function needsAsyncProcessing(request: CanonicalRequest): boolean {
  const k = request.k ?? 10;

  // stats_only is much cheaper memory-wise than full lists, and the sync
  // path is the only one that currently accumulates the new number-theory
  // fields (merit / cramer / residue / theta / constellations). Allow up to
  // STATS_SYNC_K_THRESHOLD synchronously so users get a complete summary.
  // Beyond that, fall back to the async (gaps/d2/ratio-only) path until the
  // chunked stats accumulator learns the rest of the fields.
  const STATS_SYNC_K_THRESHOLD = 25_000;
  if (request.stats_only) {
    if (k > STATS_SYNC_K_THRESHOLD) return true;
    if (request.n_type === 'index') {
      const index = parseInt(request.n, 10);
      if (index > LARGE_INDEX_THRESHOLD) return true;
    }
    return false;
  }

  // Full-list path: any k > LARGE_K_THRESHOLD needs async to bound memory.
  if (k > LARGE_K_THRESHOLD) return true;

  // Large index-based lookups
  if (request.n_type === 'index') {
    const index = parseInt(request.n, 10);
    if (index > LARGE_INDEX_THRESHOLD) return true;
  }

  // Large value with moderate k
  if (request.n_type === 'value') {
    try {
      const value = BigInt(request.n);
      if (value > LARGE_VALUE_THRESHOLD && k > ASYNC_VALUE_K_THRESHOLD) return true;
    } catch {
      // Invalid bigint, will fail later in processing
    }
  }

  return false;
}

/**
 * Count active (non-completed) jobs for a user
 */
export async function countUserJobs(kv: KVNamespace | undefined, userId?: string): Promise<number> {
  if (!kv) {
    // In-memory fallback
    if (!userId) {
      let count = 0;
      for (const job of memJobs.values()) {
        if (job.status === 'pending' || job.status === 'running') count++;
      }
      return count;
    }
    const userJobIds = memJobsByUser.get(userId);
    if (!userJobIds) return 0;
    let count = 0;
    for (const jobId of userJobIds) {
      const job = memJobs.get(jobId);
      if (job && (job.status === 'pending' || job.status === 'running')) count++;
    }
    return count;
  }

  // KV-backed
  if (!userId) return 0; // Can't count anonymous jobs in KV without a list

  const jobIds = await kvGetUserJobs(kv, userId);
  let count = 0;
  // Check each job (KV reads are fast)
  for (const jobId of jobIds) {
    const job = await kvGetJob(kv, jobId);
    if (job && (job.status === 'pending' || job.status === 'running')) count++;
  }
  return count;
}

/**
 * Create a new job
 */
export async function createJob(
  kv: KVNamespace | undefined,
  request: CanonicalRequest,
  userId?: string
): Promise<Job> {
  const job: Job = {
    id: generateJobId(),
    status: 'pending',
    request,
    created_at: new Date().toISOString(),
    progress: 0,
    chunksProcessed: 0,
    userId,
  };

  if (!kv) {
    // In-memory fallback
    if (memJobs.size >= MAX_JOBS) {
      for (const [id, j] of memJobs) {
        if (j.status === 'completed' || j.status === 'failed') {
          memJobs.delete(id);
          memResults.delete(id);
          if (j.userId) {
            memJobsByUser.get(j.userId)?.delete(id);
          }
          break;
        }
      }
    }
    memJobs.set(job.id, job);
    if (userId) {
      if (!memJobsByUser.has(userId)) memJobsByUser.set(userId, new Set());
      memJobsByUser.get(userId)!.add(job.id);
    }
  } else {
    // KV-backed
    await kvPutJob(kv, job);
    if (userId) {
      const userJobs = await kvGetUserJobs(kv, userId);
      userJobs.push(job.id);
      await kvPutUserJobs(kv, userId, userJobs);
    }
  }

  return job;
}

/**
 * Get a job by ID
 */
export async function getJob(kv: KVNamespace | undefined, id: string): Promise<Job | null> {
  if (!kv) return memJobs.get(id) ?? null;
  return kvGetJob(kv, id);
}

/**
 * Get job result (separate from job metadata for large results)
 */
export async function getJobResult(kv: KVNamespace | undefined, id: string): Promise<SignedResponse | null> {
  if (!kv) {
    // In-memory: result is stored on the job itself
    const job = memJobs.get(id);
    return job?.result ?? memResults.get(id) ?? null;
  }
  return kvGetResult(kv, id);
}

/**
 * Delete a job and its associated data
 */
export async function deleteJob(kv: KVNamespace | undefined, id: string): Promise<boolean> {
  if (!kv) {
    const existed = memJobs.delete(id);
    memResults.delete(id);
    return existed;
  }

  const job = await kvGetJob(kv, id);
  if (!job) return false;

  // Delete job, result, and chunk state
  await Promise.all([
    kv.delete(`job:${id}`),
    kv.delete(`result:${id}`),
    kv.delete(`chunk:${id}`),
  ]);

  // Remove from user's job list
  if (job.userId) {
    const userJobs = await kvGetUserJobs(kv, job.userId);
    const filtered = userJobs.filter(jid => jid !== id);
    await kvPutUserJobs(kv, job.userId, filtered);
  }

  return true;
}

// ── Core processing ─────────────────────────────────────────────────────────

/**
 * Advance job processing by one chunk.
 * Called via waitUntil on POST /jobs and on each GET /jobs/:id poll.
 */
export async function advanceJob(kv: KVNamespace | undefined, jobId: string): Promise<void> {
  // Load job metadata
  const job = kv ? await kvGetJob(kv, jobId) : memJobs.get(jobId) ?? null;
  if (!job) return;
  if (job.status === 'completed' || job.status === 'failed') return;

  // Mark as running if pending
  if (job.status === 'pending') {
    job.status = 'running';
    job.started_at = new Date().toISOString();
    if (kv) await kvPutJob(kv, job);
  }

  const request = job.request;
  const k = request.k ?? 10;

  const chunkStart = performance.now();

  try {
    if (!request.stats_only && k > HARD_K_LIMIT) {
      throw new Error(`k too large for full-list response (max ${HARD_K_LIMIT}). Use stats_only=true for large statistics-only requests.`);
    }
    // Determine processing mode
    const centerIndex = request.n_type === 'index' ? parseInt(request.n, 10) : 0;
    const isLargeIndex = request.n_type === 'index' && centerIndex > LARGE_INDEX_THRESHOLD;
    const isLargeValueK = request.n_type === 'value' && k > ASYNC_VALUE_K_THRESHOLD;
    const isLargeK = k > LARGE_K_THRESHOLD;

    if (request.stats_only) {
      await processStatsOnlyJob(kv, job, k);
    } else if (request.n_type === 'index') {
      if (isLargeIndex || isLargeK) {
        await processLargeIndexJob(kv, job, centerIndex, k);
      } else {
        await processStandardJob(kv, job);
      }
    } else if (isLargeValueK || isLargeK) {
      await processAroundValueJob(kv, job, k);
    } else {
      await processStandardJob(kv, job);
    }
  } catch (error) {
    job.status = 'failed';
    job.completed_at = new Date().toISOString();
    job.error = error instanceof Error ? error.message : String(error);
    if (kv) await kvPutJob(kv, job);
  }

  // Accumulate computation CPU time on the job
  const chunkCpu = Math.round(performance.now() - chunkStart);
  job.cpu_time_ms = (job.cpu_time_ms ?? 0) + chunkCpu;
  // Persist updated CPU time (job may already be saved by process*, but cpu_time_ms needs updating)
  if (kv) await kvPutJob(kv, job);
}

/**
 * Process a large index-based job.
 * For small k (<=200), runs synchronously via findPrimesAroundLargeIndex.
 * For large k, delegates to chunked around-value processing.
 */
async function processLargeIndexJob(
  kv: KVNamespace | undefined,
  job: Job,
  centerIndex: number,
  k: number
): Promise<void> {
  const request = job.request;

  // Large k with large index: use chunked around-value processing
  if (k > 200) {
    // Load or create chunk state using large-index estimator
    let state: ChunkState | null = null;
    if (kv) {
      state = await loadChunkState(kv, job.id);
    }
    if (!state) {
      state = createLargeIndexState(job.id, centerIndex, k);
    }

    // Delegate to the around-value chunk processor
    return processAroundValueJobWithState(kv, job, k, state);
  }

  // Small k: synchronous path
  const include = new Set(request.include);
  const largeResult = await findPrimesAroundLargeIndex(kv, centerIndex, k);

  const primes = largeResult.primes;
  const indices = largeResult.indices;

  const { gaps, d2, ratios } = computeDerivedSequences(primes, include);

  const extras = computeNeighborhoodExtras(
    { centerPrime: largeResult.centerPrime, primes, indices, gaps, d2, ratios },
    request.include,
    request.modulus,
  );

  const fullResult: NeighborhoodResult = {
    n: request.n,
    n_type: request.n_type,
    mode: request.mode,
    center_prime: largeResult.centerPrime.toString(),
    primes: primes.map(p => p.toString()),
    gaps: gaps.map(g => g.toString()),
    d2: d2.map(d => d.toString()),
    ratio: ratios,
    indices,
  };

  const response = buildSignedResponse(request, filterResult(fullResult, include, extras));

  await completeJob(kv, job, response);
}

/**
 * Process a job using chunked around-value walking
 */
async function processAroundValueJob(
  kv: KVNamespace | undefined,
  job: Job,
  k: number
): Promise<void> {
  const request = job.request;
  const centerValue = BigInt(request.n);

  // Load or create chunk state
  let state: ChunkState | null = null;
  if (kv) {
    state = await loadChunkState(kv, job.id);
  }

  if (!state) {
    if (request.n_type === 'index') {
      // Estimate value from index for around-value mode
      const idx = parseInt(request.n, 10);
      const lnN = Math.log(idx);
      const estimate = BigInt(Math.ceil(idx * (lnN + Math.log(lnN))));
      state = createAroundValueState(job.id, estimate, k);
    } else {
      state = createAroundValueState(job.id, centerValue, k);
    }
  }

  return processAroundValueJobWithState(kv, job, k, state);
}

/**
 * Shared chunked around-value processor.
 * Used by both processAroundValueJob and processLargeIndexJob (large k path).
 */
async function processAroundValueJobWithState(
  kv: KVNamespace | undefined,
  job: Job,
  k: number,
  state: ChunkState,
): Promise<void> {
  const request = job.request;

  // Check advisory lock
  if (state.processingLock && Date.now() - state.processingLock < LOCK_TIMEOUT_MS) {
    job.progress = computeProgress(state);
    job.chunksProcessed = state.chunksProcessed;
    job.primesFound = (state.beforePrimes?.length ?? 0) + (state.afterPrimes?.length ?? 0);
    job.phase = !state.beforeDone ? 'backward' : 'forward';
    if (kv) await kvPutJob(kv, job);
    return;
  }

  // Acquire advisory lock
  state.processingLock = Date.now();
  if (kv) await storeChunkState(kv, state);

  // Process one chunk
  const result = processChunkAroundValue(state);

  // Release lock
  state.processingLock = undefined;

  // Save chunk state
  if (kv) await storeChunkState(kv, state);

  if (result.state.completed) {
    // Build final response from completed primes
    const include = new Set(request.include);
    const primes = state.primes.map(p => BigInt(p));
    const { gaps, d2, ratios } = computeDerivedSequences(primes, include);

    const centerIndex = request.n_type === 'index'
      ? parseInt(request.n, 10)
      : 0;
    const startIndex = centerIndex > 0 ? centerIndex - k : 0;
    const indices = primes.map((_, i) => startIndex + i);

    const extras = computeNeighborhoodExtras(
      {
        centerPrime: BigInt(state.centerPrime!),
        primes,
        indices,
        gaps,
        d2,
        ratios,
      },
      request.include,
      request.modulus,
    );

    const fullResult: NeighborhoodResult = {
      n: request.n,
      n_type: request.n_type,
      mode: request.mode,
      center_prime: state.centerPrime!,
      primes: state.primes,
      gaps: gaps.map(g => g.toString()),
      d2: d2.map(d => d.toString()),
      ratio: ratios,
      indices,
    };

    const response = buildSignedResponse(request, filterResult(fullResult, include, extras));
    await completeJob(kv, job, response);
  } else {
    // Update progress with granular info
    job.progress = computeProgress(state);
    job.chunksProcessed = state.chunksProcessed;
    job.primesFound = (state.beforePrimes?.length ?? 0) + (state.afterPrimes?.length ?? 0);
    job.phase = !state.beforeDone ? 'backward' : 'forward';
    if (kv) {
      await kvPutJob(kv, job);
    }
  }
}

/**
 * Process a standard (small) job synchronously
 */
async function processStandardJob(
  kv: KVNamespace | undefined,
  job: Job,
): Promise<void> {
  const request = job.request;
  const options = parseComputeOptions(request);
  const data = computeNeighborhood(options);
  const extras = computeNeighborhoodExtras(data, request.include, request.modulus);
  const result = toNeighborhoodResult(request, data, extras);
  const validation = validateNeighborhood(data, request.validate);

  let response: SignedResponse;

  if (request.proof === 'none') {
    response = { request, result };
  } else {
    const receipt: Receipt = {
      request_hash: computeRequestHash(request),
      result_hash: computeResultHash(result),
      engines: validation.engines,
      validation: { mode: validation.mode, agreement: validation.agreement },
      deterministic: true,
      generated_at: new Date().toISOString(),
    };

    if (request.proof === 'receipt') {
      response = { request, result, receipt };
    } else {
      const keyPair = getPrimaryKeyPair();
      if (!keyPair) throw new Error('Signing key not available');
      const signature = signResponse(request, result, receipt, keyPair);
      response = { request, result, receipt, signature };
    }
  }

  await completeJob(kv, job, response);
}

function topStats(map: Record<string, number>, total: number, topN: number) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([value, count]) => ({
      value,
      count,
      pct: total ? Math.round((count / total) * 1000) / 10 : 0,
    }));
}

async function processStatsOnlyJob(
  kv: KVNamespace | undefined,
  job: Job,
  k: number
): Promise<void> {
  const request = job.request;
  const include = new Set(request.include);
  const computeGaps = include.has('gaps') || include.has('d2') || include.has('ratio');
  const computeD2 = include.has('d2') || include.has('ratio');
  const computeRatio = include.has('ratio');
  const topN = request.top_n ?? 10;

  let centerPrime: bigint;
  if (request.n_type === 'index') {
    const idx = parseInt(request.n, 10);
    if (idx > LARGE_INDEX_THRESHOLD) {
      // Use PNT estimate for large indices — brute-force primeAtIndex is infeasible
      const lnN = Math.log(idx);
      const estimate = BigInt(Math.ceil(idx * (lnN + Math.log(lnN))));
      centerPrime = primeEngine.nextPrime(estimate).prime;
    } else {
      centerPrime = primeEngine.primeAtIndex(idx);
    }
  } else {
    centerPrime = primeEngine.nextPrime(BigInt(request.n)).prime;
  }

  let state = kv ? await loadChunkState(kv, job.id) : null;
  if (!state) {
    state = createStatsState(job.id, centerPrime, k, computeGaps, computeD2, computeRatio);
  }

  processChunkStatsOnly(state);

  if (kv) {
    await storeChunkState(kv, state);
  }

  if (state.completed) {
    const stats = {
      gaps: computeGaps ? topStats(state.countsGaps || {}, state.totalGaps || 0, topN) : undefined,
      d2: computeD2 ? topStats(state.countsD2 || {}, state.totalD2 || 0, topN) : undefined,
      ratio: computeRatio ? topStats(state.countsRatio || {}, state.totalRatio || 0, topN) : undefined,
    };

    const result: NeighborhoodResult = {
      n: request.n,
      n_type: request.n_type,
      mode: request.mode,
      center_prime: centerPrime.toString(),
      stats,
    };

    const response = buildSignedResponse(request, result);
    await completeJob(kv, job, response);
  } else {
    const total = 2 * k + 1;
    // Count both backward-walked primes and forward-replayed/walked primes
    // so the progress bar advances during the backward phase too.
    const backwardCount = state.beforePrimes?.length ?? 0;
    const forwardCount = state.primesGenerated ?? 0;
    const found = state.phase === 'backward' ? backwardCount : Math.max(forwardCount, backwardCount);
    const progress = total > 0 ? (found / total) * 100 : 0;
    job.progress = Math.min(100, Math.max(0, Math.round(progress)));
    job.chunksProcessed = state.chunksProcessed;
    job.primesFound = found;
    job.phase = state.phase === 'backward' ? 'backward' : 'forward';
    if (kv) {
      await kvPutJob(kv, job);
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function computeDerivedSequences(
  primes: bigint[],
  include: Set<string>,
): {
  gaps: bigint[];
  d2: bigint[];
  ratios: { num: string; den: string }[];
} {
  const needGaps =
    include.has('gaps') ||
    include.has('d2') ||
    include.has('ratio') ||
    include.has('merit') ||
    include.has('cramer') ||
    include.has('constellations');
  const needD2 = include.has('d2') || include.has('ratio');
  const needRatio = include.has('ratio');

  const gaps: bigint[] = [];
  if (needGaps) {
    for (let i = 1; i < primes.length; i++) {
      gaps.push(primes[i] - primes[i - 1]);
    }
  }

  const d2: bigint[] = [];
  if (needD2) {
    for (let i = 1; i < gaps.length; i++) {
      d2.push(gaps[i] - gaps[i - 1]);
    }
  }

  const ratios: { num: string; den: string }[] = [];
  if (needRatio) {
    for (let i = 0; i < d2.length && i + 2 < primes.length; i++) {
      const span = primes[i + 2] - primes[i];
      const g = gcd(d2[i] < 0n ? -d2[i] : d2[i], span);
      ratios.push({
        num: (d2[i] / g).toString(),
        den: (span / g).toString(),
      });
    }
  }

  return { gaps, d2, ratios };
}

/**
 * Filter a full result to only include fields specified by request.include.
 * Optional `extras` are spliced in for the new number-theory fields which
 * live on NeighborhoodExtras rather than the raw NeighborhoodData.
 */
function filterResult(
  result: NeighborhoodResult,
  include: Set<string>,
  extras?: {
    merit?: number[];
    maxMerit?: { value: number; index: number };
    cramer?: number[];
    maxCramer?: { value: number; index: number };
    residueRace?: NeighborhoodResult['residue_race'];
    theta?: NeighborhoodResult['theta'];
    constellations?: NeighborhoodResult['constellations'];
  },
): NeighborhoodResult {
  const filtered: NeighborhoodResult = {
    n: result.n,
    n_type: result.n_type,
    mode: result.mode,
    center_prime: result.center_prime,
  };
  if (include.has('primes')) filtered.primes = result.primes;
  if (include.has('gaps')) filtered.gaps = result.gaps;
  if (include.has('d2')) filtered.d2 = result.d2;
  if (include.has('ratio')) filtered.ratio = result.ratio;
  if (include.has('indices')) filtered.indices = result.indices;
  if (extras) {
    if (extras.merit) filtered.merit = extras.merit;
    if (extras.maxMerit) filtered.max_merit = extras.maxMerit;
    if (extras.cramer) filtered.cramer = extras.cramer;
    if (extras.maxCramer) filtered.max_cramer = extras.maxCramer;
    if (extras.residueRace) filtered.residue_race = extras.residueRace;
    if (extras.theta) filtered.theta = extras.theta;
    if (extras.constellations) filtered.constellations = extras.constellations;
  }
  return filtered;
}

function buildSignedResponse(
  request: CanonicalRequest,
  result: NeighborhoodResult,
): SignedResponse {
  const receipt: Receipt = {
    request_hash: computeRequestHash(request),
    result_hash: computeResultHash(result),
    engines: ['bpsw'],
    validation: { mode: 'none', agreement: true },
    deterministic: true,
    generated_at: new Date().toISOString(),
  };

  let response: SignedResponse = { request, result, receipt };

  if (request.proof === 'signed') {
    const keyPair = getPrimaryKeyPair();
    if (keyPair) {
      const signature = signResponse(request, result, receipt, keyPair);
      response = { request, result, receipt, signature };
    }
  }

  return response;
}

async function completeJob(
  kv: KVNamespace | undefined,
  job: Job,
  response: SignedResponse
): Promise<void> {
  job.status = 'completed';
  job.completed_at = new Date().toISOString();
  job.progress = 100;

  if (!kv) {
    // In-memory: store result on job and in results map
    job.result = response;
    memResults.set(job.id, response);
    return;
  }

  // KV: store result separately, update job metadata (without result payload)
  await Promise.all([
    kvPutResult(kv, job.id, response),
    kvPutJob(kv, job),
  ]);
}

function computeProgress(state: ChunkState): number {
  if (state.completed) return 100;

  if (state.mode === 'around-value') {
    const k = state.targetCount;
    const beforeCount = state.beforePrimes?.length ?? 0;
    const afterCount = state.afterPrimes?.length ?? 0;
    const total = k * 2;
    return total > 0 ? Math.round(((beforeCount + afterCount) / total) * 100) : 0;
  }

  // Forward sieve mode
  const target = state.targetCount;
  return target > 0 ? Math.round((state.primes.length / target) * 100) : 0;
}
