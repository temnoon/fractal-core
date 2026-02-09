/**
 * Orchestrator for the sentence_step pipeline.
 * Coordinates: SIC loading → rho state → extraction → resolution →
 *              act detection → rho delta → persistence → response.
 */

import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { UUID } from '../types.js';
import { loadSICParams } from './sic-loader.js';
import { loadRhoState } from './rho-state-loader.js';
import { extractEntities, resolveEntities } from './object-resolution.js';
import { detectActs } from './act-detection.js';
import { initPrototypes } from './act-prototypes.js';
import { computeRhoDelta } from './update-rules.js';
import { enrichWithOllama, isOllamaAvailable, mergeOllamaEntities } from './ollama-enrichment.js';
import type { SentenceStepResult, ResolvedObject, DetectedRelation } from './types-internal.js';

interface SentenceStepInput {
  subject_lens_id: string;
  doc: { doc_id: string; source_type: string; author?: string; timestamp?: string };
  sentence: {
    sentence_id: string;
    text: string;
    index_in_doc?: number;
    char_start?: number;
    char_end?: number;
  };
  context?: {
    prev_sentence_text?: string;
    next_sentence_text?: string;
    window_text?: string;
  };
}

export async function sentenceStep(
  client: pg.PoolClient,
  req: SentenceStepInput,
  eventId: string,
  stepIndex: number,
  nowIso: string,
): Promise<SentenceStepResult> {
  // 0. Ensure embedding prototypes are initialized (idempotent, ~2-5s first call)
  await initPrototypes().catch(() => {
    // Graceful fallback — act detection will use regex mode
  });

  // 1. Load SIC params
  const params = await loadSICParams(client, req.subject_lens_id);

  // 2. Load current rho state (snapshot + replay)
  const rhoState = await loadRhoState(client, req.subject_lens_id, params);

  // 3. Extract entities with compromise
  let entities = extractEntities(req.sentence.text);

  // 4. Optional Ollama enrichment
  if (await isOllamaAvailable()) {
    try {
      const ollamaResult = await enrichWithOllama(req.sentence.text);
      if (ollamaResult) {
        entities = mergeOllamaEntities(entities, ollamaResult);
      }
    } catch {
      // Graceful fallback — continue with compromise-only
    }
  }

  // 5. Resolve entities against graph
  const resolvedObjects = await resolveEntities(
    client, entities, rhoState, req.doc.doc_id, req.sentence.sentence_id,
  );

  // 6. Detect intentional acts
  const acts = await detectActs(req.sentence.text, resolvedObjects, rhoState);

  // 7. Find edge-connected objects for salience computation
  const invokedIds = resolvedObjects.map((r) => r.object_id);
  const edgeConnectedIds = await findEdgeConnected(client, invokedIds);

  // 8. Compute rho delta
  const newObjectIds = new Set(
    resolvedObjects.filter((r) => r.is_new).map((r) => r.object_id),
  );
  const { objectDeltas, metrics } = computeRhoDelta(
    rhoState, invokedIds, newObjectIds, acts, edgeConnectedIds, params,
  );

  // 9. Detect and persist relations between co-occurring objects
  const newEdgeIds = await persistRelations(client, resolvedObjects, acts, req.doc.doc_id, req.sentence.sentence_id);

  // 10. Build explanations
  const explanations = buildExplanations(resolvedObjects, acts, metrics);

  // 11. Build delta for persistence
  const delta = {
    objects: objectDeltas,
    metrics: {
      tension: metrics.tension,
      novelty: metrics.novelty,
      surprisal: metrics.surprisal,
    },
  };

  // 12. Persist noesis event
  await client.query(
    `INSERT INTO noesis_events
     (id, doc_id, sentence_id, subject_lens_id, step_index,
      invoked_objects_jsonb, invoked_edges_jsonb, acts_jsonb,
      delta_jsonb, metrics_jsonb, explanations_jsonb)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb)`,
    [
      eventId,
      req.doc.doc_id,
      req.sentence.sentence_id,
      req.subject_lens_id,
      stepIndex,
      JSON.stringify(invokedIds),
      JSON.stringify(newEdgeIds),
      JSON.stringify(acts),
      JSON.stringify(delta),
      JSON.stringify(metrics),
      JSON.stringify(explanations),
    ],
  );

  // 13. Snapshot periodically
  if (stepIndex % params.snapshot_interval === 0) {
    await client.query(
      `INSERT INTO rho_snapshots (id, subject_lens_id, step_index, rho_objects_jsonb, metrics_jsonb)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       ON CONFLICT (subject_lens_id, step_index) DO UPDATE
         SET rho_objects_jsonb = EXCLUDED.rho_objects_jsonb,
             metrics_jsonb = EXCLUDED.metrics_jsonb,
             updated_at = now()`,
      [
        randomUUID(),
        req.subject_lens_id,
        stepIndex,
        JSON.stringify(objectDeltas),
        JSON.stringify(delta.metrics),
      ],
    );
  }

  // 14. Build response
  const rhoSummary = {
    t: stepIndex,
    subject_lens_id: req.subject_lens_id,
    objects: objectDeltas,
    metrics: delta.metrics,
    updated_at: nowIso,
  };

  return {
    event: {
      id: eventId,
      doc_id: req.doc.doc_id,
      sentence_id: req.sentence.sentence_id,
      step_index: stepIndex,
      subject_lens_id: req.subject_lens_id,
      invoked_objects: invokedIds,
      invoked_edges: newEdgeIds,
      acts,
      delta,
      metrics,
      explanations,
      created_at: nowIso,
    },
    rho_summary: rhoSummary,
  };
}

