/**
 * Pulse System Routes
 *
 * Generic dispatcher: /pulse/{system_id}/...
 *
 *   POST /pulse/:system_id/mint     — auth required; signs (request, pulse, receipt) for a named target_domain
 *   GET  /pulse/:system_id/now      — public; signs the pulse alone
 *   POST /pulse/:system_id/verify   — verify a previously-issued signed pulse
 *   GET  /pulse/:system_id/parameters — describe the system (federation-ready)
 *   GET  /pulse                       — list all registered systems
 *
 * The Humanizer team's existing reference URL `fractal-core.com/cosmic-pulse`
 * points to the demo page; the API endpoint they need is here at /pulse/cosmic/...
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../types/env.js';
import { listTimeSystems, getTimeSystem } from '../services/time-systems.js';
import { computeCurrentTick, mintPulse } from '../services/pulse-mint.js';
import { readCachedPulse, writeCachedPulse } from '../services/pulse-cache.js';
import { primeEngine } from '../services/engines/index.js';
import { hashCanonical } from '../crypto/hashing.js';
import {
  signCanonical,
  verifyCanonicalSignature,
  publicKeyFromBase64,
} from '../crypto/signing.js';
import { getPrimaryKeyPairAsync, getSigningKeysAsync } from '../config/keys.js';
import type {
  MintRequest,
  MintReceipt,
  MintedPulse,
  SignedPulse,
  TimeSystemDescriptor,
  AuditBlock,
} from '../types/pulse.js';

export const pulseRoute = new Hono<{ Bindings: Env }>();

// ============================================================================
// Index / system discovery
// ============================================================================

pulseRoute.get('/', async (c) => {
  const systems = listTimeSystems().map((s) => ({
    id: s.id,
    label: s.label,
    anchor_iso: s.anchor_iso,
    tick_unit_seconds: s.tick_unit_seconds,
    tick_unit_label: s.tick_unit_label,
    mint_cadence: s.mint_cadence,
  }));
  const keys = await getSigningKeysAsync();
  return c.json({
    service: 'fractal-core/pulse',
    systems,
    signing_keys: keys,
  });
});

// ============================================================================
// Per-system: parameters
// ============================================================================

pulseRoute.get('/:system_id/parameters', async (c) => {
  const system = getTimeSystem(c.req.param('system_id'));
  if (!system) return c.json({ error: 'unknown system' }, 404);
  const keys = await getSigningKeysAsync();
  return c.json({
    time_system: { ...system, key_id: keys[0]?.keyId ?? 'ephemeral' },
    signing_keys: keys,
  });
});

// ============================================================================
// Per-system: GET /now (public, signed pulse only — no requester binding)
// ============================================================================

pulseRoute.get('/:system_id/now', async (c) => {
  const system = getTimeSystem(c.req.param('system_id'));
  if (!system) return c.json({ error: 'unknown system' }, 404);

  const verbose = c.req.query('verbose') === 'true';
  const bitTargetParam = c.req.query('bit_target');
  const bit_target = parseBitTarget(bitTargetParam, system);
  if (typeof bit_target === 'object') return c.json(bit_target.error, 400);

  const { tick, audit: tickAudit } = computeCurrentTick(system);

  // Cached path for one-per-tick systems
  let pulse: MintedPulse | undefined;
  let mintAudit: AuditBlock | undefined;
  if (system.mint_cadence === 'one-per-tick') {
    const cached = await readCachedPulse(c.env?.LPP_KV, system, tick);
    if (cached) pulse = cached;
  }
  if (!pulse) {
    const result = mintPulse({ system, bit_target, tick, tickAudit });
    pulse = result.pulse;
    mintAudit = result.audit;
    if (system.mint_cadence === 'one-per-tick') {
      scheduleCacheWrite(c, system, tick, pulse);
    }
  } else {
    // Reconstruct a minimal audit when we hit cache
    mintAudit = {
      tick_calculation: tickAudit,
      estimate_calculation: {
        pnt_p_t_estimate: '0',
        pnt_p_t_bits: 0,
        bit_target,
        estimate_method: 'pnt',
        prime_estimate: '0',
        prime_estimate_bits: 0,
      },
      window: { low: '0', high: '0', width_bits: system.window_bits, csprng_bytes_used: 0 },
      candidates_tried: [],
      attempt_count: 0,
      elapsed_ms: 0,
    };
  }

  // Receipt: pulse-only (no request binding for /now)
  const pulseHash = hashCanonical(pulse);
  const receipt: MintReceipt = {
    request_hash: '',
    pulse_hash: pulseHash,
    bundle_hash: hashCanonical({ pulse }),
    generated_at_iso: new Date().toISOString(),
  };

  // Sign (time_system + pulse + receipt) — no request, since this is public
  const keyPair = await getPrimaryKeyPairAsync();
  if (!keyPair) return c.json({ error: 'signing not available' }, 503);
  const tsForSig = { ...system, key_id: keyPair.keyId };
  const signature = signCanonical({ time_system: tsForSig, pulse, receipt }, keyPair);

  const response: SignedPulse = {
    time_system: tsForSig,
    pulse,
    receipt,
    signature,
  };
  if (verbose && mintAudit) response.audit = mintAudit;
  return c.json(response);
});

// ============================================================================
// Per-system: POST /mint (auth required, target_domain bound)
// ============================================================================

const MintBodySchema = z.object({
  target_domain: z.string().min(1),
  target_node: z.string().optional(),
  bit_target: z.number().int().min(64).max(512).optional(),
  nonce: z.string().regex(/^[0-9a-fA-F]{32}$/, '32 hex chars'),
  purpose: z.string().max(256).optional(),
  ttl_seconds: z.number().int().min(1).max(86400).optional().default(300),
  verbose: z.boolean().optional().default(false),
});

pulseRoute.post('/:system_id/mint', async (c) => {
  const system = getTimeSystem(c.req.param('system_id'));
  if (!system) return c.json({ error: 'unknown system' }, 404);

  const auth = c.get('auth');
  const isAdmin = c.get('isAdmin');
  if (!auth && !isAdmin) {
    return c.json({ error: 'API key required for mint', code: 'AUTH_REQUIRED' }, 401);
  }

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'invalid JSON body' }, 400);
  const parsed = MintBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid request', details: parsed.error.issues }, 400);
  }
  const input = parsed.data;
  const bit_target = input.bit_target ?? system.bit_target_default;

  const { tick, audit: tickAudit } = computeCurrentTick(system);

  // Cached path for one-per-tick systems
  let pulse: MintedPulse | undefined;
  let mintAudit: AuditBlock | undefined;
  if (system.mint_cadence === 'one-per-tick') {
    const cached = await readCachedPulse(c.env?.LPP_KV, system, tick);
    if (cached) pulse = cached;
  }
  if (!pulse) {
    const result = mintPulse({ system, bit_target, tick, tickAudit });
    pulse = result.pulse;
    mintAudit = result.audit;
    if (system.mint_cadence === 'one-per-tick') {
      scheduleCacheWrite(c, system, tick, pulse);
    }
  }

  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + input.ttl_seconds * 1000).toISOString();

  const requesterKeyId = isAdmin ? 'admin' : auth?.apiKey.key_prefix;
  const requesterDomain = isAdmin ? 'fractal-core.com' : auth?.user.email?.split('@')[1];

  const request: MintRequest = {
    system_id: system.id,
    target_domain: input.target_domain,
    target_node: input.target_node,
    bit_target,
    nonce: input.nonce,
    purpose: input.purpose,
    expires_at_iso: expiresIso,
    minted_at_iso: nowIso,
    requester_key_id: requesterKeyId,
    requester_domain: requesterDomain,
  };

  const requestHash = hashCanonical(request);
  const pulseHash = hashCanonical(pulse);
  const receipt: MintReceipt = {
    request_hash: requestHash,
    pulse_hash: pulseHash,
    bundle_hash: hashCanonical({ request, pulse }),
    generated_at_iso: nowIso,
  };

  const keyPair = await getPrimaryKeyPairAsync();
  if (!keyPair) return c.json({ error: 'signing not available' }, 503);
  const tsForSig = { ...system, key_id: keyPair.keyId };
  const signature = signCanonical(
    { time_system: tsForSig, request, pulse, receipt },
    keyPair
  );

  const response: SignedPulse = {
    time_system: tsForSig,
    request,
    pulse,
    receipt,
    signature,
  };
  if (input.verbose && mintAudit) response.audit = mintAudit;
  return c.json(response);
});

// ============================================================================
// Per-system: POST /verify
// ============================================================================

pulseRoute.post('/:system_id/verify', async (c) => {
  const system_id = c.req.param('system_id');
  const body = await c.req.json().catch(() => null);
  if (!body || !body.signed) {
    return c.json({ error: 'expected { signed: SignedPulse }' }, 400);
  }
  const signed = body.signed as SignedPulse;
  if (signed.pulse?.system_id !== system_id) {
    return c.json({ error: 'system_id mismatch' }, 400);
  }

  const checks = {
    signature: false,
    request_hash: false,
    pulse_hash: false,
    bundle_hash: false,
    expires_in_future: true,
    prime_is_prime: false,
  };

  // Locate the public key by id
  const keys = await getSigningKeysAsync();
  const known = keys.find((k) => k.keyId === signed.signature?.key_id);
  if (!known) {
    return c.json({
      valid: false,
      reason: `unknown signing key_id ${signed.signature?.key_id}`,
      checks,
    });
  }
  const publicKey = publicKeyFromBase64(known.publicKeyB64);

  // Verify the signature over the canonical bundle
  const bundle = signed.request
    ? { time_system: signed.time_system, request: signed.request, pulse: signed.pulse, receipt: signed.receipt }
    : { time_system: signed.time_system, pulse: signed.pulse, receipt: signed.receipt };
  checks.signature = verifyCanonicalSignature(bundle, signed.signature, publicKey);

  // Verify hashes inside the receipt
  if (signed.request) {
    checks.request_hash = hashCanonical(signed.request) === signed.receipt.request_hash;
    checks.bundle_hash =
      hashCanonical({ request: signed.request, pulse: signed.pulse }) === signed.receipt.bundle_hash;
  } else {
    checks.request_hash = signed.receipt.request_hash === '';
    checks.bundle_hash = hashCanonical({ pulse: signed.pulse }) === signed.receipt.bundle_hash;
  }
  checks.pulse_hash = hashCanonical(signed.pulse) === signed.receipt.pulse_hash;

  // Expiry
  if (signed.request?.expires_at_iso) {
    checks.expires_in_future = Date.parse(signed.request.expires_at_iso) > Date.now();
  }

  // Prime check (BPSW; expensive but worth doing on verify)
  try {
    checks.prime_is_prime = primeEngine.isPrime(BigInt(signed.pulse.prime));
  } catch {
    checks.prime_is_prime = false;
  }

  const valid =
    checks.signature &&
    checks.request_hash &&
    checks.pulse_hash &&
    checks.bundle_hash &&
    checks.prime_is_prime;

  return c.json({
    valid,
    checks,
    reason: valid ? undefined : firstFailedCheck(checks),
  });
});

// ============================================================================
// helpers
// ============================================================================

function parseBitTarget(
  raw: string | undefined,
  system: TimeSystemDescriptor
): number | { error: { error: string; code: string } } {
  if (!raw) return system.bit_target_default;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 64 || n > 512) {
    return { error: { error: 'bit_target must be in [64, 512]', code: 'INVALID_BIT_TARGET' } };
  }
  return n;
}

function firstFailedCheck(checks: Record<string, boolean>): string {
  for (const [k, v] of Object.entries(checks)) {
    if (!v) return `failed check: ${k}`;
  }
  return 'unknown';
}

/**
 * Schedule a best-effort cache write. Hono's c.executionCtx is a throwing
 * getter when ExecutionContext is absent (test environment, local dev),
 * so we must wrap the access — optional chaining alone does not protect.
 */
function scheduleCacheWrite(
  c: any,
  system: TimeSystemDescriptor,
  tick: bigint,
  pulse: MintedPulse
): void {
  const promise = writeCachedPulse(c.env?.LPP_KV, system, tick, pulse);
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    // No ExecutionContext (tests / local dev). Fire and forget.
    promise.catch(() => {});
  }
}
