/**
 * Pipeline-internal types for the sentence_step pipeline.
 * These are not exposed via the API — they flow between pipeline stages.
 */

import type {
  EideticType,
  IntentionalActType,
  RelationType,
  RhoObjectState,
  RhoStateSummary,
  UUID,
} from '../types.js';

// ── Entity extraction ────────────────────────────────────────────

export interface ExtractedEntity {
  surface: string;           // as it appeared in text
  normalized: string;        // lowercased, trimmed
  suggested_type: EideticType;
  is_pronoun: boolean;
  is_definite: boolean;      // "the X" vs "a X"
  confidence: number;        // 0–1
  source: 'compromise' | 'ollama' | 'merged';
}

// ── Object resolution ────────────────────────────────────────────

export interface ResolvedObject {
  object_id: UUID;
  entity: ExtractedEntity;
  is_new: boolean;
  match_score: number;       // 0–1 (1 = exact match, 0 = new object)
}

// ── Act detection ────────────────────────────────────────────────

export interface DetectedAct {
  type: IntentionalActType;
  targets: UUID[];
  confidence: number;
  reason: string;
  payload?: Record<string, unknown>;
}

// ── Relation detection ───────────────────────────────────────────

export interface DetectedRelation {
  src_id: UUID;
  dst_id: UUID;
  relation_type: RelationType;
  confidence: number;
}

// ── Rho state reconstruction ─────────────────────────────────────

export interface ReconstructedRhoState {
  t: number;                                 // step_index of latest applied event
  objects: Record<UUID, RhoObjectState>;
  edges: Record<UUID, { association_strength?: number; affective_valence?: number }>;
  metrics: { tension?: number; novelty?: number; surprisal?: number };
  recent_object_ids: UUID[];                 // objects invoked in last N steps (for surprisal)
}

// ── Ollama enrichment ────────────────────────────────────────────

export interface OllamaExtractionResult {
  entities: Array<{
    surface: string;
    type: EideticType;
    confidence: number;
  }>;
  acts: Array<{
    type: IntentionalActType;
    targets: string[];       // surface forms, resolved later
    confidence: number;
  }>;
  relations: Array<{
    src: string;             // surface form
    dst: string;             // surface form
    relation_type: RelationType;
    confidence: number;
  }>;
  sentiment?: number;        // -1 to 1
}

// ── SIC parameters ───────────────────────────────────────────────

export interface SICParams {
  decay_factor: number;      // activation decay per step (default 0.85)
  salience_alpha: number;    // relevance weight for salience update (default 0.3)
  salience_beta: number;     // activation boost for salience (default 0.15)
  salience_gamma: number;    // decay penalty for salience (default 0.05)
  stance_delta: number;      // confidence shift per stance act (default 0.2)
  affect_weight: number;     // affect shift weight (default 0.3)
  tension_decay: number;     // tension decay per step (default 0.9)
  tension_conflict_boost: number; // tension increase on contradiction (default 0.3)
  surprisal_window: number;  // recent steps to track for surprisal (default 5)
  snapshot_interval: number; // persist snapshot every N steps (default 10)
}

export const DEFAULT_SIC_PARAMS: SICParams = {
  decay_factor: 0.85,
  salience_alpha: 0.3,
  salience_beta: 0.15,
  salience_gamma: 0.05,
  stance_delta: 0.2,
  affect_weight: 0.3,
  tension_decay: 0.9,
  tension_conflict_boost: 0.3,
  surprisal_window: 5,
  snapshot_interval: 10,
};

// ── Informativeness weights for evidence strength ────────────────

export const ACT_INFORMATIVENESS: Record<string, number> = {
  Assert: 0.6,
  Endorse: 0.5,
  Reject: 0.5,
  Relate: 0.4,
  Ascribe: 0.4,
  Differentiate: 0.4,
  Doubt: 0.3,
  Generalize: 0.3,
  Particularize: 0.3,
  Metaphorize: 0.3,
  Affect: 0.2,
  Question: 0.2,
  Foreground: 0.15,
  Refer: 0.1,
  Background: 0.1,
  Suspend: 0.1,
  Revise: 0.4,
  Merge: 0.3,
};

// ── Pipeline result (returned by sentenceStep) ───────────────────

export interface SentenceStepResult {
  event: {
    id: UUID;
    doc_id: UUID;
    sentence_id: UUID;
    step_index: number;
    subject_lens_id: UUID;
    invoked_objects: UUID[];
    invoked_edges: UUID[];
    acts: DetectedAct[];
    delta: {
      objects: Record<UUID, Partial<RhoObjectState>>;
      metrics: { tension: number; novelty: number; surprisal: number };
    };
    metrics: {
      novelty: number;
      evidence_strength: number;
      tension: number;
    };
    explanations: string[];
    created_at: string;
  };
  rho_summary: RhoStateSummary;
}
