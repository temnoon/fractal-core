/**
 * In-memory job queue for async processing
 */

import { bytesToHex } from '@noble/hashes/utils';
import type { Job, JobStatus, CanonicalRequest, SignedResponse, Receipt } from '../types/api.js';
import { computeNeighborhood, parseComputeOptions, toNeighborhoodResult } from './neighborhood.js';
import { validateNeighborhood } from './validation.js';
import { computeRequestHash, computeResultHash } from '../crypto/hashing.js';
import { signResponse } from '../crypto/signing.js';
import { getPrimaryKeyPair } from '../config/keys.js';

// In-memory job storage
const jobs = new Map<string, Job>();

// Configuration
const MAX_JOBS = 100;

/**
 * Generate a unique job ID
 */
function generateJobId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/**
 * Create a new job
 */
export function createJob(request: CanonicalRequest): Job {
  // Enforce max jobs limit
  if (jobs.size >= MAX_JOBS) {
    // Remove oldest completed job
    for (const [id, job] of jobs) {
      if (job.status === 'completed' || job.status === 'failed') {
        jobs.delete(id);
        break;
      }
    }
  }

  const job: Job = {
    id: generateJobId(),
    status: 'pending',
    request,
    created_at: new Date().toISOString(),
  };

  jobs.set(job.id, job);

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
