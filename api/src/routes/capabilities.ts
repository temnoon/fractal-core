/**
 * Capabilities endpoint - describes service features and limits
 */

import { Hono } from 'hono';
import type { CapabilitiesResponse } from '../types/api.js';
import { getSigningKeys } from '../config/keys.js';

export const capabilitiesRoute = new Hono();

capabilitiesRoute.get('/', (c) => {
  const keys = getSigningKeys();

  const response: CapabilitiesResponse = {
    version: '1.0.0',
    engines: ['auto', 'sieve', 'mr64', 'bpsw', 'mr-prob', 'precomputed'],
    signing_keys: keys.map((k) => ({
      key_id: k.keyId,
      alg: 'ed25519',
      public_key_b64: k.publicKeyB64,
    })),
    limits: {
      max_k: 10000,
      max_w: '1000000000',
      max_async_jobs: 100,
    },
    formats: ['json', 'bin'],
    compression: ['none', 'gzip', 'zstd'],
  };

  return c.json(response);
});
