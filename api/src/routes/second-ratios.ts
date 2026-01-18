/**
 * Second-ratios endpoint - returns normalized ratio r values
 */

import { Hono } from 'hono';
import { NeighborhoodQuerySchema, toCanonicalRequest } from '../schemas/query-params.js';
import { computeNeighborhood, parseComputeOptions, toNeighborhoodResult } from '../services/neighborhood.js';
import { validateNeighborhood } from '../services/validation.js';
import { computeRequestHash, computeResultHash } from '../crypto/hashing.js';
import { signResponse } from '../crypto/signing.js';
import { getPrimaryKeyPair } from '../config/keys.js';
import type { SignedResponse, Receipt, CanonicalRequest } from '../types/api.js';

export const secondRatiosRoute = new Hono();

secondRatiosRoute.get('/', (c) => {
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

  // Override include to only return ratios
  const request: CanonicalRequest = {
    ...toCanonicalRequest(query),
    include: ['ratio'],
  };

  const options = parseComputeOptions(request);
  const data = computeNeighborhood(options);
  const result = toNeighborhoodResult(request, data);

  const validation = validateNeighborhood(data, request.validate);

  if (request.proof === 'none') {
    const response: SignedResponse = { request, result };
    return c.json(response);
  }

  const receipt: Receipt = {
    request_hash: computeRequestHash(request),
    result_hash: computeResultHash(result),
    engines: validation.engines,
    validation: {
      mode: validation.mode,
      agreement: validation.agreement,
    },
    deterministic: true,
    generated_at: new Date().toISOString(),
  };

  if (request.proof === 'receipt') {
    const response: SignedResponse = { request, result, receipt };
    return c.json(response);
  }

  const keyPair = getPrimaryKeyPair();
  if (!keyPair) {
    return c.json({ error: 'Signing key not available' }, 500);
  }

  const signature = signResponse(request, result, receipt, keyPair);
  const response: SignedResponse = { request, result, receipt, signature };
  return c.json(response);
});
