/**
 * Entry point for Prime Terrain API server
 */

import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const app = createApp();
const port = parseInt(process.env.PORT || '3000', 10);

console.log(`Prime Terrain API starting on port ${port}...`);

serve({
  fetch: app.fetch,
  port,
});

console.log(`Server running at http://localhost:${port}`);
console.log(`API base URL: http://localhost:${port}/api/v1`);
