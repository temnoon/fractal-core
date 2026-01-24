/**
 * In-memory job queue for async processing
 *
 * Supports chunked processing for large calculations that would
 * exceed Workers CPU time limits.
 */

import { bytesToHex } from '@noble/hashes/utils';
import type { Job, JobStatus, CanonicalRequest, SignedResponse, Receipt } from '../types/api.js';
import { computeNeighborhood, parseComputeOptions, toNeighborhoodResult } from './neighborhood.js';
import { validateNeighborhood } from './validation.js';
import { computeRequestHash, computeResultHash } from '../crypto/hashing.js';
import { signResponse } from '../crypto/signing.js';
import { getPrimaryKeyPair } from '../config/keys.js';
import { findPrimesAroundLargeIndex } from './chunked-sieve.js';

// In-memory job storage
const jobs = new Map<string, Job>();

// Track jobs by user for limit enforcement
const jobsByUser = new Map<string, Set<string>>();

// Configuration
const MAX_JOBS = 100;

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

/**
 * Count active (non-completed) jobs for a user
 */
export function countUserJobs(userId?: string): number {
  if (!userId) {
    // For unauthenticated users, count all jobs (limited globally)
    let count = 0;
    for (const job of jobs.values()) {
      if (job.status === 'pending' || job.status === 'running') {
        count++;
      }
    }
    return count;
  }

  const userJobIds = jobsByUser.get(userId);
  if (!userJobIds) return 0;

  let count = 0;
  for (const jobId of userJobIds) {
    const job = jobs.get(jobId);
    if (job && (job.status === 'pending' || job.status === 'running')) {
      count++;
    }
  }
  return count;
}

/**
 * Create a new job
 */
export function createJob(request: CanonicalRequest, userId?: string): Job {
  // Enforce max jobs limit
  if (jobs.size >= MAX_JOBS) {
    // Remove oldest completed job
    for (const [id, job] of jobs) {
      if (job.status === 'completed' || job.status === 'failed') {
        jobs.delete(id);
        // Clean up user tracking
        if ((job as any).userId) {
          const userJobs = jobsByUser.get((job as any).userId);
          userJobs?.delete(id);
        }
        break;
      }
    }
  }

  const job: Job & { userId?: string } = {
    id: generateJobId(),
    status: 'pending',
    request,
    created_at: new Date().toISOString(),
    userId,
  };

  jobs.set(job.id, job);

  // Track by user
  if (userId) {
    if (!jobsByUser.has(userId)) {
      jobsByUser.set(userId, new Set());
    }
    jobsByUser.get(userId)!.add(job.id);
  }

  // Start processing asynchronously
  processJob(job.id);

  return job;
}

/**
 * Get a job by ID
 */
export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

/**
 * List all jobs
 */
export function listJobs(): Job[] {
  return Array.from(jobs.values());
}

/**
 * Delete a job
 */
export function deleteJob(id: string): boolean {
  return jobs.delete(id);
}

// Threshold for using chunked processing
const LARGE_INDEX_THRESHOLD = 500_000;

/**
 * Process a job asynchronously
 */
async function processJob(jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  // Update status to running
  job.status = 'running';
  job.started_at = new Date().toISOString();

  try {
    // Small delay to simulate async processing
    await new Promise((resolve) => setTimeout(resolve, 10));

    const request = job.request;
    const centerIndex = request.n_type === 'index' ? parseInt(request.n) : 0;
    const k = request.k ?? 10;

    // Check if we need chunked processing for large indices
    if (centerIndex > LARGE_INDEX_THRESHOLD) {
      // Use chunked sieve for large calculations
      const largeResult = await findPrimesAroundLargeIndex(undefined, centerIndex, k);

      // Build neighborhood data from chunked result
      const primes = largeResult.primes;
      const indices = largeResult.indices;
      const gaps: bigint[] = [];
      const d2: bigint[] = [];
      const ratios: { num: string; den: string }[] = [];

      // Calculate gaps
      for (let i = 1; i < primes.length; i++) {
        gaps.push(primes[i] - primes[i - 1]);
      }

      // Calculate d2
      for (let i = 1; i < gaps.length; i++) {
        d2.push(gaps[i] - gaps[i - 1]);
      }

      // Calculate ratios
      for (let i = 0; i < d2.length && i + 2 < primes.length; i++) {
        const span = primes[i + 2] - primes[i];
        const g = gcd(d2[i] < 0n ? -d2[i] : d2[i], span);
        ratios.push({
          num: (d2[i] / g).toString(),
          den: (span / g).toString(),
        });
      }

      const result = {
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

      const receipt: Receipt = {
        request_hash: computeRequestHash(request),
        result_hash: computeResultHash(result),
        engines: ['bpsw'],
        validation: {
          mode: 'none',
          agreement: true,
        },
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

      job.status = 'completed';
      job.completed_at = new Date().toISOString();
      job.result = response;
      return;
    }

    // Standard processing for smaller indices
    const options = parseComputeOptions(request);
    const data = computeNeighborhood(options);
    const result = toNeighborhoodResult(request, data);
    const validation = validateNeighborhood(data, request.validate);

    let response: SignedResponse;

    if (request.proof === 'none') {
      response = { request, result };
    } else {
      const receipt: Receipt = {
        request_hash: computeRequestHash(request),
        result_hash: computeResultHash(result),
        engines: validation.engines,
        validation: {
          mode: validation.mode,
          agreement: validation.agreement,
        },
        deterministic: true,
        generated_at: new Date().toISOString(),
      };

      if (request.proof === 'receipt') {
        response = { request, result, receipt };
      } else {
        const keyPair = getPrimaryKeyPair();
        if (!keyPair) {
          throw new Error('Signing key not available');
        }
        const signature = signResponse(request, result, receipt, keyPair);
        response = { request, result, receipt, signature };
      }
    }

    job.status = 'completed';
    job.completed_at = new Date().toISOString();
    job.result = response;
  } catch (error) {
    job.status = 'failed';
    job.completed_at = new Date().toISOString();
    job.error = error instanceof Error ? error.message : String(error);
  }
}
