/**
 * Pulse Mint
 *
 * System-agnostic minting logic. Given a TimeSystemDescriptor:
 *   1. Compute the current tick T (BigInt) from the anchor + tick unit
 *   2. Estimate p_T via PNT, decide whether to seed at p_T or in a higher bit-class
 *   3. Pick a uniform random candidate inside a window of width 2^window_bits
 *   4. Climb (+2 step) with BPSW until prime
 *
 * The clock value T and the minted prime P are returned as separate values:
 *   - T orders mints in time
 *   - P uniquely identifies the act of minting (collision-resistant)
 */

import { primeEngine } from './engines/index.js';
import { formatTickDisplay } from './time-systems.js';
import type { TimeSystemDescriptor, AuditBlock, MintedPulse } from '../types/pulse.js';

// ============================================================================
// BigInt math helpers
// ============================================================================

/**
 * Natural log of a BigInt, to ~14 digits of precision via leading-digits trick.
 * Per ChromaDB memo a0e08dfb (BigInt logarithm precision strategy).
 */
function lnBigInt(n: bigint): number {
  if (n <= 0n) throw new Error('lnBigInt: non-positive argument');
  const s = n.toString();
  const digits = s.length;
  if (digits <= 15) {
    return Math.log(parseFloat(s));
  }
  // n ≈ leading × 10^(digits - 15) where leading is parseFloat(first 15 digits)
  const leading = parseFloat(s.slice(0, 15));
  return Math.log(leading) + (digits - 15) * Math.LN10;
}

/**
 * Multiply a BigInt by a positive Number factor without losing precision in
 * the mantissa. Decomposes factor = mantissa × 10^exp using toExponential(15).
 */
function mulBigIntByNumber(big: bigint, factor: number): bigint {
  if (factor === 0) return 0n;
  if (!Number.isFinite(factor)) {
    throw new Error(`mulBigIntByNumber: non-finite factor ${factor}`);
  }
  const isNeg = factor < 0;
  const abs = Math.abs(factor);
  // toExponential gives "m.mmmmmmmmmmmmmmme±xx"; 16 digits in the mantissa
  const expStr = abs.toExponential(15);
  const eIdx = expStr.indexOf('e');
  const mantissaStr = expStr.slice(0, eIdx);
  const exp = parseInt(expStr.slice(eIdx + 1), 10);
  const dotIdx = mantissaStr.indexOf('.');
  const digitsAfterDot = dotIdx < 0 ? 0 : mantissaStr.length - dotIdx - 1;
  const mantissaInt = BigInt(mantissaStr.replace('.', ''));
  // factor = mantissaInt × 10^(exp - digitsAfterDot)
  const realExp = exp - digitsAfterDot;
  let product = big * mantissaInt;
  if (realExp >= 0) {
    product *= 10n ** BigInt(realExp);
  } else {
    product /= 10n ** BigInt(-realExp);
  }
  return isNeg ? -product : product;
}

/**
 * Convert seconds (Number) to BigInt ticks at a given tick_unit_seconds.
 * For ticks coarser than ~1 ns, plain Number arithmetic is precise enough.
 * For sub-Planck ticks (cosmic), we route through mulBigIntByNumber to
 * preserve as much precision as the Planck constant itself has.
 */
function secondsToTicks(seconds: number, tick_unit_seconds: number): bigint {
  if (tick_unit_seconds >= 1e-9) {
    // Earth-time scale: Number is fine
    return BigInt(Math.floor(seconds / tick_unit_seconds));
  }
  // Sub-nanosecond: use BigInt path
  // ticks = seconds × (1 / tick_unit_seconds)
  const ticksPerSecond = 1 / tick_unit_seconds; // huge number, ~1.85e+43 for Planck
  // Decompose seconds into integer + fractional parts to keep BigInt-precise
  const sInt = BigInt(Math.trunc(seconds));
  const sFrac = seconds - Math.trunc(seconds);
  const intPart = mulBigIntByNumber(sInt, ticksPerSecond);
  // Fractional part: sFrac × ticksPerSecond is itself huge; reuse helper
  // by promoting sFrac × 10^15 to BigInt first
  const fracScaled = BigInt(Math.round(sFrac * 1e15));
  const fracPart = mulBigIntByNumber(fracScaled, ticksPerSecond) / (10n ** 15n);
  return intPart + fracPart;
}

// ============================================================================
// CSPRNG helpers
// ============================================================================

/**
 * Uniform random BigInt in [min, max).
 * Uses crypto.getRandomValues (Workers-native CSPRNG) with rejection sampling.
 */
export function secureRandomBigInt(min: bigint, max: bigint): { value: bigint; bytesUsed: number } {
  if (min >= max) throw new Error('secureRandomBigInt: empty range');
  const range = max - min;
  const bits = range.toString(2).length;
  const bytes = Math.ceil(bits / 8);
  const mask = (1n << BigInt(bits)) - 1n;
  let bytesUsed = 0;

  for (let attempt = 0; attempt < 64; attempt++) {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    bytesUsed += bytes;
    let r = 0n;
    for (const b of buf) r = (r << 8n) | BigInt(b);
    r &= mask;
    if (r < range) return { value: min + r, bytesUsed };
  }
  // Astronomically unlikely; fall back to modulo with tiny bias (range covers ≥ half the mask)
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  bytesUsed += bytes;
  let r = 0n;
  for (const b of buf) r = (r << 8n) | BigInt(b);
  r &= mask;
  return { value: min + (r % range), bytesUsed };
}

// ============================================================================
// Tick computation
// ============================================================================

export interface TickComputation {
  tick: bigint;
  audit: AuditBlock['tick_calculation'];
}

