/**
 * Fingerprint endpoint - returns request/result hashes without payload
 */

import { Hono } from 'hono';
import { NeighborhoodQuerySchema, toCanonicalRequest } from '../schemas/query-params.js';
import { computeNeighborhood, parseComputeOptions, toNeighborhoodResult } from '../services/neighborhood.js';
import { validateNeighborhood } from '../services/validation.js';
import { computeRequestHash, computeResultHash } from '../crypto/hashing.js';
import type { FingerprintResponse } from '../types/api.js';

export const fingerprintRoute = new Hono();

fingerprintRoute.get('/', (c) => {
  const queryResult = NeighborhoodQuerySchema.safeParse(c.req.query());

  if (!queryResult.success) {
    return c.json(
      {
        error: 'Invalid query parameters',
        details: queryResult.error.issues,
      },
      400
    );
  }

  const query = queryResult.data;
  const request = toCanonicalRequest(query);

  // Compute neighborhood (to get result hash)
  const options = parseComputeOptions(request);
  const data = computeNeighborhood(options);
  const result = toNeighborhoodResult(request, data);

  const validation = validateNeighborhood(data, request.validate);

  const response: FingerprintResponse = {
    request_hash: computeRequestHash(request),
    result_hash: computeResultHash(result),
    engines: validation.engines,
    generated_at: new Date().toISOString(),
  };

  return c.json(response);
});
