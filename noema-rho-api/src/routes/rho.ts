import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { query, transaction } from '../db/pg.js';
import { sentenceStep } from '../rho/sentence-step.js';

export const rhoRoute = new Hono();

// ── Validation ────────────────────────────────────────────────────

const SentenceStepRequestZ = z.object({
  subject_lens_id: z.string().min(8),
  doc: z.object({
    doc_id: z.string().min(8),
    source_type: z.enum(['chat', 'email', 'post', 'note', 'doc', 'other']),
    author: z.string().optional(),
    timestamp: z.string().optional(),
  }),
  sentence: z.object({
    sentence_id: z.string().min(8),
    text: z.string().min(1),
    index_in_doc: z.number().int().nonnegative().optional(),
    char_start: z.number().int().nonnegative().optional(),
    char_end: z.number().int().nonnegative().optional(),
  }),
  context: z
    .object({
      prev_sentence_text: z.string().optional(),
      next_sentence_text: z.string().optional(),
      window_text: z.string().optional(),
    })
    .optional(),
  expected_step_index: z.number().int().nonnegative().optional(),
});

// ── POST /sentence_step ───────────────────────────────────────────

rhoRoute.post('/sentence_step', async (c) => {
  const parsed = SentenceStepRequestZ.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'bad_request', message: 'Invalid request', details: parsed.error.flatten() }, 400);
  }
  const req = parsed.data;
  const nowIso = new Date().toISOString();
  const eventId = randomUUID();

  const result = await transaction(async (client) => {
    // Ensure lens exists
    const lensCheck = await client.query('SELECT id FROM subject_lenses WHERE id = $1', [req.subject_lens_id]);
    if (lensCheck.rows.length === 0) {
      throw Object.assign(new Error('Lens not found'), { status: 404 });
    }

    // Ensure doc exists (idempotent upsert)
    await client.query(
      `INSERT INTO documents (id, source_type, author, ts)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET source_type = EXCLUDED.source_type,
             author = EXCLUDED.author,
             ts = EXCLUDED.ts,
             updated_at = now()`,
      [req.doc.doc_id, req.doc.source_type, req.doc.author ?? null, req.doc.timestamp ?? null]
    );

    // Ensure sentence exists (idempotent upsert)
    await client.query(
      `INSERT INTO sentences (id, doc_id, idx_in_doc, text, char_start, char_end)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
         SET doc_id = EXCLUDED.doc_id,
             idx_in_doc = EXCLUDED.idx_in_doc,
             text = EXCLUDED.text,
             char_start = EXCLUDED.char_start,
             char_end = EXCLUDED.char_end`,
      [
        req.sentence.sentence_id,
        req.doc.doc_id,
        req.sentence.index_in_doc ?? null,
        req.sentence.text,
        req.sentence.char_start ?? null,
        req.sentence.char_end ?? null,
      ]
    );

    // Compute next step_index
    const last = await client.query<{ step_index: number }>(
      'SELECT step_index FROM noesis_events WHERE subject_lens_id = $1 ORDER BY step_index DESC LIMIT 1',
      [req.subject_lens_id]
    );
    const nextStep = (last.rows[0]?.step_index ?? -1) + 1;

    if (req.expected_step_index !== undefined && req.expected_step_index !== nextStep) {
      throw Object.assign(new Error('concurrency_conflict'), {
        status: 409,
        details: { expected: req.expected_step_index, actual: nextStep },
      });
    }

    // ── Real sentence step pipeline ──
    return await sentenceStep(client, req, eventId, nextStep, nowIso);
  });

  return c.json(result);
});

// ── GET /timeline/object/:object_id ───────────────────────────────

