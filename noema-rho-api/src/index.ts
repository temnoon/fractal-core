/**
 * Noema-Rho API - Entry point
 */

import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const app = createApp();
const port = parseInt(process.env.PORT || '3001', 10);

console.log(`Noema-Rho API starting on port ${port}...`);

serve({
  fetch: app.fetch,
  port,
});

console.log(`Server running at http://localhost:${port}`);
console.log(`API base: http://localhost:${port}/v1`);
console.log(`Health:   http://localhost:${port}/v1/health`);
