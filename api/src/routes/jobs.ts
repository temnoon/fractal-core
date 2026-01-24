/**
 * Jobs endpoints - async job management
 */

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import type { AuthContext } from '../types/user.js';
import { TIER_LIMITS } from '../types/user.js';
import { JobCreateSchema, toCanonicalRequest } from '../schemas/query-params.js';
import { createJob, getJob, listJobs, deleteJob, countUserJobs } from '../services/job-queue.js';
import type { JobCreatedResponse, JobStatusResponse } from '../types/api.js';
import type { IncludeField } from '../types/neighborhood.js';

export const jobsRoute = new Hono<{ Bindings: Env }>();

// Create a new job
jobsRoute.post('/', async (c) => {
  // Check async job limits based on tier
  const auth = c.get('auth') as AuthContext | null;
  const limits = auth?.limits || TIER_LIMITS.free;
  const userId = auth?.user.id;

  // Count active jobs for this user (or IP for unauthenticated)
  const activeJobs = countUserJobs(userId);
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

  const job = createJob(request, userId);

  const response: JobCreatedResponse = {
    job_id: job.id,
    status: job.status,
    poll_url: `/api/v1/jobs/${job.id}`,
  };

  return c.json(response, 202);
});

// List all jobs
jobsRoute.get('/', (c) => {
  const jobs = listJobs();
  return c.json({
    jobs: jobs.map((job) => ({
      job_id: job.id,
      status: job.status,
      created_at: job.created_at,
      started_at: job.started_at,
      completed_at: job.completed_at,
    })),
  });
});

// Get job status
jobsRoute.get('/:job_id', (c) => {
  const jobId = c.req.param('job_id');
  const job = getJob(jobId);

  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  const response: JobStatusResponse = {
    job_id: job.id,
    status: job.status,
    created_at: job.created_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
    result_url: job.status === 'completed' ? `/api/v1/jobs/${job.id}/result` : undefined,
    error: job.error,
  };

  return c.json(response);
});

// Get job result
jobsRoute.get('/:job_id/result', (c) => {
  const jobId = c.req.param('job_id');
  const job = getJob(jobId);

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

  return c.json(job.result);
});

// Delete a job
jobsRoute.delete('/:job_id', (c) => {
  const jobId = c.req.param('job_id');
  const deleted = deleteJob(jobId);

  if (!deleted) {
    return c.json({ error: 'Job not found' }, 404);
  }

  return c.json({ deleted: true });
});
