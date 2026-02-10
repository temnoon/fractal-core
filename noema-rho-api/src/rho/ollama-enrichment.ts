/**
 * Optional LLM enrichment via local Ollama.
 * Gracefully falls back when Ollama isn't running.
 */

import type { EideticType, IntentionalActType, RelationType } from '../types.js';
import type { ExtractedEntity, OllamaExtractionResult } from './types-internal.js';

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
const OLLAMA_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT_MS ?? '5000', 10);

// ── Availability check (cached for 60s) ─────────────────────────

let _available: boolean | null = null;
let _availableAt = 0;
const CACHE_TTL = 60_000;

export async function isOllamaAvailable(): Promise<boolean> {
  const now = Date.now();
  if (_available !== null && now - _availableAt < CACHE_TTL) {
    return _available;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    _available = res.ok;
  } catch {
    _available = false;
  }
  _availableAt = now;
  return _available;
}

// ── Extraction prompt ────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are analyzing a sentence for a phenomenological knowledge graph.
Extract the following as JSON (no extra text):
{
  "entities": [{"surface": "...", "type": "Person|Org|Place|Concept|Event|Artifact|Value|Claim", "confidence": 0.0-1.0}],
  "acts": [{"type": "Assert|Endorse|Reject|Doubt|Question|Relate|Metaphorize|Generalize|Particularize|Affect", "targets": ["surface form..."], "confidence": 0.0-1.0}],
  "relations": [{"src": "surface", "dst": "surface", "relation_type": "knows|supports|contradicts|caused_by|part_of|associated_with|metaphor_for", "confidence": 0.0-1.0}],
  "sentiment": -1.0 to 1.0
}

Sentence: `;

export async function enrichWithOllama(text: string): Promise<OllamaExtractionResult | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT);

    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: EXTRACTION_PROMPT + JSON.stringify(text),
        stream: false,
        format: 'json',
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return null;

    const body = await res.json() as { response: string };
    const parsed = JSON.parse(body.response);

    return {
      entities: Array.isArray(parsed.entities)
        ? parsed.entities.map((e: any) => ({
            surface: String(e.surface ?? ''),
            type: validateType(e.type),
            confidence: clampNum(e.confidence, 0.5),
          }))
        : [],
      acts: Array.isArray(parsed.acts)
        ? parsed.acts.map((a: any) => ({
            type: validateActType(a.type),
            targets: Array.isArray(a.targets) ? a.targets.map(String) : [],
            confidence: clampNum(a.confidence, 0.5),
          }))
        : [],
      relations: Array.isArray(parsed.relations)
        ? parsed.relations.map((r: any) => ({
            src: String(r.src ?? ''),
            dst: String(r.dst ?? ''),
            relation_type: validateRelType(r.relation_type),
            confidence: clampNum(r.confidence, 0.5),
          }))
        : [],
      sentiment: typeof parsed.sentiment === 'number'
        ? Math.max(-1, Math.min(1, parsed.sentiment))
        : undefined,
    };
  } catch {
    return null;
  }
}

// ── Merge Ollama results with compromise entities ────────────────

export function mergeOllamaEntities(
  compromiseEntities: ExtractedEntity[],
  ollamaResult: OllamaExtractionResult,
): ExtractedEntity[] {
  const merged = [...compromiseEntities];
  const seenNormalized = new Set(compromiseEntities.map((e) => e.normalized));

  for (const ollamaEntity of ollamaResult.entities) {
    if (!ollamaEntity.surface) continue;
    const normalized = ollamaEntity.surface.toLowerCase().trim();

    // Check if compromise already found this entity
    const existing = merged.find((e) => e.normalized === normalized);
    if (existing) {
      // Ollama type overrides compromise when higher confidence
      if (ollamaEntity.confidence > existing.confidence) {
        existing.suggested_type = ollamaEntity.type;
        existing.confidence = Math.max(existing.confidence, ollamaEntity.confidence);
        existing.source = 'merged';
      }
    } else if (!seenNormalized.has(normalized)) {
      // Ollama-only entity: add it
      seenNormalized.add(normalized);
      merged.push({
        surface: ollamaEntity.surface,
        normalized,
        suggested_type: ollamaEntity.type,
        is_pronoun: false,
        is_definite: false,
        confidence: ollamaEntity.confidence * 0.9, // slight discount for LLM-only
        source: 'ollama',
      });
    }
  }

  return merged;
}

// ── Validation helpers ───────────────────────────────────────────

const VALID_TYPES: Set<string> = new Set([
  'Person', 'Org', 'Place', 'Project', 'Artifact',
  'Concept', 'Value', 'Claim', 'Event', 'SelfAspect', 'Other',
]);

const VALID_ACT_TYPES: Set<string> = new Set([
  'Refer', 'Ascribe', 'Relate', 'Assert', 'Endorse', 'Reject', 'Suspend',
  'Revise', 'Differentiate', 'Merge', 'Foreground', 'Background',
  'Affect', 'Generalize', 'Particularize', 'Metaphorize', 'Question', 'Doubt',
]);

const VALID_REL_TYPES: Set<string> = new Set([
  'knows', 'mentions', 'about', 'supports', 'contradicts',
  'caused_by', 'part_of', 'associated_with', 'metaphor_for',
  'threatens', 'helps', 'feels_like', 'other',
]);

function validateType(t: unknown): EideticType {
  return VALID_TYPES.has(String(t)) ? (String(t) as EideticType) : 'Concept';
}

function validateActType(t: unknown): IntentionalActType {
  return VALID_ACT_TYPES.has(String(t)) ? (String(t) as IntentionalActType) : 'Refer';
}

function validateRelType(t: unknown): RelationType {
  return VALID_REL_TYPES.has(String(t)) ? (String(t) as RelationType) : 'associated_with';
}

function clampNum(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || isNaN(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}
