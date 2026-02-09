/**
 * Embedding-based intentional act classification.
 * Primary path: sentence embeddings compared against act prototypes.
 * Fallback: minimal high-precision regex checks if embeddings unavailable.
 * Baseline acts (Refer, Foreground) always emitted structurally.
 */

import type { IntentionalActType, UUID } from '../types.js';
import type {
  DetectedAct,
  ReconstructedRhoState,
  ResolvedObject,
} from './types-internal.js';
import { embedText, isEmbeddingsReady } from './embeddings.js';
import { classifyActs, isPrototypesReady } from './act-prototypes.js';

// ── Fallback regex (degraded mode only) ──────────────────────────

const FALLBACK_QUESTION_RE = /\?$/;
const FALLBACK_NEGATION_RE = /\b(not|never|no|n't|cannot|neither|nothing|nobody)\b/i;

function fallbackClassify(text: string, targets: UUID[]): DetectedAct[] {
  const acts: DetectedAct[] = [];

  if (FALLBACK_QUESTION_RE.test(text)) {
    acts.push({ type: 'Question', targets, confidence: 0.6, reason: 'fallback: interrogative punctuation' });
  }
  if (FALLBACK_NEGATION_RE.test(text)) {
    acts.push({ type: 'Reject', targets, confidence: 0.4, reason: 'fallback: explicit negation word' });
  }

  return acts;
}

// ── Main detection (async) ───────────────────────────────────────

export async function detectActs(
  text: string,
  resolvedObjects: ResolvedObject[],
  rhoState: ReconstructedRhoState,
): Promise<DetectedAct[]> {
  const acts: DetectedAct[] = [];
  const allIds = resolvedObjects.map((r) => r.object_id);

  // 1. Baseline acts: Refer for every invoked object
  for (const obj of resolvedObjects) {
    acts.push({
      type: 'Refer',
      targets: [obj.object_id],
      confidence: obj.match_score > 0.5 ? 0.8 : 0.5,
      reason: `reference to "${obj.entity.surface}"`,
    });
  }

  // 2. Foreground acts for new or re-emerging objects
  for (const obj of resolvedObjects) {
    const prevActivation = rhoState.objects[obj.object_id]?.activation ?? 0;
    if (obj.is_new || prevActivation < 0.1) {
      acts.push({
        type: 'Foreground',
        targets: [obj.object_id],
        confidence: obj.is_new ? 0.9 : 0.7,
        reason: obj.is_new
          ? `new object "${obj.entity.surface}" introduced`
          : `re-emergence of "${obj.entity.surface}" (activation was ${prevActivation.toFixed(2)})`,
      });
    }
  }

  // 3. Embedding-based classification (primary path)
  if (isEmbeddingsReady() && isPrototypesReady()) {
    try {
      const embedding = await embedText(text);
      const classified = classifyActs(embedding);

      for (const c of classified) {
        acts.push({
          type: c.type,
          targets: allIds,
          confidence: c.confidence,
          reason: c.reason,
          ...(c.payload ? { payload: c.payload } : {}),
        });
      }

      return acts;
    } catch {
      // Embedding failed at runtime — fall through to fallback
    }
  }

  // 4. Fallback: minimal regex (degraded mode)
  acts.push(...fallbackClassify(text, allIds));

  return acts;
}
