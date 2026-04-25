/**
 * Stats-only summarizers for the number-theory extras.
 *
 * Each function takes the full neighborhood arrays and produces a research-
 * grade summary (top-N tables, distributions, sampled checkpoints) suitable
 * for `result.stats` when `stats_only=true`.
 */

import { lnBigInt } from './precision.js';
import type {
  ConstellationMatch,
  ConstellationStat,
  CramerStats,
  GapMeritEntry,
  MeritStats,
  ResidueRaceStats,
  ThetaStats,
  ResidueRace,
  ThetaData,
  MaxRef,
} from '../../types/api.js';

/** OEIS references keyed by built-in pattern name. */
const PATTERN_OEIS: Record<string, string> = {
  twin: 'A001359',
  cousin: 'A023200',
  sexy: 'A023201',
  triplet_2_4: 'A022004',
  triplet_4_2: 'A022005',
  quadruplet: 'A007530',
  quintuplet_2_4_2_4: 'A022006',
  quintuplet_4_2_4_2: 'A022007',
  sexy_triplet: 'A046118',
  sexy_quadruplet: 'A046122',
  prime_sextuplet: 'A022008',
};

const DEFAULT_HISTOGRAM_BINS: { lo: number; hi: number; label: string }[] = [
  { lo: 0, hi: 0.5, label: '[0, 0.5)' },
  { lo: 0.5, hi: 1, label: '[0.5, 1)' },
  { lo: 1, hi: 1.5, label: '[1, 1.5)' },
  { lo: 1.5, hi: 2, label: '[1.5, 2)' },
  { lo: 2, hi: 3, label: '[2, 3)' },
  { lo: 3, hi: 4, label: '[3, 4)' },
  { lo: 4, hi: 5, label: '[4, 5)' },
  { lo: 5, hi: Infinity, label: '[5, ∞)' },
];

function buildEntry(
  rank: number,
  index: number,
  primes: bigint[],
  gaps: bigint[],
  merit: number[],
  cramer: number[],
): GapMeritEntry {
  return {
    rank,
    index,
    p: primes[index].toString(),
    p_next: primes[index + 1].toString(),
    gap: gaps[index].toString(),
    merit: merit[index],
    cramer: cramer[index],
  };
}

/** Top-N + max + mean + histogram for merit values. */
export function summarizeMerit(
  primes: bigint[],
  gaps: bigint[],
  merit: number[],
  cramer: number[],
  topN: number,
  max: MaxRef,
): MeritStats {
  const idxs = merit.map((_, i) => i).sort((a, b) => merit[b] - merit[a]);
  const top: GapMeritEntry[] = idxs
    .slice(0, topN)
    .map((idx, rank) => buildEntry(rank + 1, idx, primes, gaps, merit, cramer));

  const sum = merit.reduce((s, v) => s + v, 0);
  const mean = merit.length > 0 ? sum / merit.length : 0;

  // Histogram: how many merit values fall in each bin (Cramér heuristic test).
  const hist = DEFAULT_HISTOGRAM_BINS.map((b) => ({ ...b, count: 0 }));
  for (const v of merit) {
    for (const b of hist) {
      if (v >= b.lo && v < b.hi) {
        b.count++;
        break;
      }
    }
  }
  const total = merit.length || 1;
  const histogram = hist.map((b) => ({
    bin: b.label,
    count: b.count,
    pct: Math.round((b.count / total) * 1000) / 10,
  }));

  return { top, max, mean, histogram };
}

export function summarizeCramer(
  primes: bigint[],
  gaps: bigint[],
  merit: number[],
  cramer: number[],
  topN: number,
  max: MaxRef,
): CramerStats {
  const idxs = cramer.map((_, i) => i).sort((a, b) => cramer[b] - cramer[a]);
  const top: GapMeritEntry[] = idxs
    .slice(0, topN)
    .map((idx, rank) => buildEntry(rank + 1, idx, primes, gaps, merit, cramer));

  const sum = cramer.reduce((s, v) => s + v, 0);
  const mean = cramer.length > 0 ? sum / cramer.length : 0;

  return { top, max, mean };
}

