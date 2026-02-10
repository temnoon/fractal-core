/**
 * Entity extraction (via compromise NLP) + graph matching/resolution.
 * Extracts entities from text, then resolves each against the eidetic_objects table.
 */

import { createHash } from 'node:crypto';
import nlp from 'compromise';
import type pg from 'pg';
import type { EideticType, UUID } from '../types.js';
import type {
  ExtractedEntity,
  ReconstructedRhoState,
  ResolvedObject,
} from './types-internal.js';

// ── Entity extraction via compromise ─────────────────────────────

const PRONOUNS = new Set([
  'he', 'she', 'it', 'they', 'him', 'her', 'them',
  'his', 'hers', 'its', 'their', 'theirs',
  'this', 'that', 'these', 'those',
]);

const ABSTRACT_SUFFIXES = ['-tion', '-ness', '-ism', '-ity', '-ment', '-ence', '-ance'];

function classifyType(surface: string, tag: string): EideticType {
  if (tag === 'Person') return 'Person';
  if (tag === 'Place') return 'Place';
  if (tag === 'Organization') return 'Org';

  const lower = surface.toLowerCase();
  // Abstract nouns → Concept
  if (ABSTRACT_SUFFIXES.some((s) => lower.endsWith(s.slice(1)))) return 'Concept';

  // Capitalized multi-word → likely Person or Org
  const words = surface.split(/\s+/);
  if (words.length >= 2 && words.every((w) => /^[A-Z]/.test(w))) return 'Person';

  return 'Concept';
}

export function extractEntities(text: string): ExtractedEntity[] {
  const doc = nlp(text);
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  // Named entities first (highest confidence)
  const namedGroups: Array<{ method: () => any; tag: string }> = [
    { method: () => doc.people(), tag: 'Person' },
    { method: () => doc.places(), tag: 'Place' },
    { method: () => doc.organizations(), tag: 'Organization' },
  ];

  for (const { method, tag } of namedGroups) {
    const matches = method();
    matches.forEach((m: any) => {
      const surface = m.text().trim();
      if (!surface || seen.has(surface.toLowerCase())) return;
      seen.add(surface.toLowerCase());
      entities.push({
        surface,
        normalized: surface.toLowerCase(),
        suggested_type: classifyType(surface, tag),
        is_pronoun: false,
        is_definite: false,
        confidence: 0.85,
        source: 'compromise',
      });
    });
  }

  // Remaining nouns (not already captured)
  doc.nouns().forEach((m: any) => {
    const surface = m.text().trim();
    if (!surface) return;
    const lower = surface.toLowerCase();
    if (seen.has(lower)) return;

    // Skip very short words and articles
    if (lower.length <= 2) return;

    const isPronoun = PRONOUNS.has(lower);
    if (isPronoun) {
      seen.add(lower);
      entities.push({
        surface,
        normalized: lower,
        suggested_type: 'Concept',
        is_pronoun: true,
        is_definite: false,
        confidence: 0.4,
        source: 'compromise',
      });
      return;
    }

    seen.add(lower);
    const isDefinite = /\bthe\s+/i.test(text.slice(0, text.toLowerCase().indexOf(lower)));
    entities.push({
      surface,
      normalized: lower,
      suggested_type: classifyType(surface, 'Noun'),
      is_pronoun: false,
      is_definite: isDefinite,
      confidence: 0.6,
      source: 'compromise',
    });
  });

  return entities;
}

// ── Object resolution against the graph ──────────────────────────

