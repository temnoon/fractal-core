/**
 * OEIS-compatible output format
 *
 * Provides prime neighborhood data in formats compatible with OEIS.org:
 * - JSON format matching OEIS structure
 * - b-file format (index value pairs)
 * - Internal format (%S/%T/%U lines)
 *
 * Related OEIS sequences:
 * - A000040: The prime numbers
 * - A001223: Prime gaps: differences between consecutive primes
 * - A036263: Second differences of primes (our d2)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { sieveEngine } from '../services/engines/sieve.js';
import { computeNeighborhood, parseComputeOptions } from '../services/neighborhood.js';
import type { CanonicalRequest } from '../types/api.js';

export const oeisRoute = new Hono();

// Query schema for OEIS endpoints
const OeisQuerySchema = z.object({
  start: z.string().optional().default('0'),  // Starting index
  count: z.string().optional().default('100'), // Number of terms
  format: z.enum(['json', 'bfile', 'internal', 'list']).optional().default('json'),
});

// OEIS-like sequence metadata
interface OeisSequence {
  number: string;        // Our internal ID (not official A-number)
  id: string;            // Short ID
  name: string;          // Sequence name
  data: string;          // Comma-separated values
  offset: string;        // "start,index_of_first_1_or_term"
  author: string;
  references?: string[];
  links?: string[];
  formula?: string[];
  example?: string[];
  keyword: string;
  related?: string[];    // Related OEIS A-numbers
}

/**
 * Format sequence as OEIS JSON
 */
function formatOeisJson(seq: OeisSequence): object {
  return {
    greeting: 'Prime Terrain API - OEIS-compatible format',
    query: seq.id,
    count: 1,
    results: [seq],
  };
}

/**
 * Format as b-file (index value pairs, one per line)
 */
function formatBfile(values: bigint[], startIndex: number): string {
  const lines = values.map((v, i) => `${startIndex + i} ${v}`);
  return lines.join('\n');
}

/**
 * Format as OEIS internal format (%S, %T, %U lines)
 */
function formatInternal(id: string, values: bigint[]): string {
  const strValues = values.map((v) => v.toString());
  const lines: string[] = [];

  // Split into chunks of ~60 chars for %S, %T, %U
  let remaining = strValues.join(',');
  const prefixes = ['%S', '%T', '%U'];
  let prefixIdx = 0;

  while (remaining.length > 0 && prefixIdx < 3) {
    const chunk = remaining.slice(0, 60);
    const lastComma = chunk.lastIndexOf(',');
    const cutPoint = lastComma > 0 ? lastComma + 1 : chunk.length;

    lines.push(`${prefixes[prefixIdx]} ${id} ${remaining.slice(0, cutPoint)}`);
    remaining = remaining.slice(cutPoint);
    prefixIdx++;
  }

  return lines.join('\n');
}

/**
 * Format as simple list (one value per line)
 */
function formatList(values: bigint[]): string {
  return values.map((v) => v.toString()).join('\n');
}

/**
 * GET /oeis/primes - Prime numbers
 * Related: A000040
 */
oeisRoute.get('/primes', (c) => {
  const queryResult = OeisQuerySchema.safeParse(c.req.query());
  if (!queryResult.success) {
    return c.json({ error: 'Invalid parameters' }, 400);
  }

  const { start, count, format } = queryResult.data;
  const startIdx = parseInt(start, 10);
  const n = Math.min(parseInt(count, 10), 10000);

  // Get primes
  const primes: bigint[] = [];
  for (let i = 0; i < n; i++) {
    primes.push(sieveEngine.primeAtIndex(startIdx + i));
  }

  const startPrime = primes[0];

  if (format === 'bfile') {
    const header = [
      '# Prime numbers',
      '# Related: OEIS A000040',
      `# Starting prime: p(${startIdx}) = ${startPrime}`,
      '#',
    ];
    return c.text(header.join('\n') + '\n' + formatBfile(primes, startIdx));
  }

  if (format === 'internal') {
    return c.text(formatInternal('primes', primes));
  }

  if (format === 'list') {
    const header = [
      `# Starting prime: p(${startIdx}) = ${startPrime}`,
      '#',
    ];
    return c.text(header.join('\n') + '\n' + formatList(primes));
  }

  // JSON format
  const seq: OeisSequence = {
    number: 'PT000001',
    id: 'primes',
    name: 'The prime numbers',
    data: primes.slice(0, 100).map((p) => p.toString()).join(','),
    offset: `${startIdx},1`,
    author: 'Prime Terrain API',
    keyword: 'nonn,core',
    related: ['A000040'],
    formula: ['p(n) = n-th prime number'],
  };

  return c.json(formatOeisJson(seq));
});

