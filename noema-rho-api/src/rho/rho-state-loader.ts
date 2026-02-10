/**
 * Reconstruct the current rho state for a lens by:
 * 1. Finding nearest snapshot (step_index DESC LIMIT 1)
 * 2. Replaying all noesis_events since that snapshot
 * 3. Tracking recent object IDs for surprisal computation
 */

import type pg from 'pg';
import type { RhoObjectState, UUID } from '../types.js';
import type { ReconstructedRhoState, SICParams } from './types-internal.js';

interface SnapshotRow {
  step_index: number;
  rho_objects_jsonb: Record<UUID, RhoObjectState> | null;
  rho_edges_jsonb: Record<UUID, { association_strength?: number; affective_valence?: number }> | null;
  metrics_jsonb: { tension?: number; novelty?: number; surprisal?: number } | null;
}

interface EventRow {
  step_index: number;
  delta_jsonb: {
    objects?: Record<UUID, Partial<RhoObjectState>>;
    edges?: Record<UUID, { association_strength?: number; affective_valence?: number }>;
    metrics?: { tension?: number; novelty?: number; surprisal?: number };
  };
  invoked_objects_jsonb: UUID[];
}

export async function loadRhoState(
  client: pg.PoolClient,
  lensId: string,
  params: SICParams,
): Promise<ReconstructedRhoState> {
  // 1. Find nearest snapshot
  const snapRes = await client.query<SnapshotRow>(
    `SELECT step_index, rho_objects_jsonb, rho_edges_jsonb, metrics_jsonb
     FROM rho_snapshots
     WHERE subject_lens_id = $1
     ORDER BY step_index DESC
     LIMIT 1`,
    [lensId],
  );

  let state: ReconstructedRhoState;

  if (snapRes.rows.length > 0) {
    const snap = snapRes.rows[0];
    state = {
      t: snap.step_index,
      objects: snap.rho_objects_jsonb ?? {},
      edges: snap.rho_edges_jsonb ?? {},
      metrics: snap.metrics_jsonb ?? {},
      recent_object_ids: [],
    };
  } else {
    // No snapshot — start from empty
    state = {
      t: -1,
      objects: {},
      edges: {},
      metrics: {},
      recent_object_ids: [],
    };
  }

  // 2. Replay events since snapshot
  const eventsRes = await client.query<EventRow>(
    `SELECT step_index, delta_jsonb, invoked_objects_jsonb
     FROM noesis_events
     WHERE subject_lens_id = $1
       AND step_index > $2
     ORDER BY step_index ASC`,
    [lensId, state.t],
  );

  // Track recent objects (last N steps for surprisal)
  const recentWindow: UUID[][] = [];

  for (const evt of eventsRes.rows) {
    const delta = evt.delta_jsonb;

    // Apply object deltas
    if (delta.objects) {
      for (const [id, partial] of Object.entries(delta.objects)) {
        state.objects[id] = { ...state.objects[id], ...partial };
      }
    }

    // Apply edge deltas
    if (delta.edges) {
      for (const [id, partial] of Object.entries(delta.edges)) {
        state.edges[id] = { ...state.edges[id], ...partial };
      }
    }

    // Apply metrics (overwrite)
    if (delta.metrics) {
      state.metrics = { ...state.metrics, ...delta.metrics };
    }

    state.t = evt.step_index;

    // Collect invoked objects for recent window
    recentWindow.push(evt.invoked_objects_jsonb ?? []);
  }

  // Keep only last N steps of invoked objects
  const windowSize = params.surprisal_window;
  const recentSlice = recentWindow.slice(-windowSize);
  state.recent_object_ids = [...new Set(recentSlice.flat())];

  return state;
}