function makeObjectId(normalized: string): string {
  return 'obj_' + createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export async function resolveEntities(
  client: pg.PoolClient,
  entities: ExtractedEntity[],
  rhoState: ReconstructedRhoState,
  docId: string,
  sentenceId: string,
): Promise<ResolvedObject[]> {
  const resolved: ResolvedObject[] = [];
  const resolvedIds = new Map<string, ResolvedObject>(); // dedup by object_id

  for (const entity of entities) {
    let result: ResolvedObject | null = null;

    // 1. Pronouns → highest-salience matching object
    if (entity.is_pronoun) {
      result = resolvePronoun(entity, rhoState);
    }

    // 2. Exact label match
    if (!result) {
      result = await matchExactLabel(client, entity);
    }

    // 3. Fuzzy label match
    if (!result) {
      result = await matchFuzzyLabel(client, entity);
    }

    // 4. Active state match (foregrounded objects in rho state)
    if (!result) {
      result = matchActiveState(entity, rhoState);
    }

    // 5. No match → create new object
    if (!result) {
      result = await createNewObject(client, entity, docId, sentenceId);
    }

    // Dedup: keep highest match_score per object_id
    const existing = resolvedIds.get(result.object_id);
    if (!existing || result.match_score > existing.match_score) {
      resolvedIds.set(result.object_id, result);
    }
  }

  return [...resolvedIds.values()];
}

function resolvePronoun(
  entity: ExtractedEntity,
  rhoState: ReconstructedRhoState,
): ResolvedObject | null {
  // Find highest-salience object in rho state
  let bestId: string | null = null;
  let bestSalience = -1;

  for (const [id, state] of Object.entries(rhoState.objects)) {
    const sal = state.salience ?? 0;
    const act = state.activation ?? 0;
    // Prefer recently active, high-salience objects
    const score = sal * 0.6 + act * 0.4;
    if (score > bestSalience) {
      bestSalience = score;
      bestId = id;
    }
  }

  if (!bestId || bestSalience <= 0) return null;

  return {
    object_id: bestId,
    entity,
    is_new: false,
    match_score: 0.3, // low confidence for pronoun resolution
  };
}

async function matchExactLabel(
  client: pg.PoolClient,
  entity: ExtractedEntity,
): Promise<ResolvedObject | null> {
  const res = await client.query<{ id: string }>(
    `SELECT id FROM eidetic_objects
     WHERE labels_jsonb @> $1::jsonb
     LIMIT 1`,
    [JSON.stringify([entity.normalized])],
  );

  if (res.rows.length === 0) return null;

  return {
    object_id: res.rows[0].id,
    entity,
    is_new: false,
    match_score: 1.0,
  };
}

async function matchFuzzyLabel(
  client: pg.PoolClient,
  entity: ExtractedEntity,
): Promise<ResolvedObject | null> {
  // Use ILIKE for case-insensitive partial match
  const res = await client.query<{ id: string }>(
    `SELECT id FROM eidetic_objects
     WHERE labels_jsonb::text ILIKE $1
     LIMIT 1`,
    [`%${entity.normalized}%`],
  );

  if (res.rows.length === 0) return null;

  return {
    object_id: res.rows[0].id,
    entity,
    is_new: false,
    match_score: 0.6,
  };
}

function matchActiveState(
  entity: ExtractedEntity,
  rhoState: ReconstructedRhoState,
): ResolvedObject | null {
  // Check if any foregrounded object has a matching label-derived ID
  const candidateId = makeObjectId(entity.normalized);
  if (rhoState.objects[candidateId] && (rhoState.objects[candidateId].activation ?? 0) > 0.1) {
    return {
      object_id: candidateId,
      entity,
      is_new: false,
      match_score: 0.5,
    };
  }
  return null;
}

async function createNewObject(
  client: pg.PoolClient,
  entity: ExtractedEntity,
  docId: string,
  sentenceId: string,
): Promise<ResolvedObject> {
  const objId = makeObjectId(entity.normalized);

  await client.query(
    `INSERT INTO eidetic_objects (id, type, labels_jsonb, facets_jsonb, provenance_jsonb)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)
     ON CONFLICT (id) DO UPDATE
       SET labels_jsonb = (
         SELECT jsonb_agg(DISTINCT elem)
         FROM jsonb_array_elements(eidetic_objects.labels_jsonb || $3::jsonb) AS elem
       ),
       updated_at = now()`,
    [
      objId,
      entity.suggested_type,
      JSON.stringify([entity.normalized]),
      JSON.stringify({ source: entity.source }),
      JSON.stringify([{ doc_id: docId, sentence_id: sentenceId }]),
    ],
  );

  return {
    object_id: objId,
    entity,
    is_new: true,
    match_score: 0,
  };
}