/**
 * GET /oeis/gaps - Prime gaps (differences between consecutive primes)
 * Related: A001223
 */
oeisRoute.get('/gaps', (c) => {
  const queryResult = OeisQuerySchema.safeParse(c.req.query());
  if (!queryResult.success) {
    return c.json({ error: 'Invalid parameters' }, 400);
  }

  const { start, count, format } = queryResult.data;
  const startIdx = parseInt(start, 10);
  const n = Math.min(parseInt(count, 10), 10000);

  // Get starting prime
  const startPrime = sieveEngine.primeAtIndex(startIdx);

  // Compute gaps: g(n) = p(n+1) - p(n)
  const gaps: bigint[] = [];
  for (let i = 0; i < n; i++) {
    const p1 = sieveEngine.primeAtIndex(startIdx + i);
    const p2 = sieveEngine.primeAtIndex(startIdx + i + 1);
    gaps.push(p2 - p1);
  }

  // Compute frequency statistics
  const commonGaps = computeFrequencies(gaps, 10);

  if (format === 'bfile') {
    const header = [
      '# Prime gaps: g(n) = p(n+1) - p(n)',
      '# Related: OEIS A001223',
      `# Starting prime: p(${startIdx}) = ${startPrime}`,
      '#',
      '# Most common gap values in this range:',
      ...commonGaps.map((f, i) => `#   ${i + 1}. gap = ${f.value}: ${f.count} times (${f.percent})`),
      '#',
    ];
    return c.text(header.join('\n') + '\n' + formatBfile(gaps, startIdx));
  }

  if (format === 'internal') {
    return c.text(formatInternal('gaps', gaps));
  }

  if (format === 'list') {
    const header = [
      `# Starting prime: p(${startIdx}) = ${startPrime}`,
      '# Most common gap values:',
      ...commonGaps.map((f) => `#   ${f.value}: ${f.count} (${f.percent})`),
      '#',
    ];
    return c.text(header.join('\n') + '\n' + formatList(gaps));
  }

  const seq: OeisSequence = {
    number: 'PT000002',
    id: 'gaps',
    name: 'Prime gaps: differences between consecutive primes, g(n) = p(n+1) - p(n)',
    data: gaps.slice(0, 100).map((g) => g.toString()).join(','),
    offset: `${startIdx},1`,
    author: 'Prime Terrain API',
    keyword: 'nonn,easy',
    related: ['A001223'],
    formula: ['g(n) = prime(n+1) - prime(n)', 'g(n) = A000040(n+1) - A000040(n)'],
  };

  // Add frequency statistics to JSON response
  const result = formatOeisJson(seq);
  (result as any).results[0].statistics = {
    total_terms: n,
    common_gap_values: commonGaps,
  };

  return c.json(result);
});

/**
 * GET /oeis/d2 - Second differences of primes
 * d2(n) = g(n+1) - g(n) = p(n+2) - 2*p(n+1) + p(n)
 * Related: A036263
 */
