/**
 * Neighborhood endpoint - full prime neighborhood data
 *
 * Large requests that would exceed CPU time are automatically redirected
 * to the async job queue and return 202 with a poll URL.
 */

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import type { AuthContext } from '../types/user.js';
import { NeighborhoodQuerySchema, toCanonicalRequest } from '../schemas/query-params.js';
import { computeNeighborhood, parseComputeOptions, toNeighborhoodResult } from '../services/neighborhood.js';
import { validateNeighborhood } from '../services/validation.js';
import { computeRequestHash, computeResultHash } from '../crypto/hashing.js';
import { signResponse } from '../crypto/signing.js';
import { getPrimaryKeyPair } from '../config/keys.js';
import { needsAsyncProcessing, createJob, advanceJob } from '../services/job-queue.js';
import type { SignedResponse, Receipt } from '../types/api.js';

export const neighborhoodRoute = new Hono<{ Bindings: Env }>();

neighborhoodRoute.get('/', async (c) => {
  // Parse and validate query parameters
  const queryResult = NeighborhoodQuerySchema.safeParse(c.req.query());

  if (!queryResult.success) {
    return c.json(
      {
        error: 'Invalid query parameters',
        details: queryResult.error.issues,
      },
      400
    );
  }

  const query = queryResult.data;
  const request = toCanonicalRequest(query);

  // Check if this request needs async processing
  if (needsAsyncProcessing(request)) {
    const kv = c.env?.JOBS_KV;
    const auth = c.get('auth') as AuthContext | null;
    const userId = auth?.user.id;

    const job = await createJob(kv, request, userId);

    // Fire first chunk of processing
    c.executionCtx.waitUntil(advanceJob(kv, job.id));

    return c.json({
      message: 'Request too large for synchronous processing. Job created.',
      job_id: job.id,
      poll_url: `/api/v1/jobs/${job.id}`,
      result_url: `/api/v1/jobs/${job.id}/result`,
    }, 202);
  }

  // Compute neighborhood synchronously
  const options = parseComputeOptions(request);
  const data = computeNeighborhood(options);
  let result = toNeighborhoodResult(request, data);

  // Stats-only response (no full lists)
  if (request.stats_only) {
    const include = new Set(request.include);
    const topN = request.top_n ?? 10;

    function topStats(values: string[], n: number) {
      const counts: Record<string, number> = {};
      for (const v of values) {
        counts[v] = (counts[v] || 0) + 1;
      }
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([value, count]) => ({ value, count, pct: values.length ? Math.round((count / values.length) * 1000) / 10 : 0 }));
    }

    const stats: NonNullable<typeof result.stats> = {};

    if (include.has('gaps') && result.gaps) {
      stats.gaps = topStats(result.gaps, topN);
    }
    if (include.has('d2') && result.d2) {
      stats.d2 = topStats(result.d2, topN);
    }
    if (include.has('ratio') && result.ratio) {
      const ratioStrs = result.ratio.map(r => `${r.num}/${r.den}`);
      stats.ratio = topStats(ratioStrs, topN);
    }

    result = {
      n: result.n,
      n_type: result.n_type,
      mode: result.mode,
      center_prime: result.center_prime,
      stats,
    };
  }

  // Validate if requested
  const validation = validateNeighborhood(data, request.validate);

  // Build response based on proof level
  if (request.proof === 'none') {
    // Simple response without proof
    const response: SignedResponse = {
      request,
      result,
    };
    return c.json(response);
  }

  // Build receipt
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
    const response: SignedResponse = {
      request,
      result,
      receipt,
    };
    return c.json(response);
  }

  // proof === 'signed'
  const keyPair = getPrimaryKeyPair();
  if (!keyPair) {
    return c.json({ error: 'Signing key not available' }, 500);
  }

  const signature = signResponse(request, result, receipt, keyPair);

  const response: SignedResponse = {
    request,
    result,
    receipt,
    signature,
  };

  return c.json(response);
});
