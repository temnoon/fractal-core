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
  stats_only?: string;          // boolean
  top_n?: string;               // integer
  engine?: EngineType;
  validate?: ValidationMode;
  proof?: ProofLevel;
  format?: OutputFormat;
  compress?: CompressionType;
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
  stats?: {
    gaps?: { value: string; count: number; pct: number }[];
    d2?: { value: string; count: number; pct: number }[];
    ratio?: { value: string; count: number; pct: number }[];
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
