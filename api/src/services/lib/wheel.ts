/**
 * Wheel sieve helper for nextPrime / prevPrime walks.
 *
 * The "wheel" is the cyclic group of integers in [0, W) coprime to
 * W = 2·3·5·7·11·13 = 30030. Of those 30030 residues, only 5760 are
 * coprime — i.e. 80.8% of integers share a small factor and can be
 * skipped without any modular exponentiation.
 *
 * Walking ±30030 / 5760 ≈ ±5.2 per pass instead of ±2 means we feed
 * BPSW one fifth as many composite candidates. For 8K-bit primes, where
 * each isPrime call is the expensive thing, this is the cheapest
 * compounding speedup available before we touch modular arithmetic.
 */

export const WHEEL_BASE = 30030n; // 2 * 3 * 5 * 7 * 11 * 13
const WHEEL_PRIMES = [2n, 3n, 5n, 7n, 11n, 13n];

/** Greatest common divisor for the wheel-build precomputation. */
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

/** Build the sorted list of residues in [0, W) coprime to W. */
function buildWheel(): { offsets: bigint[]; jumps: bigint[]; index: Int32Array } {
  const offsets: bigint[] = [];
  for (let i = 1n; i < WHEEL_BASE; i += 2n) {
    if (gcd(i, WHEEL_BASE) === 1n) offsets.push(i);
  }
  // Forward jump table: jumps[i] = offsets[(i+1) % len] − offsets[i]
  // (with wraparound + WHEEL_BASE).
  const len = offsets.length;
  const jumps: bigint[] = new Array(len);
  for (let i = 0; i < len; i++) {
    const next = i + 1 === len ? offsets[0] + WHEEL_BASE : offsets[i + 1];
    jumps[i] = next - offsets[i];
  }
  // For O(1) "find next wheel offset >= r" we precompute a residue→index
  // map covering every residue in [0, W). 30030 entries · 4 bytes = 120 KB.
  const index = new Int32Array(Number(WHEEL_BASE));
  let cursor = 0;
  for (let r = 0; r < Number(WHEEL_BASE); r++) {
    while (cursor < len && Number(offsets[cursor]) < r) cursor++;
    index[r] = cursor < len ? cursor : 0;
  }
  return { offsets, jumps, index };
}

const WHEEL = buildWheel();

/**
 * Smallest wheel-coprime integer ≥ n. If n itself is wheel-coprime, returns n.
 * Negative or zero inputs are clamped to the first wheel-coprime offset.
 */
export function alignUp(n: bigint): { value: bigint; idx: number } {
  if (n < 2n) return { value: 2n, idx: -1 }; // sentinel for "below wheel"
  const r = ((n % WHEEL_BASE) + WHEEL_BASE) % WHEEL_BASE;
  const baseN = n - r;
  const idx = WHEEL.index[Number(r)];
  // Edge case: r > all offsets in this wheel period — wrap to next period.
  if (idx === 0 && Number(r) > Number(WHEEL.offsets[WHEEL.offsets.length - 1])) {
    return { value: baseN + WHEEL_BASE + WHEEL.offsets[0], idx: 0 };
  }
  const off = WHEEL.offsets[idx];
  return { value: baseN + off, idx };
}

/** Next wheel-coprime integer strictly greater than the current. */
export function step(value: bigint, idx: number): { value: bigint; idx: number } {
  if (idx < 0) {
    // Coming from below the wheel (n=2,3,5,7,11,13). Rejoin the wheel proper.
    return alignUp(value + 1n);
  }
  const next = (idx + 1) % WHEEL.offsets.length;
  return { value: value + WHEEL.jumps[idx], idx: next };
}

/**
 * Smallest wheel-coprime integer ≤ n. Returns -1 idx if n falls below the wheel
 * (in which case caller should fall back to small-prime testing).
 */
export function alignDown(n: bigint): { value: bigint; idx: number } {
  if (n < 2n) return { value: 0n, idx: -1 };
  const r = ((n % WHEEL_BASE) + WHEEL_BASE) % WHEEL_BASE;
  const baseN = n - r;
  // Find largest offset ≤ r.
  const offsets = WHEEL.offsets;
  let lo = 0;
  let hi = offsets.length - 1;
  let pick = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (Number(offsets[mid]) <= Number(r)) {
      pick = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (pick < 0) {
    // Wrap to previous wheel period.
    if (baseN === 0n) return { value: 0n, idx: -1 };
    return {
      value: baseN - WHEEL_BASE + offsets[offsets.length - 1],
      idx: offsets.length - 1,
    };
  }
  return { value: baseN + offsets[pick], idx: pick };
}

/** Step backward to previous wheel-coprime integer. */
export function stepBack(value: bigint, idx: number): { value: bigint; idx: number } {
  if (idx < 0) return alignDown(value - 1n);
  const prev = (idx - 1 + WHEEL.offsets.length) % WHEEL.offsets.length;
  return { value: value - WHEEL.jumps[prev], idx: prev };
}

/** Constants exposed for tests / benchmarks. */
export const WHEEL_INFO = {
  base: WHEEL_BASE,
  coprime_count: WHEEL.offsets.length,
  primes: WHEEL_PRIMES,
} as const;
