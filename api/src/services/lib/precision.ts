/**
 * High-precision numeric helpers for number-theory computations on BigInts.
 *
 * Used by merit / Cramér / theta where ln(p) and accumulated sums must stay
 * accurate for primes beyond Number.MAX_SAFE_INTEGER (~9×10^15).
 */

/**
 * Natural log of an arbitrarily-large positive BigInt.
 *
 * For n ≤ ~10^15, Math.log(Number(n)) is exact enough; beyond that the
 * BigInt→Number cast loses precision, so we split:
 *   ln(n) = (digits - 1) * ln(10) + ln(leading 15 digits / 10^14)
 * which preserves ~14 significant digits for any magnitude.
 */
export function lnBigInt(n: bigint): number {
  if (n <= 0n) {
    throw new Error('lnBigInt requires positive input');
  }
  const s = n.toString();
  const digits = s.length;
  if (digits <= 15) {
    return Math.log(Number(n));
  }
  const leading = Number(s.slice(0, 15)) / 1e14;
  return (digits - 1) * Math.LN10 + Math.log(leading);
}

/**
 * Kahan compensated summation — keeps running error term so that summing
 * many float64 values (e.g. ln(p) across thousands of primes) doesn't drift.
 */
export class KahanSum {
  private sum = 0;
  private comp = 0;

  add(x: number): void {
    const y = x - this.comp;
    const t = this.sum + y;
    this.comp = t - this.sum - y;
    this.sum = t;
  }

  get value(): number {
    return this.sum;
  }
}
