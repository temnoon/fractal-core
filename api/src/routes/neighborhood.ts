/**
 * Neighborhood endpoint - full prime neighborhood data
 */

import { Hono } from 'hono';
import { NeighborhoodQuerySchema, toCanonicalRequest } from '../schemas/query-params.js';
import { computeNeighborhood, parseComputeOptions, toNeighborhoodResult } from '../services/neighborhood.js';
import { validateNeighborhood } from '../services/validation.js';
import { computeRequestHash, computeResultHash } from '../crypto/hashing.js';
import { signResponse } from '../crypto/signing.js';
import { getPrimaryKeyPair } from '../config/keys.js';
import type { SignedResponse, Receipt } from '../types/api.js';

export const neighborhoodRoute = new Hono();

neighborhoodRoute.get('/', (c) => {
  // Parse and validate query parameters
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

  // Compute neighborhood
  const options = parseComputeOptions(request);
  const data = computeNeighborhood(options);
  const result = toNeighborhoodResult(request, data);

  // Validate if requested
  const validation = validateNeighborhood(data, request.validate);

  // Build response based on proof level
  if (request.proof === 'none') {
    // Simple response without proof
    const response: SignedResponse = {
      request,
      result,
    };
    return c.json(response);
  }

  // Build receipt
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
    const response: SignedResponse = {
      request,
      result,
      receipt,
    };
    return c.json(response);
  }

  // proof === 'signed'
  const keyPair = getPrimaryKeyPair();
  if (!keyPair) {
    return c.json({ error: 'Signing key not available' }, 500);
  }

  const signature = signResponse(request, result, receipt, keyPair);

  const response: SignedResponse = {
    request,
    result,
    receipt,
    signature,
  };

  return c.json(response);
});
