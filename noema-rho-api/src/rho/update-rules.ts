/**
 * Pure math module for rho state updates.
 * No I/O — takes current state + detected acts, returns new state delta.
 */

import type { RhoObjectState, UUID } from '../types.js';
import type {
  DetectedAct,
  ReconstructedRhoState,
  SICParams,
} from './types-internal.js';
import { ACT_INFORMATIVENESS } from './types-internal.js';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ── Activation ───────────────────────────────────────────────────

/**
 * Invoked objects → activation = 1.0
 * Others → prev * decay_factor
 */
export function computeActivations(
  prev: Record<UUID, RhoObjectState>,
  invokedIds: Set<UUID>,
  decay: number,
): Record<UUID, number> {
  const out: Record<UUID, number> = {};
  // Decay all existing objects
  for (const [id, state] of Object.entries(prev)) {
    out[id] = invokedIds.has(id) ? 1.0 : (state.activation ?? 0) * decay;
  }
  // Ensure all invoked objects have activation = 1
  for (const id of invokedIds) {
    out[id] = 1.0;
  }
  return out;
}

// ── Salience ─────────────────────────────────────────────────────

/**
 * salience_new = prev + α*relevance + β*activation - γ*(1-activation)
 * relevance: 1.0 if directly invoked, 0.5 if edge-connected, 0.0 otherwise
 */
export function computeSaliences(
  prev: Record<UUID, RhoObjectState>,
  activations: Record<UUID, number>,
  invokedIds: Set<UUID>,
  edgeConnectedIds: Set<UUID>,
  params: SICParams,
): Record<UUID, number> {
  const { salience_alpha, salience_beta, salience_gamma } = params;
  const out: Record<UUID, number> = {};

  const allIds = new Set([...Object.keys(prev), ...Object.keys(activations)]);
  for (const id of allIds) {
    const prevSal = prev[id]?.salience ?? 0;
    const act = activations[id] ?? 0;

    let relevance = 0;
    if (invokedIds.has(id)) relevance = 1.0;
    else if (edgeConnectedIds.has(id)) relevance = 0.5;

    out[id] = clamp(
      prevSal + salience_alpha * relevance + salience_beta * act - salience_gamma * (1 - act),
      0,
      1,
    );
  }
  return out;
}

// ── Stance ───────────────────────────────────────────────────────

export interface StanceState {
  polarity: 'endorse' | 'neutral' | 'reject';
  confidence: number;
}

/**
 * Update stance for a specific object based on detected acts targeting it.
 */
export function updateStance(
  prev: StanceState | undefined,
  acts: DetectedAct[],
  objectId: UUID,
  delta: number,
): StanceState {
  let polarity = prev?.polarity ?? 'neutral';
  let confidence = prev?.confidence ?? 0;

  for (const act of acts) {
    if (!act.targets.includes(objectId)) continue;

    switch (act.type) {
      case 'Assert':
      case 'Endorse':
        polarity = 'endorse';
        confidence = clamp(confidence + delta, 0, 1);
        break;
      case 'Reject':
        polarity = 'reject';
        confidence = clamp(confidence + delta, 0, 1);
        break;
      case 'Doubt':
        confidence = clamp(confidence - delta / 2, 0, 1);
        break;
      case 'Suspend':
        polarity = 'neutral';
        confidence = confidence / 2;
        break;
    }
  }
  return { polarity, confidence };
}

// ── Affect ───────────────────────────────────────────────────────

/**
 * Affect acts with valence shift the object's affect.
 */
export function updateAffect(
  prevAffect: number,
  acts: DetectedAct[],
  objectId: UUID,
  weight: number,
): number {
  let affect = prevAffect;
  for (const act of acts) {
    if (act.type !== 'Affect') continue;
    if (!act.targets.includes(objectId)) continue;
    const valence = (act.payload?.valence as number) ?? 0;
    affect = clamp(affect + weight * valence, -1, 1);
  }
  return affect;
}

// ── Tension ──────────────────────────────────────────────────────

/**
 * Tension decays each step; increases when Reject/Doubt contradicts
 * high-confidence endorsement (or vice versa).
 */
