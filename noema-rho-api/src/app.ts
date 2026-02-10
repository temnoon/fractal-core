/**
 * Noema-Rho API - Hono app factory
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { healthRoute, capabilitiesRoute } from './routes/health.js';
import { lensesRoute } from './routes/lenses.js';
import { noemaRoute } from './routes/noema.js';
import { docsRoute } from './routes/docs.js';
import { rhoRoute } from './routes/rho.js';

export function createApp() {
  const app = new Hono();

  // Middleware
  app.use('*', logger());
  app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }));

  // Error handling
  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    const status = (err as any).status ?? 500;
    return c.json(
      {
        error: err.message || 'Internal server error',
        message: err instanceof Error ? err.message : String(err),
        details: (err as any).details,
      },
      status
    );
  });

  app.notFound((c) => c.json({ error: 'not_found', message: 'Not found' }, 404));

  // API v1 routes
  const v1 = new Hono();

  v1.route('/health', healthRoute);
  v1.route('/capabilities', capabilitiesRoute);
  v1.route('/lenses', lensesRoute);
  v1.route('/noema', noemaRoute);
  v1.route('/docs', docsRoute);
  v1.route('/rho', rhoRoute);

  // Mount v1
  app.route('/v1', v1);

  // Root redirect
  app.get('/', (c) => c.redirect('/v1/health'));

  return app;
}
