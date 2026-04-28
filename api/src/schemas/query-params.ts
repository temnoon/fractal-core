/**
 * Zod validation schemas for API query parameters
 */

import { z } from 'zod';
import type { CanonicalRequest, NeighborhoodQuery, VerifyRequest } from '../types/api.js';
import type { IncludeField } from '../types/neighborhood.js';

// Enum schemas
const NTypeSchema = z.enum(['index', 'value']);
const ModeSchema = z.enum(['count', 'span']);
const EngineSchema = z.enum(['auto', 'sieve', 'mr64', 'bpsw', 'mr-prob', 'precomputed']);
const ValidateSchema = z.enum(['none', 'dual', 'triple']);
const ProofSchema = z.enum(['none', 'receipt', 'signed']);
const FormatSchema = z.enum(['json', 'bin']);
const CompressSchema = z.enum(['none', 'gzip', 'zstd']);

// Include field validation
const IncludeFieldSchema = z.enum([
  'primes',
  'gaps',
  'd2',
  'ratio',
  'indices',
  'merit',
  'cramer',
  'residue',
  'residue_running',
  'theta',
  'constellations',
]);

// Bigint string validation
const BigIntString = z.string().refine(
  (val) => {
    try {
      BigInt(val);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Must be a valid bigint string' }
);

// Positive integer string
const PositiveIntString = z.string().refine(
  (val) => {
    const n = parseInt(val, 10);
    return !isNaN(n) && n > 0;
  },
  { message: 'Must be a positive integer' }
);

/**
 * Query parameters schema for neighborhood endpoints
 */
export const NeighborhoodQuerySchema = z.object({
  n: BigIntString,
  n_type: NTypeSchema.optional().default('index'),
  mode: ModeSchema.optional().default('count'),
  k: PositiveIntString.optional(),
  w: BigIntString.optional(),
  include: z.string().optional(),
  modulus: z.coerce.number().int().min(2).max(1000).optional(),
  verbose: z.coerce.boolean().optional().default(false),
  audit_level: z.enum(['milestone', 'detail']).optional().default('milestone'),
  stats_only: z.coerce.boolean().optional().default(false),
  top_n: z.coerce.number().int().min(1).max(100).optional().default(10),
  engine: EngineSchema.optional().default('auto'),
  validate: ValidateSchema.optional().default('none'),
  proof: ProofSchema.optional().default('none'),
  format: FormatSchema.optional().default('json'),
  compress: CompressSchema.optional().default('none'),
});

/**
 * Parse and validate include parameter
 */
export function parseInclude(include?: string): IncludeField[] {
  if (!include) {
    return ['primes', 'gaps', 'd2', 'ratio'];
  }

  const fields = include.split(',').map((s) => s.trim().toLowerCase());
  const validFields: IncludeField[] = [];

  for (const field of fields) {
    const result = IncludeFieldSchema.safeParse(field);
    if (result.success) {
      validFields.push(result.data);
    }
  }

  return validFields.length > 0 ? validFields : ['primes', 'gaps', 'd2', 'ratio'];
}

/**
 * Convert validated query to canonical request
 */
export function toCanonicalRequest(query: z.infer<typeof NeighborhoodQuerySchema>): CanonicalRequest {
  const include = parseInclude(query.include);

  return {
    n: query.n,
    n_type: query.n_type,
    mode: query.mode,
    k: query.k ? parseInt(query.k, 10) : undefined,
    w: query.w,
    include: [...include].sort() as IncludeField[],
    modulus: query.modulus,
    stats_only: query.stats_only,
    top_n: query.top_n,
    engine: query.engine === 'auto' ? 'sieve' : query.engine,
    validate: query.validate,
    proof: query.proof,
    format: query.format,
    compress: query.compress,
  };
}

/**
 * Canonical request schema (for verify endpoint)
 */
export const CanonicalRequestSchema = z.object({
  n: z.string(),
  n_type: NTypeSchema,
  mode: ModeSchema,
  k: z.number().int().positive().optional(),
  w: z.string().optional(),
  include: z.array(IncludeFieldSchema),
  modulus: z.number().int().min(2).optional(),
  stats_only: z.boolean().optional(),
  top_n: z.number().int().positive().optional(),
  engine: EngineSchema,
  validate: ValidateSchema,
  proof: ProofSchema,
  format: FormatSchema,
  compress: CompressSchema,
});

/**
 * Rational schema
 */
const RationalSchema = z.object({
  num: z.string(),
  den: z.string(),
});

/**
 * Neighborhood result schema
 */
const MaxRefSchema = z.object({
  value: z.number(),
  index: z.number().int(),
});

const ResidueRaceSchema = z.object({
  modulus: z.number().int(),
  counts: z.record(z.string(), z.number()),
  leader: z.string(),
  running: z.record(z.string(), z.array(z.number())).optional(),
});

const ThetaSchema = z.object({
  values: z.array(z.number()),
  total: z.number(),
  deviation: z.number(),
});

const ConstellationSchema = z.object({
  pattern_name: z.string(),
  signature: z.array(z.number()),
  positions: z.array(z.number()),
});

const FreqRowSchema = z.object({
  value: z.string(),
  count: z.number().int(),
  pct: z.number(),
});

const GapMeritEntrySchema = z.object({
  rank: z.number().int(),
  index: z.number().int(),
  p: z.string(),
  p_next: z.string(),
  gap: z.string(),
  merit: z.number(),
  cramer: z.number(),
});

const MeritStatsSchema = z.object({
  top: z.array(GapMeritEntrySchema),
  max: MaxRefSchema,
  mean: z.number(),
  histogram: z.array(z.object({
    bin: z.string(),
    count: z.number().int(),
    pct: z.number(),
  })),
});

const CramerStatsSchema = z.object({
  top: z.array(GapMeritEntrySchema),
  max: MaxRefSchema,
  mean: z.number(),
});

const ResidueRaceStatsSchema = z.object({
  modulus: z.number().int(),
  counts: z.record(z.string(), z.number()),
  pct: z.record(z.string(), z.number()),
  leader: z.string(),
  lead_changes: z.number().int().optional(),
  dominance: z.record(z.string(), z.number()).optional(),
});

const ThetaStatsSchema = z.object({
  total: z.number(),
  deviation: z.number(),
  deviation_normalized: z.number().optional(),
  starts_at_two: z.boolean(),
  p_first: z.string(),
  p_last: z.string(),
  n_primes: z.number().int(),
  sampled: z.array(z.object({
    index: z.number().int(),
    value: z.number(),
  })).optional(),
});

const ConstellationStatSchema = z.object({
  pattern_name: z.string(),
  signature: z.array(z.number()),
  count: z.number().int(),
  first_position: z.number().int().optional(),
  last_position: z.number().int().optional(),
  density_per_log_x: z.number().optional(),
  oeis: z.string().optional(),
});

const StatsBundleSchema = z.object({
  gaps: z.array(FreqRowSchema).optional(),
  d2: z.array(FreqRowSchema).optional(),
  ratio: z.array(FreqRowSchema).optional(),
  merit: MeritStatsSchema.optional(),
  cramer: CramerStatsSchema.optional(),
  residue: ResidueRaceStatsSchema.optional(),
  theta: ThetaStatsSchema.optional(),
  constellations: z.array(ConstellationStatSchema).optional(),
});

export const NeighborhoodResultSchema = z.object({
  n: z.string(),
  n_type: NTypeSchema,
  mode: ModeSchema,
  center_prime: z.string().optional(),
  primes: z.array(z.string()).optional(),
  gaps: z.array(z.string()).optional(),
  d2: z.array(z.string()).optional(),
  ratio: z.array(RationalSchema).optional(),
  indices: z.array(z.number()).optional(),
  merit: z.array(z.number()).optional(),
  max_merit: MaxRefSchema.optional(),
  cramer: z.array(z.number()).optional(),
  max_cramer: MaxRefSchema.optional(),
  residue_race: ResidueRaceSchema.optional(),
  theta: ThetaSchema.optional(),
  constellations: z.array(ConstellationSchema).optional(),
  stats: StatsBundleSchema.optional(),
});

/**
 * Receipt schema
 */
export const ReceiptSchema = z.object({
  request_hash: z.string(),
  result_hash: z.string(),
  engines: z.array(z.string()),
  validation: z.object({
    mode: z.string(),
    agreement: z.boolean(),
  }),
  deterministic: z.boolean(),
  generated_at: z.string(),
});

/**
 * Signature block schema
 */
export const SignatureBlockSchema = z.object({
  alg: z.literal('ed25519'),
  key_id: z.string(),
  signed_hash_alg: z.literal('sha256'),
  sig_b64: z.string(),
});

/**
 * Verify request body schema
 */
export const VerifyRequestSchema = z.object({
  request: CanonicalRequestSchema,
  result: NeighborhoodResultSchema,
  receipt: ReceiptSchema.optional(),
  signature: SignatureBlockSchema.optional(),
});

/**
 * Job creation request schema
 */
export const JobCreateSchema = z.object({
  n: BigIntString,
  n_type: NTypeSchema.optional().default('index'),
  mode: ModeSchema.optional().default('count'),
  k: z.number().int().positive().optional(),
  w: BigIntString.optional(),
  include: z.array(IncludeFieldSchema).optional(),
  modulus: z.number().int().min(2).optional(),
  stats_only: z.boolean().optional().default(false),
  top_n: z.number().int().min(1).max(100).optional().default(10),
  engine: EngineSchema.optional().default('auto'),
  validate: ValidateSchema.optional().default('none'),
  proof: ProofSchema.optional().default('none'),
  format: FormatSchema.optional().default('json'),
  compress: CompressSchema.optional().default('none'),
});
