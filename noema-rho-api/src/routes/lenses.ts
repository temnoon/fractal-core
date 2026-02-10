import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { query } from '../db/pg.js';

export const lensesRoute = new Hono();

// Create subject lens
lensesRoute.post('/', async (c) => {
  const body = await c.req.json();
  const label = String(body?.label ?? '').trim();
  if (!label) {
    return c.json({ error: 'bad_request', message: 'label is required' }, 400);
  }

  const id = body?.id?.toString?.() ?? randomUUID();
  const description = body?.description?.toString?.() ?? null;
  const sic_pack_id = body?.sic_pack_id?.toString?.() ?? null;

  await query(
    `INSERT INTO subject_lenses (id, label, description, sic_pack_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE
       SET label = EXCLUDED.label,
           description = EXCLUDED.description,
           sic_pack_id = EXCLUDED.sic_pack_id,
           updated_at = now()`,
    [id, label, description, sic_pack_id]
  );

  const rows = await query(
    'SELECT id, label, description, sic_pack_id, created_at, updated_at FROM subject_lenses WHERE id = $1',
    [id]
  );
  return c.json(rows[0], 201);
});

// List lenses
lensesRoute.get('/', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const rows = await query(
    'SELECT id, label, description, sic_pack_id, created_at, updated_at FROM subject_lenses ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return c.json({ items: rows });
});

// Get lens by id
lensesRoute.get('/:id', async (c) => {
  const rows = await query(
    'SELECT id, label, description, sic_pack_id, created_at, updated_at FROM subject_lenses WHERE id = $1',
    [c.req.param('id')]
  );
  if (!rows.length) {
    return c.json({ error: 'not_found', message: 'Lens not found' }, 404);
  }
  return c.json(rows[0]);
});
