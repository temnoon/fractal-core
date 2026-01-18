/**
 * Status endpoint - service health check
 */

import { Hono } from 'hono';
import type { StatusResponse } from '../types/api.js';

const startTime = Date.now();

export const statusRoute = new Hono();

statusRoute.get('/', (c) => {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  const response: StatusResponse = {
    status: 'ok',
    version: '1.0.0',
    uptime_seconds: uptimeSeconds,
  };

  return c.json(response);
});