rhoRoute.get('/timeline/object/:object_id', async (c) => {
  const objectId = c.req.param('object_id');
  const lensId = c.req.query('lens_id');
  if (!lensId) {
    return c.json({ error: 'bad_request', message: 'lens_id query parameter is required' }, 400);
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '200', 10), 2000);
  const fromStep = c.req.query('from_step');
  const toStep = c.req.query('to_step');

  let sql = `
    SELECT id, doc_id, sentence_id, step_index, subject_lens_id,
           invoked_objects_jsonb AS invoked_objects,
           acts_jsonb AS acts, delta_jsonb AS delta,
           metrics_jsonb AS metrics, explanations_jsonb AS explanations,
           created_at
    FROM noesis_events
    WHERE subject_lens_id = $1
      AND invoked_objects_jsonb @> $2::jsonb
  `;
  const params: unknown[] = [lensId, JSON.stringify([objectId])];
  let paramIdx = 3;

  if (fromStep !== undefined) {
    sql += ` AND step_index >= $${paramIdx}`;
    params.push(parseInt(fromStep, 10));
    paramIdx++;
  }
  if (toStep !== undefined) {
    sql += ` AND step_index <= $${paramIdx}`;
    params.push(parseInt(toStep, 10));
    paramIdx++;
  }

  sql += ` ORDER BY step_index ASC LIMIT $${paramIdx}`;
  params.push(limit);

  const events = await query(sql, params);
  return c.json({ object_id: objectId, lens_id: lensId, events });
});

// ── GET /snapshot ─────────────────────────────────────────────────

rhoRoute.get('/snapshot', async (c) => {
  const lensId = c.req.query('lens_id');
  const step = c.req.query('step');
  if (!lensId || step === undefined) {
    return c.json({ error: 'bad_request', message: 'lens_id and step query parameters are required' }, 400);
  }

  const stepNum = parseInt(step, 10);
  const mode = c.req.query('mode') || 'nearest';

  let rows;
  if (mode === 'exact') {
    rows = await query(
      `SELECT id, subject_lens_id, step_index,
              rho_objects_jsonb AS objects, rho_edges_jsonb AS edges,
              metrics_jsonb AS metrics, updated_at
       FROM rho_snapshots
       WHERE subject_lens_id = $1 AND step_index = $2`,
      [lensId, stepNum]
    );
  } else {
    // nearest: closest step_index <= requested
    rows = await query(
      `SELECT id, subject_lens_id, step_index,
              rho_objects_jsonb AS objects, rho_edges_jsonb AS edges,
              metrics_jsonb AS metrics, updated_at
       FROM rho_snapshots
       WHERE subject_lens_id = $1 AND step_index <= $2
       ORDER BY step_index DESC
       LIMIT 1`,
      [lensId, stepNum]
    );
  }

  if (!rows.length) {
    return c.json({ error: 'not_found', message: 'Snapshot not found' }, 404);
  }

  const snap = rows[0];
  return c.json({
    lens_id: snap.subject_lens_id,
    step_index: snap.step_index,
    rho_summary: {
      t: snap.step_index,
      subject_lens_id: snap.subject_lens_id,
      objects: snap.objects,
      edges: snap.edges,
      metrics: snap.metrics,
      updated_at: snap.updated_at,
    },
  });
});

// ── GET /drift/top ────────────────────────────────────────────────

rhoRoute.get('/drift/top', async (c) => {
  const lensId = c.req.query('lens_id');
  const fromStep = c.req.query('from_step');
  const toStep = c.req.query('to_step');
  if (!lensId || fromStep === undefined || toStep === undefined) {
    return c.json({ error: 'bad_request', message: 'lens_id, from_step, and to_step are required' }, 400);
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 500);

  // Aggregate salience deltas per object across the step range
  const rows = await query(
    `SELECT obj_key, SUM((obj_val->>'salience')::float) AS score
     FROM noesis_events,
          jsonb_each(delta_jsonb->'objects') AS kv(obj_key, obj_val)
     WHERE subject_lens_id = $1
       AND step_index >= $2
       AND step_index <= $3
     GROUP BY obj_key
     ORDER BY score DESC
     LIMIT $4`,
    [lensId, parseInt(fromStep, 10), parseInt(toStep, 10), limit]
  );

  return c.json({
    lens_id: lensId,
    from_step: parseInt(fromStep, 10),
    to_step: parseInt(toStep, 10),
    items: rows.map((r: any) => ({ object_id: r.obj_key, score: parseFloat(r.score) })),
  });
});
