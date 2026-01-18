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
const IncludeFieldSchema = z.enum(['primes', 'gaps', 'd2', 'ratio', 'indices']);

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
  engine: EngineSchema.optional().default('auto'),
  validate: ValidateSchema.optional().default('none'),
  proof: ProofSchema.optional().default('none'),
  format: FormatSchema.optional().default('json'),
  compress: CompressSchema.optional().default('none'),
});