oeisRoute.get('/d2', (c) => {
  const queryResult = OeisQuerySchema.safeParse(c.req.query());
  if (!queryResult.success) {
    return c.json({ error: 'Invalid parameters' }, 400);
  }

  const { start, count, format } = queryResult.data;
  const startIdx = parseInt(start, 10);
  const n = Math.min(parseInt(count, 10), 10000);

  // Get starting prime
  const startPrime = sieveEngine.primeAtIndex(startIdx);

  // Compute d2 and corresponding ratios: d2(n) = g(n+1) - g(n)
  const d2: bigint[] = [];
  const ratios: { num: bigint; den: bigint }[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = sieveEngine.primeAtIndex(startIdx + i);
    const p1 = sieveEngine.primeAtIndex(startIdx + i + 1);
    const p2 = sieveEngine.primeAtIndex(startIdx + i + 2);
    const g0 = p1 - p0;
    const g1 = p2 - p1;
    const d2val = g1 - g0;
    const span = p2 - p0;
    d2.push(d2val);

    // Compute reduced ratio
    const g = gcd(d2val < 0n ? -d2val : d2val, span);
    ratios.push({ num: d2val / g, den: span / g });
  }

  // Compute frequency statistics
  const commonD2 = computeFrequencies(d2, 10);
  const commonRatios = computeRatioFrequencies(ratios, 10);

  if (format === 'bfile') {
    // Include frequency header in b-file comments
    const header = [
      '# Second differences of primes: d2(n) = g(n+1) - g(n)',
      '# Related: OEIS A036263',
      `# Starting prime: p(${startIdx}) = ${startPrime}`,
      '#',
      '# Most common d2 values in this range:',
      ...commonD2.map((f, i) => `#   ${i + 1}. d2 = ${f.value}: ${f.count} times (${f.percent})`),
      '#',
      '# Corresponding most common ratios r(n) = d2(n)/(p(n+2)-p(n)):',
      ...commonRatios.map((f, i) => `#   ${i + 1}. r = ${f.value}: ${f.count} times (${f.percent})`),
      '#',
    ];
    return c.text(header.join('\n') + '\n' + formatBfile(d2, startIdx));
  }

  if (format === 'internal') {
    return c.text(formatInternal('d2', d2));
  }

  if (format === 'list') {
    // Include frequency header as comments
    const header = [
      `# Starting prime: p(${startIdx}) = ${startPrime}`,
      '# Most common d2 values:',
      ...commonD2.map((f) => `#   ${f.value}: ${f.count} (${f.percent})`),
      '# Most common ratios:',
      ...commonRatios.map((f) => `#   ${f.value}: ${f.count} (${f.percent})`),
      '#',
    ];
    return c.text(header.join('\n') + '\n' + formatList(d2));
  }

  const seq: OeisSequence = {
    number: 'PT000003',
    id: 'd2',
    name: 'Second differences of primes: d2(n) = (p(n+2) - p(n+1)) - (p(n+1) - p(n))',
    data: d2.slice(0, 100).map((d) => d.toString()).join(','),
    offset: `${startIdx},1`,
    author: 'Prime Terrain API',
    keyword: 'sign,easy',
    related: ['A036263', 'A001223'],
    formula: [
      'd2(n) = g(n+1) - g(n)',
      'd2(n) = prime(n+2) - 2*prime(n+1) + prime(n)',
      'd2(n) = A001223(n+1) - A001223(n)',
    ],
  };

  // Add frequency statistics to JSON response
  const result = formatOeisJson(seq);
  (result as any).results[0].statistics = {
    total_terms: n,
    common_d2_values: commonD2,
    common_ratios: commonRatios,
  };

  return c.json(result);
});

/**
 * GET /oeis/ratios - Second ratio (normalized d2)
 * r(n) = d2(n) / (p(n+2) - p(n)), always in [-1, 1]
 * This is our novel sequence
 */
