/**
 * Time-System Registry
 *
 * Each entry is a (anchor, tick_unit, mint_cadence, key_id) tuple that
 * defines an independently-clocked pulse system. fractal-core hosts four
 * canonical systems out of the box; federated operators can clone the
 * shape and stand up their own under a different operator domain.
 *
 * Anchors and tick durations:
 *   - cosmic: 16 By before Carrington 1859, Planck-time tick (~5.39e-44s).
 *             Today's T sits around 2^203, prime defaults to 256 bits.
 *   - tonga:  Toba supervolcanic eruption ~74 kya, daily tick. T ~ 27M
 *             today; one prime per day, cached so all consumers see the
 *             same prime within a day.
 *   - yad:    J2000 epoch, 1 sidereal-second tick (sidereal year / 512 / 61637).
 *             "Yad" = day backwards; 1 Yad ≈ 17h 7m 17s = sidereal year / 512.
 *             1 Yad-second ≈ Yad / 61637 sidereal seconds, cached one-per-tick.
 *   - milli:  Fixed instant 2026-01-01T00:00:00Z, 1ms tick. T ~ 1e10 today,
 *             fresh per mint.
 */

import type { TimeSystemDescriptor } from '../types/pulse.js';

/* eslint-disable no-loss-of-precision */
// Astronomical constants
const JULIAN_YEAR_SECONDS = 365.25 * 86400; // 31_557_600
const SIDEREAL_YEAR_SECONDS = 31_558_149.504;       // IAU value
const YAD_SECONDS = SIDEREAL_YEAR_SECONDS / 512;    // 61_637.010_75
const SIDEREAL_SECONDS_PER_YAD = 61637;             // truncated whole number
const YAD_SECOND_SECONDS = YAD_SECONDS / SIDEREAL_SECONDS_PER_YAD; // ~1.000016 s

// Cosmic constants
const PLANCK_TIME_SECONDS = 5.391247e-44;
const COSMIC_AGE_BEFORE_CARRINGTON_SECONDS = 16e9 * JULIAN_YEAR_SECONDS;

// Toba supervolcanic eruption — anchor for the "tonga" system.
// User wrote "Tonga event ~70 kya"; the most likely match is the Toba
// supervolcano (~74 kya). We anchor at exactly 74000 BCE-01-01T00:00:00Z
// projected backward via the proleptic Gregorian calendar — the math only
// cares about the offset in seconds, and this is precise to whole days.
// Rename + re-anchor by editing this constant if you meant a different event.
const TOBA_AGE_BEFORE_J0_SECONDS = 74_000 * JULIAN_YEAR_SECONDS;

// Disclosure footer applied to the demo page + /parameters payload
const NO_AGENT_DISCLOSURE =
  'Code authored with the assistance of language models. The API itself ' +
  'and this interface use no AI agent at runtime — only deterministic prime ' +
  'mathematics and Ed25519 signing. The clock is computed from the published ' +
  'anchor; primes are found by uniform random sampling within the published ' +
  'window followed by Baillie–PSW primality testing.';

const COSMIC: TimeSystemDescriptor = {
  id: 'cosmic',
  label: 'Cosmic Pulse',
  anchor_iso: '1859-09-01T11:18:00Z',
  anchor_label: 'Carrington Event',
  age_before_anchor_seconds: COSMIC_AGE_BEFORE_CARRINGTON_SECONDS,
  tick_unit_seconds: PLANCK_TIME_SECONDS,
  tick_unit_label: 'Planck time',
  bit_target_default: 256,
  window_bits: 120,
  mint_cadence: 'fresh-per-mint',
  operator: 'fractal-core.com',
  disclosure: NO_AGENT_DISCLOSURE,
};

const TONGA: TimeSystemDescriptor = {
  id: 'tonga',
  label: 'Tonga (Toba) Pulse',
  // The anchor is conceptually "74,000 years before J2000-01-01T00:00:00Z".
  // We encode that by setting anchor_iso to J2000 and using
  // age_before_anchor_seconds for the offset.
  anchor_iso: '2000-01-01T00:00:00Z',
  anchor_label: 'Toba eruption (~74 kya, anchored relative to J2000)',
  age_before_anchor_seconds: TOBA_AGE_BEFORE_J0_SECONDS,
  tick_unit_seconds: 86400, // one day
  tick_unit_label: 'Earth day (86400 s)',
  bit_target_default: 256,
  window_bits: 120,
  mint_cadence: 'one-per-tick',
  operator: 'fractal-core.com',
  disclosure: NO_AGENT_DISCLOSURE,
};

