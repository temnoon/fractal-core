/**
 * Pulse System Types
 *
 * A "pulse system" is a (anchor, tick_unit, signing_key) tuple that produces
 * a monotonic integer clock T (the tick) and signs minted primes against it.
 *
 * Four canonical systems ship in the registry: cosmic, tonga, yad, milli.
 * Anyone can stand up their own with their own anchor + key.
 */

/**
 * Wire-format version for the signed pulse envelope.
 *
 * Bumped on any breaking change to the canonical shape of `{protocol_version,
 * time_system, request?, pulse, receipt}` — fields added, removed, renamed,
 * or repositioned in the canonical sort order in a way that invalidates
 * existing signatures, or fields whose semantics change.
 *
 * The version is itself part of the signed bytes: a tampered-down version
 * tag fails signature verification. Verifiers must reject unrecognized
 * versions rather than ignoring them, otherwise consumers split-brain on
 * the meaning of a "valid" pulse.
 */
export const PULSE_PROTOCOL_VERSION = 'fc-pulse/1';

export type MintCadence = 'fresh-per-mint' | 'one-per-tick';

export interface TimeSystemDescriptor {
  /** Stable system identifier, used in URL paths. e.g. "cosmic", "tonga", "yad", "milli" */
  id: string;

  /** Human-readable label of this time system */
  label: string;

  /** Wall-clock anchor, ISO 8601 in UTC */
  anchor_iso: string;

  /** Human-readable label for the anchor event */
  anchor_label: string;

  /**
   * Cosmic age before the anchor, in Earth seconds.
   * For systems that count from a pre-historic event (cosmic counts from
   * 16 By before Carrington), this offsets T forward. 0 for systems whose
   * zero is at the anchor itself.
   */
  age_before_anchor_seconds: number;

  /** One Earth-second equals (1 / tick_unit_seconds) ticks */
  tick_unit_seconds: number;

  /** Human-readable label for the tick unit */
  tick_unit_label: string;

  /** Default bit-target for minted primes if request omits it */
  bit_target_default: number;

  /** Width of the random sampling window in bits */
  window_bits: number;

  /**
   * fresh-per-mint: every mint generates a new prime
   * one-per-tick:   the first mint at tick T generates a prime, subsequent
   *                 mints at the same T return the cached prime.
   */
  mint_cadence: MintCadence;

  /** Operator domain of the server signing pulses for this system */
  operator: string;

  /**
   * Public-disclosure note that gets surfaced in /parameters and on the
   * demo page. Lets operators state honestly how the system was built.
   */
  disclosure: string;
}

/**
 * Output of pulse minting, before signing.
 *
 * The bundle binds together:
 *   - tick: the clock value (cosmic time)
 *   - prime: the random event signature
 *   - request: who asked, who it's for, when, with what nonce
 *   - receipt: hashes pinning request + pulse for replay/integrity
 */
export interface MintedPulse {
  system_id: string;
  tick: string;             // bigint as string for canonical JSON
  prime: string;            // bigint as string
  prime_bits: number;
  bit_target: number;
  wall_clock_iso: string;   // earth-time at mint, for sub-tick ordering
  display?: Record<string, unknown>; // optional human-readable rendering of T
}

export interface MintRequest {
  system_id: string;
  target_domain: string;
  target_node?: string;     // optional LPP2 address binding
  bit_target?: number;
  nonce: string;            // client-supplied 32-hex chars
  purpose?: string;
  expires_at_iso: string;   // server-computed
  minted_at_iso: string;    // server-computed
  requester_key_id?: string; // present when authenticated
  requester_domain?: string;
}

export interface MintReceipt {
  request_hash: string;     // sha256 hex of canonical(request)
  pulse_hash: string;       // sha256 hex of canonical(pulse)
  bundle_hash: string;      // sha256 hex of canonical({request, pulse})
  generated_at_iso: string;
}

/** Audit trail returned when verbose=true */
export interface AuditBlock {
  tick_calculation: {
    now_unix_seconds: number;
    anchor_unix_seconds: number;
    elapsed_since_anchor_seconds: number;
    age_before_anchor_seconds: number;
    tick_unit_seconds: number;
    tick: string;
  };
  estimate_calculation: {
    pnt_p_t_estimate: string;
    pnt_p_t_bits: number;
    bit_target: number;
    estimate_method: 'pnt' | 'random_in_bit_class';
    prime_estimate: string;
    prime_estimate_bits: number;
  };
  window: {
    low: string;
    high: string;
    width_bits: number;
    csprng_bytes_used: number;
  };
  candidates_tried: Array<{
    candidate: string;
    result: 'composite' | 'probable_prime';
  }>;
  attempt_count: number;
  elapsed_ms: number;
}

export interface SignatureBlock {
  alg: 'ed25519';
  key_id: string;
  signed_hash_alg: 'sha256';
  sig_b64: string;
}

/**
 * The full signed package returned to the caller.
 * For mint requests: all fields present.
 * For public /now broadcasts: request omitted, target_domain absent.
 */
export interface SignedPulse {
  protocol_version: string;
  time_system: TimeSystemDescriptor;
  request?: MintRequest;
  pulse: MintedPulse;
  receipt: MintReceipt;
  signature: SignatureBlock;
  audit?: AuditBlock;
}

/**
 * Verify-mint request body
 */
export interface VerifyMintRequest {
  signed: SignedPulse;
}

export interface VerifyMintResponse {
  valid: boolean;
  reason?: string;
  checks: {
    protocol_version: boolean;
    signature: boolean;
    request_hash: boolean;
    pulse_hash: boolean;
    bundle_hash: boolean;
    expires_in_future: boolean;
    prime_is_prime: boolean;
  };
}
