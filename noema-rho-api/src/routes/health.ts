import { Hono } from 'hono';
import { query } from '../db/pg.js';

export const healthRoute = new Hono();

healthRoute.get('/', async (c) => {
  try {
    const rows = await query<{ now: string }>('SELECT now() AS now');
    return c.json({ status: 'ok', version: '1.0.0', db: { now: rows[0]?.now } });
  } catch (e) {
    return c.json({ status: 'error', version: '1.0.0', db: { error: String(e) } }, 500);
  }
});

export const capabilitiesRoute = new Hono();

capabilitiesRoute.get('/', (c) => {
  return c.json({
    supportsBranches: false,
    supportsEmbeddings: false,
    dbFlavor: 'postgres',
    maxBatchSize: 500,
  });
});