export function computeCurrentTick(system: TimeSystemDescriptor): TickComputation {
  const nowMs = Date.now();
  const anchorMs = Date.parse(system.anchor_iso);
  const elapsedSinceAnchorSeconds = (nowMs - anchorMs) / 1000;
  const totalElapsedSeconds = elapsedSinceAnchorSeconds + system.age_before_anchor_seconds;

  const tick = secondsToTicks(totalElapsedSeconds, system.tick_unit_seconds);

  return {
    tick,
    audit: {
      now_unix_seconds: nowMs / 1000,
      anchor_unix_seconds: anchorMs / 1000,
      elapsed_since_anchor_seconds: elapsedSinceAnchorSeconds,
      age_before_anchor_seconds: system.age_before_anchor_seconds,
      tick_unit_seconds: system.tick_unit_seconds,
      tick: tick.toString(),
    },
  };
}

// ============================================================================
// PNT estimate
// ============================================================================

/**
 * Estimate the T-th prime via the refined Prime Number Theorem:
 *   p_n ≈ n × (ln n + ln ln n - 1 + (ln ln n - 2) / ln n)
 *
 * For T in the cosmic range (~2^203), this gives an estimate ~2^210.
 * For tiny T (Tonga ~10^7), the estimate is ~2^28.
 */
export function pntEstimate(T: bigint): bigint {
  if (T < 6n) return 13n; // PNT is unstable at the very start; pick a fixed small prime estimate
  const lnT = lnBigInt(T);
  const lnLnT = Math.log(lnT);
  const factor = lnT + lnLnT - 1 + (lnLnT - 2) / lnT;
  return mulBigIntByNumber(T, factor);
}

// ============================================================================
// Mint
// ============================================================================

export interface MintInputs {
  system: TimeSystemDescriptor;
  bit_target: number;
  /** Pre-computed tick (lets the caller share a tick across audit + cache lookup) */
  tick: bigint;
  /** Pre-computed tick audit block */
  tickAudit: AuditBlock['tick_calculation'];
}

export interface MintOutput {
  pulse: MintedPulse;
  audit: AuditBlock;
}

const MAX_ATTEMPTS = 4096; // 256-bit primes density ~1/177; expect <500 tries
const FAILED_WITNESS_PRIMES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n];

export function mintPulse(inputs: MintInputs): MintOutput {
  const startMs = Date.now();
  const { system, bit_target, tick, tickAudit } = inputs;

  // 1. PNT estimate of p_T (always computed for the audit log)
  const pT = pntEstimate(tick);
  const pTBits = pT.toString(2).length;

  // 2. Decide where to anchor the random window
  let primeEstimate: bigint;
  let estimateMethod: 'pnt' | 'random_in_bit_class';

  if (bit_target <= pTBits) {
    // p_T is already at or above target bits; sample around p_T
    primeEstimate = pT;
    estimateMethod = 'pnt';
  } else {
    // Climb: pick a random anchor in [2^(bit_target-1), 2^bit_target)
    const lo = 1n << BigInt(bit_target - 1);
    const hi = 1n << BigInt(bit_target);
    const r = secureRandomBigInt(lo, hi);
    primeEstimate = r.value;
    estimateMethod = 'random_in_bit_class';
  }

  // 3. Pick a uniform random candidate in the window
  const halfWindow = 1n << BigInt(system.window_bits - 1);
  const windowLow = primeEstimate > halfWindow ? primeEstimate - halfWindow : 1n;
  const windowHigh = primeEstimate + halfWindow;
  const pick = secureRandomBigInt(windowLow, windowHigh);
  let candidate = pick.value;
  if (candidate % 2n === 0n) candidate += 1n;

  // 4. Climb until prime via the auto-engine (BPSW for >2^78)
  const candidates_tried: AuditBlock['candidates_tried'] = [];
  let attempts = 0;
  let foundPrime: bigint | null = null;

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    if (primeEngine.isPrime(candidate)) {
      candidates_tried.push({ candidate: candidate.toString(), result: 'probable_prime' });
      foundPrime = candidate;
      break;
    } else {
      candidates_tried.push({ candidate: candidate.toString(), result: 'composite' });
      candidate += 2n;
    }
  }

  if (foundPrime === null) {
    throw new Error(
      `mintPulse: failed to find prime in ${MAX_ATTEMPTS} attempts ` +
        `(system=${system.id}, bit_target=${bit_target})`
    );
  }

  const elapsedMs = Date.now() - startMs;
  const wallClockIso = new Date().toISOString();
  const display = formatTickDisplay(system, tick);

  return {
    pulse: {
      system_id: system.id,
      tick: tick.toString(),
      prime: foundPrime.toString(),
      prime_bits: foundPrime.toString(2).length,
      bit_target,
      wall_clock_iso: wallClockIso,
      display,
    },
    audit: {
      tick_calculation: tickAudit,
      estimate_calculation: {
        pnt_p_t_estimate: pT.toString(),
        pnt_p_t_bits: pTBits,
        bit_target,
        estimate_method: estimateMethod,
        prime_estimate: primeEstimate.toString(),
        prime_estimate_bits: primeEstimate.toString(2).length,
      },
      window: {
        low: windowLow.toString(),
        high: windowHigh.toString(),
        width_bits: system.window_bits,
        csprng_bytes_used: pick.bytesUsed,
      },
      candidates_tried,
      attempt_count: attempts,
      elapsed_ms: elapsedMs,
    },
  };
}

// Exposed for tests
export const _internal = {
  lnBigInt,
  mulBigIntByNumber,
  secondsToTicks,
};