oeisRoute.get('/ratios', (c) => {
  const queryResult = OeisQuerySchema.safeParse(c.req.query());
  if (!queryResult.success) {
    return c.json({ error: 'Invalid parameters' }, 400);
  }

  const { start, count, format } = queryResult.data;
  const startIdx = parseInt(start, 10);
  const n = Math.min(parseInt(count, 10), 10000);

  // Get starting prime
  const startPrime = sieveEngine.primeAtIndex(startIdx);

  // Compute ratios as [numerator, denominator] pairs
  const ratios: { num: bigint; den: bigint }[] = [];
  const d2Values: bigint[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = sieveEngine.primeAtIndex(startIdx + i);
    const p1 = sieveEngine.primeAtIndex(startIdx + i + 1);
    const p2 = sieveEngine.primeAtIndex(startIdx + i + 2);
    const d2 = (p2 - p1) - (p1 - p0);
    const span = p2 - p0;

    d2Values.push(d2);

    // Reduce fraction
    const g = gcd(d2 < 0n ? -d2 : d2, span);
    ratios.push({ num: d2 / g, den: span / g });
  }

  // Compute frequency statistics
  const commonRatios = computeRatioFrequencies(ratios, 10);
  const commonD2 = computeFrequencies(d2Values, 10);

  if (format === 'bfile') {
    // For ratios, output as "index numerator/denominator" with header
    const header = [
      '# Second ratios: r(n) = d2(n) / (p(n+2) - p(n))',
      '# Values always in [-1, 1]',
      `# Starting prime: p(${startIdx}) = ${startPrime}`,
      '#',
      '# Most common ratio values in this range:',
      ...commonRatios.map((f, i) => `#   ${i + 1}. r = ${f.value}: ${f.count} times (${f.percent})`),
      '#',
      '# Corresponding most common d2 values:',
      ...commonD2.map((f, i) => `#   ${i + 1}. d2 = ${f.value}: ${f.count} times (${f.percent})`),
      '#',
    ];
    const lines = ratios.map((r, i) => `${startIdx + i} ${r.num}/${r.den}`);
    return c.text(header.join('\n') + '\n' + lines.join('\n'));
  }

  if (format === 'list') {
    const header = [
      `# Starting prime: p(${startIdx}) = ${startPrime}`,
      '# Most common ratio values:',
      ...commonRatios.map((f) => `#   ${f.value}: ${f.count} (${f.percent})`),
      '# Most common d2 values:',
      ...commonD2.map((f) => `#   ${f.value}: ${f.count} (${f.percent})`),
      '#',
    ];
    return c.text(header.join('\n') + '\n' + ratios.map((r) => `${r.num}/${r.den}`).join('\n'));
  }

  // JSON format with both numerators and denominators
  const seq: OeisSequence = {
    number: 'PT000004',
    id: 'ratios',
    name: 'Second ratio of primes: r(n) = d2(n) / (p(n+2) - p(n)), values in [-1, 1]',
    data: ratios.slice(0, 50).map((r) => `${r.num}/${r.den}`).join(','),
    offset: `${startIdx},1`,
    author: 'Prime Terrain API',
    keyword: 'sign,frac',
    related: ['A036263', 'A001223', 'A000040'],
    formula: [
      'r(n) = d2(n) / span(n)',
      'r(n) = (g(n+1) - g(n)) / (p(n+2) - p(n))',
      'r(n) is always in the interval [-1, 1]',
      'r(n) = -1 when g(n+1) = 0 (impossible for primes > 2)',
      'r(n) = 1 when g(n) = 0 (impossible for primes > 2)',
      'r(n) = 0 when g(n) = g(n+1) (balanced twin-like gap)',
    ],
    example: [
      'For n=0: p(0)=2, p(1)=3, p(2)=5',
      '  g(0)=1, g(1)=2, d2(0)=1, span=3',
      '  r(0) = 1/3',
    ],
  };

  // Add separate arrays for numerators and denominators + statistics
  const result = formatOeisJson(seq);
  (result as any).results[0].numerators = ratios.slice(0, 100).map((r) => r.num.toString());
  (result as any).results[0].denominators = ratios.slice(0, 100).map((r) => r.den.toString());
  (result as any).results[0].statistics = {
    total_terms: n,
    common_ratios: commonRatios,
    common_d2_values: commonD2,
  };

  return c.json(result);
});

/**
 * GET /oeis/neighborhood - Full neighborhood in OEIS format
 */