const YAD: TimeSystemDescriptor = {
  id: 'yad',
  label: 'Yad Pulse',
  anchor_iso: '2000-01-01T12:00:00Z', // J2000 epoch (TT, approximated as UTC)
  anchor_label: 'J2000 epoch',
  age_before_anchor_seconds: 0,
  tick_unit_seconds: YAD_SECOND_SECONDS, // ~1.000016 s — a "sidereal second within a Yad"
  tick_unit_label: 'Yad-second (sidereal-year / 512 / 61637)',
  bit_target_default: 256,
  window_bits: 120,
  mint_cadence: 'one-per-tick',
  operator: 'fractal-core.com',
  disclosure: NO_AGENT_DISCLOSURE,
};

const MILLI: TimeSystemDescriptor = {
  id: 'milli',
  label: 'Milli Pulse',
  anchor_iso: '2026-01-01T00:00:00Z',
  anchor_label: 'Milli-pulse zero (2026-01-01)',
  age_before_anchor_seconds: 0,
  tick_unit_seconds: 0.001,
  tick_unit_label: 'Earth millisecond',
  bit_target_default: 256,
  window_bits: 120,
  mint_cadence: 'fresh-per-mint',
  operator: 'fractal-core.com',
  disclosure: NO_AGENT_DISCLOSURE,
};

const REGISTRY: Record<string, TimeSystemDescriptor> = {
  cosmic: COSMIC,
  tonga: TONGA,
  yad: YAD,
  milli: MILLI,
};

/** All registered time systems */
export function listTimeSystems(): TimeSystemDescriptor[] {
  return [COSMIC, TONGA, YAD, MILLI];
}

/** Look up a system by id, returns null if not found */
export function getTimeSystem(id: string): TimeSystemDescriptor | null {
  return REGISTRY[id] ?? null;
}

/**
 * Optional display formatter: render T as a human-readable hierarchical
 * value for systems where the scalar T is hard to read.
 *
 * Returns `undefined` for systems where the scalar T already conveys enough.
 */
export function formatTickDisplay(
  system: TimeSystemDescriptor,
  tick: bigint
): Record<string, unknown> | undefined {
  switch (system.id) {
    case 'tonga': {
      // T = days since 74 kya. Show years + day-in-year.
      const t = Number(tick);
      const daysPerYear = 365.25;
      const yearsSinceAnchor = Math.floor(t / daysPerYear);
      const dayInYear = Math.floor(t - yearsSinceAnchor * daysPerYear);
      return {
        days_since_anchor: tick.toString(),
        years_since_anchor: yearsSinceAnchor,
        day_in_julian_year: dayInYear,
      };
    }
    case 'yad': {
      // T = yad-seconds since J2000.
      // 1 Yad = 61637 yad-seconds; 1 sidereal year = 512 Yads = 31_558_592 yad-seconds
      // Caveat: actual sidereal-year-in-yad-seconds is 31_558_144 (512 × 61637), not 31_558_592.
      // Display values are conventional; clock T is exact integer.
      const yadSecondsPerYad = 61637n;
      const yadsPerYear = 512n;
      const yadSecondsPerYear = yadSecondsPerYad * yadsPerYear;
      const yearInEra = tick / yadSecondsPerYear;
      const remAfterYear = tick % yadSecondsPerYear;
      const yadInYear = remAfterYear / yadSecondsPerYad;
      const yadSecondInYad = remAfterYear % yadSecondsPerYad;
      return {
        year_since_anchor: yearInEra.toString(),
        yad_in_year: Number(yadInYear),
        yad_second_in_yad: Number(yadSecondInYad),
      };
    }
    case 'cosmic':
    case 'milli':
    default:
      return undefined;
  }
}

/** Internal helper: expose constants for tests / audit blocks */
export const PULSE_CONSTANTS = {
  JULIAN_YEAR_SECONDS,
  SIDEREAL_YEAR_SECONDS,
  YAD_SECONDS,
  YAD_SECOND_SECONDS,
  SIDEREAL_SECONDS_PER_YAD,
  PLANCK_TIME_SECONDS,
  COSMIC_AGE_BEFORE_CARRINGTON_SECONDS,
  TOBA_AGE_BEFORE_J0_SECONDS,
  NO_AGENT_DISCLOSURE,
};
