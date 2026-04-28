/**
 * API request/response types
 */

import type {
  Rational,
  NType,
  NeighborhoodMode,
  EngineType,
  ValidationMode,
  ProofLevel,
  OutputFormat,
  CompressionType,
  IncludeField,
} from './neighborhood.js';

/** Canonical request echo - included in signed responses */
export interface CanonicalRequest {
  n: string;                    // Anchor value as string (for bigint)
  n_type: NType;
  mode: NeighborhoodMode;
  k?: number;                   // Count of primes each side (count mode)
  w?: string;                   // Half-width as string (span mode)
  include: IncludeField[];      // Sorted array
  modulus?: number;             // Residue-race modulus (default 4 when residue requested)
  stats_only?: boolean;         // If true, return statistics only (no full lists)
  top_n?: number;               // Top-N entries for stats
  engine: EngineType;
  validate: ValidationMode;
  proof: ProofLevel;
  format: OutputFormat;
  compress: CompressionType;
}

/** Query parameters as received from HTTP request */
export interface NeighborhoodQuery {
  n: string;
  n_type?: NType;
  mode?: NeighborhoodMode;
  k?: string;
  w?: string;
  include?: string;             // Comma-separated
  modulus?: string;             // integer (default 4 for residue)
  stats_only?: string;          // boolean
  top_n?: string;               // integer
  engine?: EngineType;
  validate?: ValidationMode;
  proof?: ProofLevel;
  format?: OutputFormat;
  compress?: CompressionType;
}

/** Extremum reference used in merit/cramer summaries */
export interface MaxRef {
  value: number;
  index: number;
}

/** Residue race tally */
export interface ResidueRace {
  modulus: number;
  counts: Record<string, number>;
  leader: string;
  running?: Record<string, number[]>;
}

/** Chebyshev theta function running sum */
export interface ThetaData {
  values: number[];
  total: number;
  deviation: number;
}

/** A matched prime-constellation pattern */
export interface ConstellationMatch {
  pattern_name: string;
  signature: number[];
  positions: number[];
}

/** One row of a merit / Cramér top-N table — research-paper friendly. */
export interface GapMeritEntry {
  rank: number;          // 1-indexed
  index: number;         // index into the gaps[] array (and into primes[i])
  p: string;             // p_n (the gap's lower endpoint)
  p_next: string;        // p_{n+1}
  gap: string;
  merit: number;         // g / ln(p)
  cramer: number;        // g / ln²(p)
}

/** Summary of merit values across the neighborhood. */
export interface MeritStats {
  top: GapMeritEntry[];
  max: MaxRef;
  mean: number;
  histogram: { bin: string; count: number; pct: number }[];
}

/** Summary of Cramér ratios across the neighborhood. */
export interface CramerStats {
  top: GapMeritEntry[];      // sorted by Cramér ratio
  max: MaxRef;
  mean: number;
}

/** Residue-race summary with bias diagnostics (stats_only flavor). */
export interface ResidueRaceStats {
  modulus: number;
  counts: Record<string, number>;
  pct: Record<string, number>;
  leader: string;
  lead_changes?: number;             // # of times the leader switched
  dominance?: Record<string, number>; // % of indices each class led
}

/** Theta summary suitable for stats_only mode. */
export interface ThetaStats {
  total: number;
  deviation: number;
  deviation_normalized?: number;     // (θ-x)/√x  (only when neighborhood begins at p=2)
  starts_at_two: boolean;
  p_first: string;
  p_last: string;
  n_primes: number;
  sampled?: { index: number; value: number }[];  // log-spaced or every-Nth checkpoints
}

/** One row of the constellation summary table. */
export interface ConstellationStat {
  pattern_name: string;
  signature: number[];
  count: number;
  first_position?: number;
  last_position?: number;
  density_per_log_x?: number;        // observed: count / Δ(ln x)
  oeis?: string;                     // canonical OEIS reference
}

/** Neighborhood result - the computed data */
export interface NeighborhoodResult {
  n: string;
  n_type: NType;
  mode: NeighborhoodMode;
  center_prime?: string;
  primes?: string[];            // Bigint strings
  gaps?: string[];              // Unsigned bigint strings
  d2?: string[];                // Signed bigint strings
  ratio?: Rational[];           // {num, den} pairs
  indices?: number[];
  merit?: number[];
  max_merit?: MaxRef;
  cramer?: number[];
  max_cramer?: MaxRef;
  residue_race?: ResidueRace;
  theta?: ThetaData;
  constellations?: ConstellationMatch[];
  stats?: {
    gaps?: { value: string; count: number; pct: number }[];
    d2?: { value: string; count: number; pct: number }[];
    ratio?: { value: string; count: number; pct: number }[];
    merit?: MeritStats;
    cramer?: CramerStats;
    residue?: ResidueRaceStats;
    theta?: ThetaStats;
    constellations?: ConstellationStat[];
  };
}

/** Receipt for proof of computation */
export interface Receipt {
  request_hash: string;         // SHA-256 hex
  result_hash: string;          // SHA-256 hex
  engines: string[];
  validation: {
    mode: string;
    agreement: boolean;
  };
  deterministic: boolean;
  generated_at: string;         // ISO 8601
}

/** Signature block for signed proofs */
export interface SignatureBlock {
  alg: 'ed25519';
  key_id: string;
  signed_hash_alg: 'sha256';
  sig_b64: string;              // Base64 signature
}

/** Complete signed response structure */
export interface SignedResponse {
  request: CanonicalRequest;
  result: NeighborhoodResult;
  receipt?: Receipt;
  signature?: SignatureBlock;
}

/** Status response */
export interface StatusResponse {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptime_seconds: number;
}

/** Capabilities response */
export interface CapabilitiesResponse {
  version: string;
  engines: EngineType[];
  signing_keys: {
    key_id: string;
    alg: 'ed25519';
    public_key_b64: string;
  }[];
  limits: {
    max_k: number;
    max_w: string;
    max_async_jobs: number;
  };
  formats: OutputFormat[];
  compression: CompressionType[];
}

/** Job status */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

/** Job record for async processing */
export interface Job {
  id: string;
  status: JobStatus;
  request: CanonicalRequest;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  result?: SignedResponse;
  error?: string;
  progress?: number;
  chunksProcessed?: number;
  userId?: string;
  cpu_time_ms?: number;
  primesFound?: number;
  phase?: 'backward' | 'forward' | 'computing';
}

/** Job creation response */
export interface JobCreatedResponse {
  job_id: string;
  status: JobStatus;
  poll_url: string;
}

/** Job status response */
export interface JobStatusResponse {
  job_id: string;
  status: JobStatus;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  result_url?: string;
  error?: string;
  progress?: number;
  chunks_processed?: number;
  cpu_time_ms?: number;
  primes_found?: number;
  phase?: 'backward' | 'forward' | 'computing';
}

/** Verify request body */
export interface VerifyRequest {
  request: CanonicalRequest;
  result: NeighborhoodResult;
  receipt?: Receipt;
  signature?: SignatureBlock;
}

/** Verify response */
export interface VerifyResponse {
  valid: boolean;
  checks: {
    request_hash: { expected: string; actual: string; match: boolean };
    result_hash: { expected: string; actual: string; match: boolean };
    signature?: { valid: boolean; key_id: string };
  };
  errors?: string[];
}

/** Fingerprint response (hashes without payload) */
export interface FingerprintResponse {
  request_hash: string;
  result_hash: string;
  engines: string[];
  generated_at: string;
}