// ── Helpers ──────────────────────────────────────────────────────

async function findEdgeConnected(
  client: pg.PoolClient,
  objectIds: UUID[],
): Promise<Set<UUID>> {
  if (objectIds.length === 0) return new Set();

  const res = await client.query<{ id: string }>(
    `SELECT DISTINCT unnest(ARRAY[src_id, dst_id]) AS id
     FROM noematic_edges
     WHERE src_id = ANY($1) OR dst_id = ANY($1)`,
    [objectIds],
  );

  const connected = new Set(res.rows.map((r) => r.id));
  // Remove the invoked objects themselves (we only want neighbors)
  for (const id of objectIds) connected.delete(id);
  return connected;
}

async function persistRelations(
  client: pg.PoolClient,
  resolved: ResolvedObject[],
  acts: { type: string; targets: UUID[]; payload?: Record<string, unknown> }[],
  docId: string,
  sentenceId: string,
): Promise<UUID[]> {
  const edgeIds: UUID[] = [];
  if (resolved.length < 2) return edgeIds;

  // Create edges between co-occurring objects (pairwise, first with rest)
  // Only when there's a detected Relate act or when objects co-occur
  const relateAct = acts.find((a) => a.type === 'Relate');
  const relationType = (relateAct?.payload?.relation as string) ?? 'associated_with';

  // Connect first resolved object with all others via mentions/association
  const primary = resolved[0];
  for (let i = 1; i < resolved.length; i++) {
    const secondary = resolved[i];
    const edgeId = randomUUID();
    edgeIds.push(edgeId);

    await client.query(
      `INSERT INTO noematic_edges (id, src_id, dst_id, relation_type, weights_jsonb, evidence_jsonb)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
       ON CONFLICT (id) DO UPDATE
         SET weights_jsonb = $5::jsonb,
             evidence_jsonb = noematic_edges.evidence_jsonb || $6::jsonb,
             updated_at = now()`,
      [
        edgeId,
        primary.object_id,
        secondary.object_id,
        relateAct ? relationType : 'mentions',
        JSON.stringify({ association_strength: 0.5, recency: 1.0 }),
        JSON.stringify([{ doc_id: docId, sentence_id: sentenceId }]),
      ],
    );
  }

  return edgeIds;
}

function buildExplanations(
  resolved: ResolvedObject[],
  acts: { type: string; targets: UUID[]; reason: string }[],
  metrics: { tension: number; novelty: number; surprisal: number; evidence_strength: number },
): string[] {
  const lines: string[] = [];

  // Object summary
  const newObjs = resolved.filter((r) => r.is_new);
  const existingObjs = resolved.filter((r) => !r.is_new);

  if (newObjs.length > 0) {
    const names = newObjs.map((o) => `"${o.entity.surface}" (${o.entity.suggested_type})`);
    lines.push(`Introduced ${newObjs.length} new object(s): ${names.join(', ')}.`);
  }
  if (existingObjs.length > 0) {
    const names = existingObjs.map((o) => `"${o.entity.surface}"`);
    lines.push(`Referenced ${existingObjs.length} existing object(s): ${names.join(', ')}.`);
  }

  // Act summary (group by type, skip Refer for brevity)
  const actTypes = new Map<string, number>();
  for (const act of acts) {
    if (act.type === 'Refer') continue;
    actTypes.set(act.type, (actTypes.get(act.type) ?? 0) + 1);
  }
  if (actTypes.size > 0) {
    const summary = [...actTypes.entries()]
      .map(([type, count]) => `${type}${count > 1 ? ` (x${count})` : ''}`)
      .join(', ');
    lines.push(`Acts: ${summary}.`);
  }

  // Metrics
  if (metrics.tension > 0.1) {
    lines.push(`Tension elevated to ${metrics.tension.toFixed(2)} (stance conflict detected).`);
  }
  if (metrics.novelty > 0.3) {
    lines.push(`High novelty (${metrics.novelty.toFixed(2)}): many new objects this step.`);
  }
  if (metrics.surprisal > 0.3) {
    lines.push(`Surprising: unexpected objects re-entered the field.`);
  }

  return lines;
}
