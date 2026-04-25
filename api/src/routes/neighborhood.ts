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
import { computeNeighborhood, computeNeighborhoodExtras, parseComputeOptions, toNeighborhoodResult } from '../services/neighborhood.js';
import {
  summarizeMerit,
  summarizeCramer,
  summarizeResidueRace,
  summarizeTheta,
  summarizeConstellations,
} from '../services/lib/stats.js';
import { withAuditSync, type AuditLevel } from '../services/lib/audit.js';
import { withMeter } from '../services/lib/op-meter.js';
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

  // Compute neighborhood synchronously, optionally with verbose audit logging.
  const options = parseComputeOptions(request);
  const verbose = !!query.verbose;
  const auditLevel = (query.audit_level ?? 'milestone') as AuditLevel;

  const meterRun = withMeter(() =>
    withAuditSync({ enabled: verbose, level: auditLevel }, () => {
      const data = computeNeighborhood(options);
      const extras = computeNeighborhoodExtras(data, request.include, request.modulus);
      return { data, extras };
    }),
  );
  const auditRun = meterRun.result;
  const data = auditRun.result.data;
  const extras = auditRun.result.extras;
  let result = toNeighborhoodResult(request, data, extras);

  // Stash counters on the context so trackCpuTime middleware can persist them.
  c.set('opCounters', meterRun.counters);

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

    // Number-theory summaries — preserve research-grade aggregates rather
    // than dropping the fields wholesale as the previous version did.
    if (include.has('merit') && extras.merit && extras.maxMerit) {
      stats.merit = summarizeMerit(
        data.primes,
        data.gaps,
        extras.merit,
        extras.cramer ?? extras.merit.map(() => 0),
        topN,
        extras.maxMerit,
      );
    }
    if (include.has('cramer') && extras.cramer && extras.maxCramer) {
      stats.cramer = summarizeCramer(
        data.primes,
        data.gaps,
        extras.merit ?? extras.cramer.map(() => 0),
        extras.cramer,
        topN,
        extras.maxCramer,
      );
    }
    if ((include.has('residue') || include.has('residue_running')) && extras.residueRace) {
      stats.residue = summarizeResidueRace(extras.residueRace, data.primes.length);
    }
    if (include.has('theta') && extras.theta) {
      stats.theta = summarizeTheta(extras.theta, data.primes);
    }
    if (include.has('constellations') && extras.constellations) {
      stats.constellations = summarizeConstellations(extras.constellations, data.primes);
    }

    // Replace the result with a stats-only shape. Note: the request echo's
    // `include` is intentionally preserved; consumers of the receipt can see
    // exactly which fields were summarized vs. omitted.
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
    const response: SignedResponse & { audit?: typeof auditRun.events; audit_truncated?: boolean } = {
      request,
      result,
    };
    if (verbose) {
      response.audit = auditRun.events;
      if (auditRun.truncated) response.audit_truncated = true;
    }
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
