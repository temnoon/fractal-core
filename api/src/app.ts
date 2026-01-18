/**
 * Hono app factory
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { compress } from 'hono/compress';

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

export function createApp() {
  const app = new Hono();

  // Middleware
  app.use('*', logger());
  app.use('*', cors());
  app.use('*', compress());

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
  const v1 = new Hono();

  v1.route('/status', statusRoute);
  v1.route('/capabilities', capabilitiesRoute);
  v1.route('/neighborhood', neighborhoodRoute);
  v1.route('/gaps', gapsRoute);
  v1.route('/second-differences', secondDifferencesRoute);
  v1.route('/second-ratios', secondRatiosRoute);
  v1.route('/fingerprint', fingerprintRoute);
  v1.route('/verify', verifyRoute);
  v1.route('/jobs', jobsRoute);
  v1.route('/oeis', oeisRoute);
  v1.route('/formats', formatsRoute);

  // Mount v1 routes
  app.route('/api/v1', v1);

  // Root redirect to status
  app.get('/', (c) => c.redirect('/api/v1/status'));

  return app;
}
