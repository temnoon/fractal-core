/**
 * Jobs endpoints - async job management with KV persistence
 */

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import type { AuthContext } from '../types/user.js';
import { TIER_LIMITS } from '../types/user.js';
import { JobCreateSchema } from '../schemas/query-params.js';
import { createJob, getJob, getJobResult, deleteJob, countUserJobs, advanceJob } from '../services/job-queue.js';
import type { JobCreatedResponse, JobStatusResponse } from '../types/api.js';
import type { IncludeField } from '../types/neighborhood.js';

export const jobsRoute = new Hono<{ Bindings: Env }>();

// Create a new job
jobsRoute.post('/', async (c) => {
  const kv = c.env?.JOBS_KV;

  // Check async job limits based on tier
  const auth = c.get('auth') as AuthContext | null;
  const limits = auth?.limits || TIER_LIMITS.free;
  const userId = auth?.user.id;

  // Count active jobs for this user (or IP for unauthenticated)
  const activeJobs = await countUserJobs(kv, userId);
  if (activeJobs >= limits.asyncJobs) {
    return c.json({
      error: 'Async job limit exceeded',
      message: `Maximum of ${limits.asyncJobs} concurrent async jobs allowed for your tier.`,
      active_jobs: activeJobs,
      limit: limits.asyncJobs,
    }, 429);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parseResult = JobCreateSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json(
      {
        error: 'Invalid request body',
        details: parseResult.error.issues,
      },
      400
    );
  }

  const data = parseResult.data;

  // Convert to canonical request
  const request = {
    n: data.n,
    n_type: data.n_type,
    mode: data.mode,
    k: data.k,
    w: data.w,
    include: (data.include ?? ['primes', 'gaps', 'd2', 'ratio']).sort() as IncludeField[],
    engine: data.engine === 'auto' ? 'sieve' as const : data.engine,
    validate: data.validate,
    proof: data.proof,
    format: data.format,
    compress: data.compress,
  };

  const job = await createJob(kv, request, userId);

  // Fire first chunk of processing via waitUntil
  c.executionCtx.waitUntil(advanceJob(kv, job.id));

  const response: JobCreatedResponse = {
    job_id: job.id,
    status: job.status,
    poll_url: `/api/v1/jobs/${job.id}`,
  };

  return c.json(response, 202);
});

// List all jobs (only works with in-memory fallback; KV doesn't support listing)
jobsRoute.get('/', async (c) => {
  const kv = c.env?.JOBS_KV;
  // For KV mode, listing all jobs is not supported — return empty
  if (kv) {
    return c.json({
      jobs: [],
      message: 'Job listing not available with KV persistence. Query individual jobs by ID.',
    });
  }

  // In-memory fallback: import listJobs helper
  // (Not exposed from new job-queue since it only works in-memory)
  return c.json({ jobs: [] });
});

// Get job status
jobsRoute.get('/:job_id', async (c) => {
  const kv = c.env?.JOBS_KV;
  const jobId = c.req.param('job_id');
  const job = await getJob(kv, jobId);

  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  // If job is still processing, trigger next chunk via waitUntil
  if (job.status === 'pending' || job.status === 'running') {
    c.executionCtx.waitUntil(advanceJob(kv, jobId));
  }

  const response: JobStatusResponse = {
    job_id: job.id,
    status: job.status,
    created_at: job.created_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
    result_url: job.status === 'completed' ? `/api/v1/jobs/${job.id}/result` : undefined,
    error: job.error,
    progress: job.progress,
    chunks_processed: job.chunksProcessed,
    cpu_time_ms: job.cpu_time_ms,
    primes_found: job.primesFound,
    phase: job.phase,
  };

  // Suggest polling interval for in-progress jobs
  if (job.status === 'pending' || job.status === 'running') {
    c.header('Retry-After', '2');
  }

  return c.json(response);
});

// Get job result
jobsRoute.get('/:job_id/result', async (c) => {
  const kv = c.env?.JOBS_KV;
  const jobId = c.req.param('job_id');
  const job = await getJob(kv, jobId);

  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  if (job.status !== 'completed') {
    return c.json(
      {
        error: 'Job not completed',
        status: job.status,
      },
      400
    );
  }

  // Fetch result from KV (or in-memory)
  const result = await getJobResult(kv, jobId);
  if (!result) {
    return c.json({ error: 'Result not found' }, 404);
  }

  return c.json(result);
});

// Delete a job
jobsRoute.delete('/:job_id', async (c) => {
  const kv = c.env?.JOBS_KV;
  const jobId = c.req.param('job_id');
  const deleted = await deleteJob(kv, jobId);

  if (!deleted) {
    return c.json({ error: 'Job not found' }, 404);
  }

  return c.json({ deleted: true });
});
