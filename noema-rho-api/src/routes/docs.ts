import { Hono } from 'hono';
import { query } from '../db/pg.js';

export const docsRoute = new Hono();

// Upsert document metadata
docsRoute.post('/upsert', async (c) => {
  const body = await c.req.json();
  const doc = body?.doc;
  if (!doc?.doc_id || !doc?.source_type) {
    return c.json({ error: 'bad_request', message: 'doc.doc_id and doc.source_type are required' }, 400);
  }

  await query(
    `INSERT INTO documents (id, source_type, author, ts, meta_jsonb)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (id) DO UPDATE
       SET source_type = EXCLUDED.source_type,
           author = EXCLUDED.author,
           ts = EXCLUDED.ts,
           meta_jsonb = EXCLUDED.meta_jsonb,
           updated_at = now()`,
    [doc.doc_id, doc.source_type, doc.author ?? null, doc.timestamp ?? null, doc.meta ? JSON.stringify(doc.meta) : null]
  );

  return c.json({ doc_id: doc.doc_id });
});

// Upsert sentences (batch)
docsRoute.post('/sentences/upsert', async (c) => {
  const body = await c.req.json();
  const doc_id = body?.doc_id;
  const sentences = body?.sentences;
  if (!doc_id || !Array.isArray(sentences) || sentences.length === 0) {
    return c.json({ error: 'bad_request', message: 'doc_id and non-empty sentences[] are required' }, 400);
  }

  const ids: string[] = [];
  for (const s of sentences) {
    if (!s?.sentence_id || !s?.text) continue;
    ids.push(s.sentence_id);
    await query(
      `INSERT INTO sentences (id, doc_id, idx_in_doc, text, char_start, char_end)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
         SET doc_id = EXCLUDED.doc_id,
             idx_in_doc = EXCLUDED.idx_in_doc,
             text = EXCLUDED.text,
             char_start = EXCLUDED.char_start,
             char_end = EXCLUDED.char_end`,
      [s.sentence_id, doc_id, s.index_in_doc ?? null, s.text, s.char_start ?? null, s.char_end ?? null]
    );
  }

  return c.json({ doc_id, sentence_ids: ids });
});

// Get document by id
docsRoute.get('/:id', async (c) => {
  const rows = await query(
    'SELECT id, source_type, author, ts, meta_jsonb AS meta, created_at, updated_at FROM documents WHERE id = $1',
    [c.req.param('id')]
  );
  if (!rows.length) {
    return c.json({ error: 'not_found', message: 'Document not found' }, 404);
  }
  return c.json(rows[0]);
});