oeisRoute.get('/neighborhood', (c) => {
  const queryResult = z.object({
    n: z.string(),
    k: z.string().optional().default('10'),
    format: z.enum(['json', 'bfile', 'list']).optional().default('json'),
  }).safeParse(c.req.query());

  if (!queryResult.success) {
    return c.json({ error: 'Invalid parameters' }, 400);
  }

  const { n, k, format } = queryResult.data;
  const request: CanonicalRequest = {
    n,
    n_type: 'index',
    mode: 'count',
    k: parseInt(k, 10),
    include: ['primes', 'gaps', 'd2', 'ratio', 'indices'],
    engine: 'sieve',
    validate: 'none',
    proof: 'none',
    format: 'json',
    compress: 'none',
  };

  const options = parseComputeOptions(request);
  const data = computeNeighborhood(options);

  if (format === 'bfile' || format === 'list') {
    const lines: string[] = [
      '# Prime Neighborhood Data',
      `# Center index: ${data.centerIndex}`,
      `# Center prime: ${data.centerPrime}`,
      '',
      '# Primes:',
      ...data.primes.map((p, i) => `${data.indices[i]} ${p}`),
      '',
      '# Gaps:',
      ...data.gaps.map((g, i) => `${data.indices[i]} ${g}`),
      '',
      '# Second differences:',
      ...data.d2.map((d, i) => `${data.indices[i]} ${d}`),
      '',
      '# Second ratios:',
      ...data.ratios.map((r, i) => `${data.indices[i]} ${r.num}/${r.den}`),
    ];
    return c.text(lines.join('\n'));
  }

  // JSON with all sequences
  return c.json({
    greeting: 'Prime Terrain API - Neighborhood in OEIS-compatible format',
    center: {
      index: data.centerIndex,
      prime: data.centerPrime.toString(),
    },
    sequences: {
      primes: {
        id: 'primes',
        related: ['A000040'],
        offset: data.indices[0],
        data: data.primes.map((p) => p.toString()),
      },
      gaps: {
        id: 'gaps',
        related: ['A001223'],
        offset: data.indices[0],
        data: data.gaps.map((g) => g.toString()),
      },
      d2: {
        id: 'd2',
        related: ['A036263'],
        offset: data.indices[0],
        data: data.d2.map((d) => d.toString()),
      },
      ratios: {
        id: 'ratios',
        offset: data.indices[0],
        data: data.ratios.map((r) => ({ num: r.num, den: r.den })),
      },
    },
    indices: data.indices,
  });
});

/**
 * GET /oeis - List available sequences
 */
oeisRoute.get('/', (c) => {
  return c.json({
    greeting: 'Prime Terrain API - OEIS-compatible endpoints',
    sequences: [
      {
        endpoint: '/oeis/primes',
        id: 'PT000001',
        name: 'Prime numbers',
        related: ['A000040'],
      },
      {
        endpoint: '/oeis/gaps',
        id: 'PT000002',
        name: 'Prime gaps',
        related: ['A001223'],
      },
      {
        endpoint: '/oeis/d2',
        id: 'PT000003',
        name: 'Second differences of primes',
        related: ['A036263'],
      },
      {
        endpoint: '/oeis/ratios',
        id: 'PT000004',
        name: 'Second ratio (normalized d2)',
        related: [],
      },
      {
        endpoint: '/oeis/neighborhood',
        id: 'neighborhood',
        name: 'Full neighborhood data',
        related: [],
      },
    ],
    formats: ['json', 'bfile', 'list', 'internal'],
    parameters: {
      start: 'Starting index (default: 0)',
      count: 'Number of terms (default: 100, max: 10000)',
      format: 'Output format: json, bfile, list, internal',
    },
  });
});

// Helper: GCD for reducing fractions
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a === 0n ? 1n : a;
}

/**
 * Compute frequency of values and return top N most common
 */
function computeFrequencies(values: bigint[], topN: number = 10): { value: string; count: number; percent: string }[] {
  const freq = new Map<string, number>();
  for (const v of values) {
    const key = v.toString();
    freq.set(key, (freq.get(key) || 0) + 1);
  }

  const sorted = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  const total = values.length;
  return sorted.map(([value, count]) => ({
    value,
    count,
    percent: ((count / total) * 100).toFixed(2) + '%',
  }));
}

/**
 * Compute ratio frequencies
 */
function computeRatioFrequencies(
  ratios: { num: bigint; den: bigint }[],
  topN: number = 10
): { value: string; count: number; percent: string }[] {
  const freq = new Map<string, number>();
  for (const r of ratios) {
    const key = `${r.num}/${r.den}`;
    freq.set(key, (freq.get(key) || 0) + 1);
  }

  const sorted = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  const total = ratios.length;
  return sorted.map(([value, count]) => ({
    value,
    count,
    percent: ((count / total) * 100).toFixed(2) + '%',
  }));
}
