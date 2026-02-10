/**
 * Noema-Rho API - Core type definitions
 *
 * Husserl's phenomenology mapped to data structures:
 *   Noema  → EideticObject + NoematicEdge (the graph of things-as-meant)
 *   Noesis → IntentionalAct (acts of consciousness on the noematic field)
 *   ρ (Rho) → RhoState (time-indexed belief/attention state over the noema)
 */

// ── IDs & primitives ──────────────────────────────────────────────

export type UUID = string;
export type ISODateTime = string;

// ── Enumerations ──────────────────────────────────────────────────

export type EideticType =
  | 'Person' | 'Org' | 'Place' | 'Project' | 'Artifact'
  | 'Concept' | 'Value' | 'Claim' | 'Event' | 'SelfAspect' | 'Other';

export type RelationType =
  | 'knows' | 'mentions' | 'about' | 'supports' | 'contradicts'
  | 'caused_by' | 'part_of' | 'associated_with' | 'metaphor_for'
  | 'threatens' | 'helps' | 'feels_like' | 'other';

export type StancePolarity = 'endorse' | 'neutral' | 'reject';

export type IntentionalActType =
  | 'Refer' | 'Ascribe' | 'Relate' | 'Assert'
  | 'Endorse' | 'Reject' | 'Suspend'
  | 'Revise' | 'Differentiate' | 'Merge'
  | 'Foreground' | 'Background'
  | 'Affect' | 'Generalize' | 'Particularize'
  | 'Metaphorize' | 'Question' | 'Doubt';

// ── Evidence ──────────────────────────────────────────────────────

export interface EvidenceRef {
  doc_id: UUID;
  sentence_id: UUID;
  char_start?: number;
  char_end?: number;
  timestamp?: ISODateTime;
}

// ── Noema: objects & edges ────────────────────────────────────────

export interface EideticObject {
  id: UUID;
  type: EideticType;
  labels: string[];
  facets: Record<string, unknown>;
  provenance: EvidenceRef[];
  embedding?: number[];
  canonicality_score?: number;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface NoematicEdgeWeights {
  association_strength?: number;
  affective_valence?: number;
  epistemic_support?: number;
  recency?: number;
}

export interface NoematicEdge {
  id: UUID;
  src_id: UUID;
  dst_id: UUID;
  relation_type: RelationType;
  weights: NoematicEdgeWeights;
  evidence: EvidenceRef[];
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

// ── Subject lens & SIC ────────────────────────────────────────────

export interface SICPack {
  id: UUID;
  name: string;
  params: Record<string, number | string | boolean>;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface SubjectLens {
  id: UUID;
  label: string;
  description?: string;
  sic_pack_id?: UUID;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

// ── Rho state ─────────────────────────────────────────────────────

export interface RhoObjectState {
  salience?: number;
  activation?: number;
  affect?: number;
  stance?: { polarity: StancePolarity; confidence: number };
  uncertainty?: number;
}

export interface RhoStateSummary {
  t: number;
  subject_lens_id: UUID;
  objects: Record<UUID, RhoObjectState>;
  edges?: Record<UUID, Partial<NoematicEdgeWeights>>;
  metrics?: {
    tension?: number;
    novelty?: number;
    surprisal?: number;
  };
  updated_at: ISODateTime;
}

// ── Noesis events ─────────────────────────────────────────────────

export interface IntentionalAct {
  type: IntentionalActType;
  targets: UUID[];
  confidence?: number;
  payload?: Record<string, unknown>;
}

export interface RhoDelta {
  objects: Record<UUID, Partial<RhoObjectState>>;
  edges?: Record<UUID, Partial<NoematicEdgeWeights>>;
  metrics?: {
    tension?: number;
    novelty?: number;
    surprisal?: number;
  };
}

export interface NoesisEvent {
  id: UUID;
  doc_id: UUID;
  sentence_id: UUID;
  step_index: number;
  subject_lens_id: UUID;
  invoked_objects: UUID[];
  invoked_edges?: UUID[];
  acts: IntentionalAct[];
  delta: RhoDelta;
  metrics: {
    novelty: number;
    evidence_strength: number;
    tension: number;
    sic_alignment?: number;
  };
  explanations?: string[];
  created_at: ISODateTime;
}

// ── API payloads ──────────────────────────────────────────────────

export interface SentenceStepRequest {
  subject_lens_id: UUID;
  doc: {
    doc_id: UUID;
    source_type: 'chat' | 'email' | 'post' | 'note' | 'doc' | 'other';
    author?: string;
    timestamp?: ISODateTime;
  };
  sentence: {
    sentence_id: UUID;
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
  expected_step_index?: number;
}

export interface SentenceStepResponse {
  event: NoesisEvent;
  rho_summary: RhoStateSummary;
  branch?: {
    branch_id: UUID;
    reason: string;
    weight?: number;
  };
}
