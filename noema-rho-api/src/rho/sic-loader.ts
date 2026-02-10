/**
 * Load SIC (Subjective Intentional Constraints) parameters for a lens.
 * Joins subject_lenses → sic_packs, merges stored params over defaults.
 */

import type pg from 'pg';
import type { SICParams } from './types-internal.js';
import { DEFAULT_SIC_PARAMS } from './types-internal.js';

export async function loadSICParams(
  client: pg.PoolClient,
  lensId: string,
): Promise<SICParams> {
  const res = await client.query<{ params_jsonb: Record<string, unknown> }>(
    `SELECT sp.params_jsonb
     FROM subject_lenses sl
     JOIN sic_packs sp ON sp.id = sl.sic_pack_id
     WHERE sl.id = $1`,
    [lensId],
  );

  if (res.rows.length === 0 || !res.rows[0].params_jsonb) {
    return { ...DEFAULT_SIC_PARAMS };
  }

  const stored = res.rows[0].params_jsonb;
  const merged = { ...DEFAULT_SIC_PARAMS };

  // Only override keys that exist in SICParams and have numeric values
  for (const key of Object.keys(DEFAULT_SIC_PARAMS) as (keyof SICParams)[]) {
    if (key in stored && typeof stored[key] === 'number') {
      (merged as Record<string, number>)[key] = stored[key] as number;
    }
  }

  return merged;
}
