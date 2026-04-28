/**
 * Hono app factory
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import type { Env } from './types/env.js';
import { setKeyStorageKv } from './config/keys.js';
import { setChunkTimeoutMs } from './services/chunked-sieve.js';
import { tieredRateLimit, tieredExpensiveRateLimit } from './middleware/rate-limit.js';
import { authMiddleware } from './middleware/auth.js';
import { cpuLimitCheck, trackCpuTime } from './middleware/usage.js';

import { statusRoute } from './routes/status.js';
import { capabilitiesRoute } from './routes/capabilities.js';
import { neighborhoodRoute } from './routes/neighborhood.js';
import { gapsRoute } from './routes/gaps.js';
import { secondDifferencesRoute } from './routes/second-differences.js';
import { secondRatiosRoute } from './routes/second-ratios.js';
import { fingerprintRoute } from './routes/fingerprint.js';
import { verifyRoute } from './routes/verify.js';
import { jobsRoute } from './routes/jobs.js';
import { oeisRoute } from './routes/oeis.js';
import { formatsRoute } from './routes/formats.js';
import { flameRoute } from './routes/flame.js';
import { svgRoute } from './routes/svg.js';
import { usersRoute } from './routes/users.js';
import { apiKeysRoute } from './routes/api-keys.js';
import { lppRoute } from './routes/lpp.js';
import { lpp2Route } from './routes/lpp2.js';
import { pulseRoute } from './routes/pulse.js';
import { constellationsRoute } from './routes/constellations.js';
import { benchRoute } from './routes/bench.js';
import { isPrimeRoute } from './routes/isprime.js';

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  // Middleware to set up KV bindings + tunable chunk budget.
  app.use('*', async (c, next) => {
    setKeyStorageKv(c.env?.KEYS_KV);
    const envBudget = c.env?.CHUNK_TIMEOUT_MS;
    if (envBudget) {
      const parsed = parseInt(envBudget, 10);
      if (Number.isFinite(parsed)) setChunkTimeoutMs(parsed);
    }
    await next();
  });

  // Middleware
  // Note: Cloudflare Workers handles compression at the edge
  app.use('*', logger());
  app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    exposeHeaders: ['Content-Length', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'X-CPU-Time-Ms'],
    maxAge: 86400,
  }));

  // Authentication middleware (extracts API key, loads user context)
  app.use('*', authMiddleware());

  // Error handling
  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    return c.json(
      {
        error: 'Internal server error',
        message: err instanceof Error ? err.message : String(err),
      },
      500
    );
  });

  // Not found handler
  app.notFound((c) => {
    return c.json({ error: 'Not found' }, 404);
  });

  // API v1 routes
  const v1 = new Hono<{ Bindings: Env }>();

  // Apply tiered rate limit (varies by user tier, defaults to free tier for unauthenticated)
  v1.use('*', tieredRateLimit());

  // Status and capabilities - lightweight, no additional limits
  v1.route('/status', statusRoute);
  v1.route('/capabilities', capabilitiesRoute);

  // User and API key management routes
  v1.route('/users', usersRoute);
  v1.route('/api-keys', apiKeysRoute);

  // Computation-heavy endpoints - stricter rate limits (varies by tier)
  // Also enforce CPU time limits and track usage
  // Note: Use both exact path and wildcard to match /path and /path/*
  const expensiveMiddleware = [tieredExpensiveRateLimit(), cpuLimitCheck(), trackCpuTime(true)];
  v1.use('/neighborhood', ...expensiveMiddleware);
  v1.use('/neighborhood/*', ...expensiveMiddleware);
  v1.use('/gaps', ...expensiveMiddleware);
  v1.use('/gaps/*', ...expensiveMiddleware);
  v1.use('/second-differences', ...expensiveMiddleware);
  v1.use('/second-differences/*', ...expensiveMiddleware);
  v1.use('/second-ratios', ...expensiveMiddleware);
  v1.use('/second-ratios/*', ...expensiveMiddleware);
  v1.use('/flame', ...expensiveMiddleware);
  v1.use('/flame/*', ...expensiveMiddleware);
  v1.use('/svg', ...expensiveMiddleware);
  v1.use('/svg/*', ...expensiveMiddleware);
  v1.use('/oeis', ...expensiveMiddleware);
  v1.use('/oeis/*', ...expensiveMiddleware);
  v1.use('/formats', ...expensiveMiddleware);
  v1.use('/formats/*', ...expensiveMiddleware);

  v1.route('/neighborhood', neighborhoodRoute);
  v1.route('/gaps', gapsRoute);
  v1.route('/second-differences', secondDifferencesRoute);
  v1.route('/second-ratios', secondRatiosRoute);
  v1.route('/fingerprint', fingerprintRoute);
  v1.route('/verify', verifyRoute);
  v1.route('/jobs', jobsRoute);
  v1.route('/oeis', oeisRoute);
  v1.route('/formats', formatsRoute);
  v1.route('/flame', flameRoute);
  v1.route('/svg', svgRoute);

  // Constellation / k-tuple admissibility + bounded forward search
  v1.use('/constellations', ...expensiveMiddleware);
  v1.use('/constellations/*', ...expensiveMiddleware);
  v1.route('/constellations', constellationsRoute);

  // Empirical engine benchmarks — used to tune chunk timeouts.
  v1.use('/bench', ...expensiveMiddleware);
  v1.use('/bench/*', ...expensiveMiddleware);
  v1.route('/bench', benchRoute);

  // Explicit primality test — the metering unit for the future pricing model.
  v1.use('/isprime', ...expensiveMiddleware);
  v1.use('/isprime/*', ...expensiveMiddleware);
  v1.route('/isprime', isPrimeRoute);

  // LPP routes (Lamish Pulse Protocol)
  v1.route('/lpp', lppRoute);

  // LPP2 routes (enhanced protocol — D1-backed nodes, networks)
  v1.route('/lpp2', lpp2Route);

  // Pulse systems (cosmic, tonga, yad, milli + federation-ready registry).
  // /mint can be CPU-intensive (256-bit BPSW climb); route through the
  // expensive-middleware stack like /isprime + /bench.
  v1.use('/pulse', ...expensiveMiddleware);
  v1.use('/pulse/*', ...expensiveMiddleware);
  v1.route('/pulse', pulseRoute);

  // Mount v1 routes
  app.route('/api/v1', v1);

  // Root redirect to status
  app.get('/', (c) => c.redirect('/api/v1/status'));

  return app;
}
