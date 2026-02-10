import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { query } from '../db/pg.js';

export const noemaRoute = new Hono();

// Upsert eidetic objects (batch)
noemaRoute.post('/objects/upsert', async (c) => {
  const body = await c.req.json();
  const objects = body?.objects;
  if (!Array.isArray(objects) || objects.length === 0) {
    return c.json({ error: 'bad_request', message: 'objects[] is required and must be non-empty' }, 400);
  }

  const ids: string[] = [];
  for (const obj of objects) {
    const id = obj.id ?? randomUUID();
    ids.push(id);
    await query(
      `INSERT INTO eidetic_objects (id, type, labels_jsonb, facets_jsonb, provenance_jsonb, embedding_jsonb, canonicality_score)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7)
       ON CONFLICT (id) DO UPDATE
         SET type = EXCLUDED.type,
             labels_jsonb = EXCLUDED.labels_jsonb,
             facets_jsonb = EXCLUDED.facets_jsonb,
             provenance_jsonb = EXCLUDED.provenance_jsonb,
             embedding_jsonb = EXCLUDED.embedding_jsonb,
             canonicality_score = EXCLUDED.canonicality_score,
             updated_at = now()`,
      [
        id,
        obj.type ?? 'Other',
        JSON.stringify(obj.labels ?? []),
        JSON.stringify(obj.facets ?? {}),
        JSON.stringify(obj.provenance ?? []),
        obj.embedding ? JSON.stringify(obj.embedding) : null,
        obj.canonicality_score ?? null,
      ]
    );
  }
  return c.json({ upserted_ids: ids });
});

// Get eidetic object by id
noemaRoute.get('/objects/:id', async (c) => {
  const rows = await query(
    `SELECT id, type, labels_jsonb AS labels, facets_jsonb AS facets,
            provenance_jsonb AS provenance, embedding_jsonb AS embedding,
            canonicality_score, created_at, updated_at
     FROM eidetic_objects WHERE id = $1`,
    [c.req.param('id')]
  );
  if (!rows.length) {
    return c.json({ error: 'not_found', message: 'Object not found' }, 404);
  }
  return c.json(rows[0]);
});

// Upsert noematic edges (batch)
noemaRoute.post('/edges/upsert', async (c) => {
  const body = await c.req.json();
  const edges = body?.edges;
  if (!Array.isArray(edges) || edges.length === 0) {
    return c.json({ error: 'bad_request', message: 'edges[] is required and must be non-empty' }, 400);
  }

  const ids: string[] = [];
  for (const edge of edges) {
    const id = edge.id ?? randomUUID();
    ids.push(id);
    await query(
      `INSERT INTO noematic_edges (id, src_id, dst_id, relation_type, weights_jsonb, evidence_jsonb)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
       ON CONFLICT (id) DO UPDATE
         SET src_id = EXCLUDED.src_id,
             dst_id = EXCLUDED.dst_id,
             relation_type = EXCLUDED.relation_type,
             weights_jsonb = EXCLUDED.weights_jsonb,
             evidence_jsonb = EXCLUDED.evidence_jsonb,
             updated_at = now()`,
      [
        id,
        edge.src_id,
        edge.dst_id,
        edge.relation_type ?? 'other',
        JSON.stringify(edge.weights ?? {}),
        JSON.stringify(edge.evidence ?? []),
      ]
    );
  }
  return c.json({ upserted_ids: ids });
});

// Neighborhood query: objects + edges around a center object
noemaRoute.get('/neighborhood', async (c) => {
  const objectId = c.req.query('object_id');
  if (!objectId) {
    return c.json({ error: 'bad_request', message: 'object_id query parameter is required' }, 400);
  }
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 500);

  // Check center exists
  const center = await query('SELECT id FROM eidetic_objects WHERE id = $1', [objectId]);
  if (!center.length) {
    return c.json({ error: 'not_found', message: 'Center object not found' }, 404);
  }

  // Fetch edges touching this object
  const edges = await query(
    `SELECT id, src_id, dst_id, relation_type, weights_jsonb AS weights, evidence_jsonb AS evidence, created_at, updated_at
     FROM noematic_edges
     WHERE src_id = $1 OR dst_id = $1
     LIMIT $2`,
    [objectId, limit]
  );

  // Collect neighbor ids
  const neighborIds = new Set<string>();
  for (const e of edges) {
    neighborIds.add(e.src_id);
    neighborIds.add(e.dst_id);
  }

  let objects: any[] = [];
  if (neighborIds.size > 0) {
    const idList = Array.from(neighborIds);
    objects = await query(
      `SELECT id, type, labels_jsonb AS labels, facets_jsonb AS facets,
              canonicality_score, created_at, updated_at
       FROM eidetic_objects
       WHERE id = ANY($1)`,
      [idList]
    );
  }

  return c.json({ center_object_id: objectId, objects, edges });
});

// Search objects by label
noemaRoute.get('/search', async (c) => {
  const q = c.req.query('q');
  if (!q) {
    return c.json({ error: 'bad_request', message: 'q query parameter is required' }, 400);
  }
  const limit = Math.min(parseInt(c.req.query('limit') || '25', 10), 200);

  const rows = await query(
    `SELECT id, type, labels_jsonb AS labels, facets_jsonb AS facets,
            canonicality_score, created_at, updated_at
     FROM eidetic_objects
     WHERE labels_jsonb::text ILIKE $1
     LIMIT $2`,
    [`%${q}%`, limit]
  );
  return c.json({ items: rows });
});
