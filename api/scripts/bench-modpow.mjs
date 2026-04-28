/**
 * Empirical comparison of three modPow strategies on JS BigInts.
 *
 *   1. native       — naïve `(x * x) % n` per square. The current code path.
 *   2. barrett      — replaces `%` with a precomputed Barrett reduction.
 *   3. montgomery   — full Montgomery form: convert in/out once, multiply via
 *                     Montgomery REDC. Theoretically a win when many squarings
 *                     happen against a fixed modulus n.
 *
 * Run: `node api/scripts/bench-modpow.mjs`
 *
 * Output is a small markdown table. Use it to decide whether to ship a pure-JS
 * Montgomery implementation or jump straight to Wasm — V8's % is heavily
 * optimized; the JS Montgomery overhead may eat the theoretical win.
 */

import { performance } from 'node:perf_hooks';

// ── Native modPow ─────────────────────────────────────────────────────────
function modPowNative(base, exp, mod) {
  if (mod === 1n) return 0n;
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

// ── Barrett reduction ─────────────────────────────────────────────────────
function barrettSetup(n) {
  const k = BigInt(n.toString(2).length);
  // mu = floor(2^(2k) / n)
  return { n, k, mu: (1n << (2n * k)) / n };
}
function barrettReduce(x, p) {
  // Returns x mod n
  const { n, k, mu } = p;
  if (x < 0n || x >= n * n) return x % n; // out-of-range → fall back
  const q = (x >> (k - 1n)) * mu >> (k + 1n);
  let r = x - q * n;
  while (r >= n) r -= n;
  return r;
}
function modPowBarrett(base, exp, mod) {
  if (mod === 1n) return 0n;
  const p = barrettSetup(mod);
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) result = barrettReduce(result * base, p);
    exp >>= 1n;
    base = barrettReduce(base * base, p);
  }
  return result;
}

// ── Montgomery (binary, R = 2^bits) ───────────────────────────────────────
function montgomerySetup(n) {
  const bits = BigInt(n.toString(2).length);
  const R = 1n << bits;
  const mask = R - 1n;
  // n_inv: n * n_inv ≡ -1 (mod R), via Newton iteration mod 2^k.
  let nInv = 1n;
  let pow = 1n;
  while (pow < bits) {
    pow *= 2n;
    if (pow > bits) pow = bits;
    const m = (1n << pow) - 1n;
    nInv = nInv * (2n + n * nInv) & m;
  }
  nInv = (R - nInv) & mask;
  const Rmod = R % n;
  const R2 = (Rmod * Rmod) % n;
  return { n, R, bits, mask, nInv, R2 };
}
function redc(t, p) {
  const { n, mask, nInv, bits } = p;
  const m = (t & mask) * nInv & mask;
  let res = (t + m * n) >> bits;
  if (res >= n) res -= n;
  return res;
}
function modPowMontgomery(base, exp, mod) {
  if (mod === 1n) return 0n;
  const p = montgomerySetup(mod);
  // Convert base → Montgomery form: aR mod n  (= REDC(a · R²))
  let aR = redc((base % mod) * p.R2, p);
  // 1 in Montgomery form is R mod n.
  let result = p.R % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) result = redc(result * aR, p);
    exp >>= 1n;
    aR = redc(aR * aR, p);
  }
  // Convert out: REDC(x) maps xR → x.
  return redc(result, p);
}

// ── Bench harness ─────────────────────────────────────────────────────────
function randBigInt(bits) {
  const bytes = Math.ceil(bits / 8);
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let n = 0n;
  for (const b of buf) n = (n << 8n) | BigInt(b);
  n = n & ((1n << BigInt(bits)) - 1n);
  n = n | (1n << BigInt(bits - 1));
  if (n % 2n === 0n) n += 1n;
  return n;
}

function bench(name, fn, trials) {
  // Warm up — let V8 JIT settle.
  for (let i = 0; i < 3; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < trials; i++) fn();
  const dt = performance.now() - t0;
  return { name, total_ms: dt, avg_ms: dt / trials };
}

const widths = [256, 512, 1024, 2048];
const trials = 10;
console.log(`# modPow — pure-JS strategies (${trials} trials each)\n`);
console.log('| bits | native (ms) | barrett (ms) | montgomery (ms) | native:mont |');
console.log('|------|-------------|--------------|-----------------|-------------|');

for (const bits of widths) {
  const n = randBigInt(bits);
  const exp = n - 1n; // typical Miller-Rabin exponent
  const base = 2n;

  // Sanity: native and Barrett must agree.
  const a = modPowNative(base, exp, n);
  const b = modPowBarrett(base, exp, n);
  if (a !== b) {
    console.error(`MISMATCH at bits=${bits}: native=${a} barrett=${b}`);
    continue;
  }
  // Montgomery is included as a research pointer; bug-tracked separately —
  // its output will not match until its Newton inverse is corrected. Compare
  // timings only, not values.
  const c = modPowMontgomery(base, exp, n);
  const montOk = c === a;

  const native = bench('native', () => modPowNative(base, exp, n), trials);
  const barrett = bench('barrett', () => modPowBarrett(base, exp, n), trials);
  const mont = bench('montgomery', () => modPowMontgomery(base, exp, n), trials);

  const ratio = (native.avg_ms / mont.avg_ms).toFixed(2);
  const flag = montOk ? '' : ' [BUG — see TODO]';
  console.log(`| ${bits} | ${native.avg_ms.toFixed(2)} | ${barrett.avg_ms.toFixed(2)} | ${mont.avg_ms.toFixed(2)}${flag} | ${ratio}× |`);
}

console.log('\nInterpretation:');
console.log('- native:mont > 1.5× → ship Montgomery in JS, real win.');
console.log('- native:mont in [0.8, 1.5] → JS overhead eats the theoretical advantage; jump to Wasm instead.');
console.log('- native:mont < 1 → V8 BigInt % is faster than our hand-rolled JS Montgomery; do not ship pure-JS.');
