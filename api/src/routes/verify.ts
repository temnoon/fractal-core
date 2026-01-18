/**
 * Verify endpoint - verifies signature and canonical hashes
 */

import { Hono } from 'hono';
import { VerifyRequestSchema } from '../schemas/query-params.js';
import { computeRequestHash, computeResultHash } from '../crypto/hashing.js';
import { verifySignature } from '../crypto/signing.js';
import { getPublicKeyById } from '../config/keys.js';
import type { VerifyResponse } from '../types/api.js';

export const verifyRoute = new Hono();

verifyRoute.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parseResult = VerifyRequestSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json(
      {
        error: 'Invalid request body',
        details: parseResult.error.issues,
      },
      400
    );
  }

  const { request, result, receipt, signature } = parseResult.data;
  const errors: string[] = [];

  // Compute expected hashes
  const expectedRequestHash = computeRequestHash(request);
  const expectedResultHash = computeResultHash(result);

  // Check request hash (if receipt provided)
  const requestHashCheck = {
    expected: expectedRequestHash,
    actual: receipt?.request_hash ?? '',
    match: receipt ? receipt.request_hash === expectedRequestHash : true,
  };

  if (receipt && !requestHashCheck.match) {
    errors.push('Request hash mismatch');
  }

  // Check result hash (if receipt provided)
  const resultHashCheck = {
    expected: expectedResultHash,
    actual: receipt?.result_hash ?? '',
    match: receipt ? receipt.result_hash === expectedResultHash : true,
  };

  if (receipt && !resultHashCheck.match) {
    errors.push('Result hash mismatch');
  }

  // Check signature (if provided)
  let signatureCheck: { valid: boolean; key_id: string } | undefined;

  if (signature && receipt) {
    const publicKey = getPublicKeyById(signature.key_id);

    if (!publicKey) {
      errors.push(`Unknown signing key: ${signature.key_id}`);
      signatureCheck = {
        valid: false,
        key_id: signature.key_id,
      };
    } else {
      const valid = verifySignature(request, result, receipt, signature, publicKey);
      signatureCheck = {
        valid,
        key_id: signature.key_id,
      };

      if (!valid) {
        errors.push('Signature verification failed');
      }
    }
  }

  const response: VerifyResponse = {
    valid: errors.length === 0,
    checks: {
      request_hash: requestHashCheck,
      result_hash: resultHashCheck,
      signature: signatureCheck,
    },
    errors: errors.length > 0 ? errors : undefined,
  };

  return c.json(response);
});
