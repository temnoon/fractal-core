/**
 * Constellations endpoint: Hardy–Littlewood style k-tuple admissibility +
 * (bounded) forward search for a user-supplied gap signature.
 *
 * GET /api/v1/constellations/admissible?signature=2,4,2
 *   Instant: checks no small prime covers every residue class of the tuple.
 *
 * GET /api/v1/constellations?signature=2,4,2&start=100&limit=10
 *   Walks primes forward from `start`, returning the first `limit` matches.
 *   This path is CPU-capped for synchronous use; larger searches should be
 *   moved into the async job system in a follow-up iteration.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../types/env.js';
import { primeEngine } from '../services/engines/index.js';
import { checkAdmissible, signatureToOffsets, KNOWN_PATTERNS } from '../services/lib/constellations.js';

export const constellationsRoute = new Hono<{ Bindings: Env }>();

/** Parse a comma-separated positive-integer list into a signature array. */
function parseSignature(raw: string | undefined): number[] | null {
  if (!raw) return null;
  const parts = raw.split(',').map((s) => s.trim());
  if (parts.length === 0) return null;
  const out: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n <= 0 || n > 10_000) return null;
    out.push(n);
  }
  return out;
}

const searchQuerySchema = z.object({
  signature: z.string(),
  start: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

// Hard cap the synchronous primes-walked budget to avoid Worker CPU overrun.
const MAX_PRIMES_PER_SYNC_SEARCH = 20_000;

/** Admissibility endpoint — pure arithmetic, no prime walking. */
constellationsRoute.get('/admissible', (c) => {
  const raw = c.req.query('signature');
  const signature = parseSignature(raw);
  if (!signature) {
    return c.json({ error: 'Invalid signature — expected comma-separated positive integers' }, 400);
  }
  const result = checkAdmissible(signature);
  const known = KNOWN_PATTERNS.find(
    (p) =>
      p.signature.length === signature.length &&
      p.signature.every((x, i) => x === signature[i]),
  );
  return c.json({
    signature,
    offsets: result.offsets,
    admissible: result.admissible,
    reason: result.reason,
    pattern_name: known?.name,
  });
});

/** Forward search for matches of the supplied signature (synchronous, bounded). */
constellationsRoute.get('/', (c) => {
  const parsed = searchQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', details: parsed.error.issues }, 400);
  }
  const signature = parseSignature(parsed.data.signature);
  if (!signature) {
    return c.json({ error: 'Invalid signature — expected comma-separated positive integers' }, 400);
  }

  // Admissibility is cheap and useful up-front — avoids fruitless walks.
  const adm = checkAdmissible(signature);
  if (!adm.admissible) {
    return c.json({
      signature,
      offsets: adm.offsets,
      admissible: false,
      reason: adm.reason,
      matches: [],
      primes_scanned: 0,
      limit_reached: false,
    });
  }

  const startRaw = parsed.data.start ?? '2';
  let start: bigint;
  try {
    start = BigInt(startRaw);
    if (start < 2n) start = 2n;
  } catch {
    return c.json({ error: 'Invalid start value' }, 400);
  }

  const limit = parsed.data.limit;
  const signatureBig = signature.map((g) => BigInt(g));
  const window = signature.length + 1;

  // Prime the sliding window with enough primes to test one tuple.
  const primes: bigint[] = [];
  let cursor = primeEngine.nextPrime(start).prime;
  primes.push(cursor);
  for (let i = 1; i < window; i++) {
    cursor = primeEngine.nextPrime(cursor + 1n).prime;
    primes.push(cursor);
  }

  const matches: string[] = [];
  let primesScanned = primes.length;

  const matchesHere = (): boolean => {
    for (let i = 0; i < signatureBig.length; i++) {
      if (primes[i + 1] - primes[i] !== signatureBig[i]) return false;
    }
    return true;
  };

  while (matches.length < limit && primesScanned < MAX_PRIMES_PER_SYNC_SEARCH) {
    if (matchesHere()) {
      matches.push(primes[0].toString());
      if (matches.length >= limit) break;
    }
    // Slide the window forward one prime.
    primes.shift();
    cursor = primeEngine.nextPrime(cursor + 1n).prime;
    primes.push(cursor);
    primesScanned++;
  }

  return c.json({
    signature,
    offsets: adm.offsets,
    admissible: true,
    start: start.toString(),
    matches,
    primes_scanned: primesScanned,
    limit_reached: matches.length >= limit,
    truncated: matches.length < limit && primesScanned >= MAX_PRIMES_PER_SYNC_SEARCH,
  });
});