export function computeTension(
  prevTension: number,
  acts: DetectedAct[],
  prevStates: Record<UUID, RhoObjectState>,
  params: SICParams,
): number {
  let tension = prevTension * params.tension_decay;

  for (const act of acts) {
    for (const targetId of act.targets) {
      const prevStance = prevStates[targetId]?.stance;
      if (!prevStance) continue;

      const isConflict =
        (act.type === 'Reject' || act.type === 'Doubt') &&
        prevStance.polarity === 'endorse' &&
        prevStance.confidence > 0.5;

      const isReversal =
        (act.type === 'Endorse' || act.type === 'Assert') &&
        prevStance.polarity === 'reject' &&
        prevStance.confidence > 0.5;

      if (isConflict || isReversal) {
        tension += params.tension_conflict_boost * prevStance.confidence;
      }
    }
  }

  return clamp(tension, 0, 1);
}

// ── Novelty ──────────────────────────────────────────────────────

/**
 * novelty = new_objects / total_invoked (0 if none invoked)
 */
export function computeNovelty(newCount: number, totalInvoked: number): number {
  return totalInvoked > 0 ? newCount / totalInvoked : 0;
}

// ── Surprisal ────────────────────────────────────────────────────

/**
 * surprisal = unexpected_objects / total_invoked
 * unexpected = not in recent N-step window
 */
export function computeSurprisal(
  invokedIds: UUID[],
  recentObjectIds: Set<UUID>,
): number {
  if (invokedIds.length === 0) return 0;
  const unexpected = invokedIds.filter((id) => !recentObjectIds.has(id)).length;
  return unexpected / invokedIds.length;
}

// ── Evidence strength ────────────────────────────────────────────

/**
 * Weighted average of act confidences, weighted by informativeness.
 */
export function computeEvidenceStrength(acts: DetectedAct[]): number {
  if (acts.length === 0) return 0;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const act of acts) {
    const info = ACT_INFORMATIVENESS[act.type] ?? 0.1;
    weightedSum += info * (act.confidence ?? 0.5);
    totalWeight += info;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

// ── Full delta computation ───────────────────────────────────────

export interface RhoUpdateResult {
  objectDeltas: Record<UUID, Partial<RhoObjectState>>;
  metrics: { tension: number; novelty: number; surprisal: number; evidence_strength: number };
}

export function computeRhoDelta(
  prevState: ReconstructedRhoState,
  invokedIds: UUID[],
  newObjectIds: Set<UUID>,
  acts: DetectedAct[],
  edgeConnectedIds: Set<UUID>,
  params: SICParams,
): RhoUpdateResult {
  const invokedSet = new Set(invokedIds);

  // 1. Activations
  const activations = computeActivations(prevState.objects, invokedSet, params.decay_factor);

  // 2. Saliences
  const saliences = computeSaliences(
    prevState.objects, activations, invokedSet, edgeConnectedIds, params,
  );

  // 3. Build per-object deltas
  const objectDeltas: Record<UUID, Partial<RhoObjectState>> = {};
  const allIds = new Set([...Object.keys(activations), ...Object.keys(saliences)]);

  for (const id of allIds) {
    const stance = updateStance(prevState.objects[id]?.stance, acts, id, params.stance_delta);
    const affect = updateAffect(
      prevState.objects[id]?.affect ?? 0, acts, id, params.affect_weight,
    );

    objectDeltas[id] = {
      activation: activations[id] ?? 0,
      salience: saliences[id] ?? 0,
      affect,
      stance,
    };
  }

  // 4. Global metrics
  const tension = computeTension(
    prevState.metrics.tension ?? 0, acts, prevState.objects, params,
  );
  const novelty = computeNovelty(newObjectIds.size, invokedIds.length);
  const surprisal = computeSurprisal(
    invokedIds,
    new Set(prevState.recent_object_ids),
  );
  const evidence_strength = computeEvidenceStrength(acts);

  return {
    objectDeltas,
    metrics: { tension, novelty, surprisal, evidence_strength },
  };
}