/**
 * Residue-race summary with optional dominance + lead-change diagnostics
 * (these need the running per-residue cumulative arrays).
 */
export function summarizeResidueRace(
  race: ResidueRace,
  primesCount: number,
): ResidueRaceStats {
  const counts = race.counts;
  const total = Object.values(counts).reduce((s, v) => s + v, 0) || 1;
  const pct: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) {
    pct[k] = Math.round((v / total) * 1000) / 10;
  }

  let lead_changes: number | undefined;
  let dominance: Record<string, number> | undefined;

  const running = race.running;
  if (running && primesCount > 0) {
    const keys = Object.keys(running);
    const leadCount: Record<string, number> = {};
    keys.forEach((k) => (leadCount[k] = 0));

    let prevLeader: string | null = null;
    let changes = 0;
    for (let i = 0; i < primesCount; i++) {
      let best = -1;
      let curLeader = '';
      for (const k of keys) {
        const v = running[k][i] ?? 0;
        if (v > best) {
          best = v;
          curLeader = k;
        }
      }
      leadCount[curLeader]++;
      if (prevLeader !== null && curLeader !== prevLeader) changes++;
      prevLeader = curLeader;
    }
    lead_changes = changes;
    dominance = {};
    for (const k of keys) {
      dominance[k] = Math.round((leadCount[k] / primesCount) * 1000) / 10;
    }
  }

  return {
    modulus: race.modulus,
    counts,
    pct,
    leader: race.leader,
    lead_changes,
    dominance,
  };
}

/**
 * Theta summary with sampled checkpoints (log-spaced) and a normalized
 * deviation when the neighborhood actually starts at the smallest prime.
 */
export function summarizeTheta(
  theta: ThetaData,
  primes: bigint[],
  maxCheckpoints = 50,
): ThetaStats {
  const n = primes.length;
  const startsAtTwo = n > 0 && primes[0] === 2n;
  const pLast = primes[n - 1] ?? 0n;
  const pLastNum = Number(pLast);

  // Log-spaced sampling: at i = round(exp(t * ln(n-1))) for t in [0, 1].
  let sampled: { index: number; value: number }[] | undefined;
  if (theta.values && theta.values.length > 0) {
    const m = Math.min(maxCheckpoints, theta.values.length);
    sampled = [];
    const seen = new Set<number>();
    for (let i = 0; i < m; i++) {
      const t = m === 1 ? 1 : i / (m - 1);
      const idx = Math.round(Math.pow(theta.values.length - 1, t));
      const cap = Math.min(idx, theta.values.length - 1);
      if (seen.has(cap)) continue;
      seen.add(cap);
      sampled.push({ index: cap, value: theta.values[cap] });
    }
  }

  const stat: ThetaStats = {
    total: theta.total,
    deviation: theta.deviation,
    starts_at_two: startsAtTwo,
    p_first: primes[0]?.toString() ?? '0',
    p_last: pLast.toString(),
    n_primes: n,
    sampled,
  };

  if (startsAtTwo && pLastNum > 0 && Number.isFinite(pLastNum)) {
    stat.deviation_normalized = theta.deviation / Math.sqrt(pLastNum);
  }

  return stat;
}

/**
 * Constellation summary table with per-pattern counts, density (per Δlog x),
 * first/last positions, and OEIS cross-links.
 */
export function summarizeConstellations(
  matches: ConstellationMatch[],
  primes: bigint[],
): ConstellationStat[] {
  const n = primes.length;
  const lnSpan = n > 1 ? lnBigInt(primes[n - 1]) - lnBigInt(primes[0]) : 0;

  return matches.map((m) => ({
    pattern_name: m.pattern_name,
    signature: m.signature,
    count: m.positions.length,
    first_position: m.positions[0],
    last_position: m.positions[m.positions.length - 1],
    density_per_log_x:
      lnSpan > 0
        ? Math.round((m.positions.length / lnSpan) * 10000) / 10000
        : undefined,
    oeis: PATTERN_OEIS[m.pattern_name],
  }));
}
