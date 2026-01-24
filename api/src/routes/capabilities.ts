/**
 * Capabilities endpoint - describes service features and limits
 */

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import type { CapabilitiesResponse } from '../types/api.js';
import type { AuthContext } from '../types/user.js';
import { TIER_LIMITS } from '../types/user.js';
import { getSigningKeysAsync, getDetailedKeyInfo } from '../config/keys.js';

export const capabilitiesRoute = new Hono<{ Bindings: Env }>();

capabilitiesRoute.get('/', async (c) => {
  const keys = await getSigningKeysAsync();
  const keyInfo = await getDetailedKeyInfo();
  const auth = c.get('auth') as AuthContext | null;

  // Base limits (free tier or authenticated user's tier)
  const tierLimits = auth?.limits || TIER_LIMITS.free;

  const response: Record<string, unknown> = {
    version: '1.0.0',
    engines: ['auto', 'sieve', 'miller-rabin', 'bpsw'],
    signing_keys: keys.map((k) => ({
      key_id: k.keyId,
      alg: 'ed25519',
      public_key_b64: k.publicKeyB64,
    })),
    key_storage: {
      persistent: keyInfo.persistent,
      created_at: keyInfo.created_at,
    },
    limits: {
      max_k: 10000,
      max_w: '1000000000',
      max_async_jobs: tierLimits.asyncJobs,
      sieve_limit: 10000000,
    },
    rate_limits: {
      requests_per_minute: tierLimits.requestsPerMinute,
      expensive_per_minute: tierLimits.expensivePerMinute,
    },
    formats: ['json', 'bin'],
    compression: ['none', 'gzip', 'zstd'],
  };

  // Add user tier info if authenticated
  if (auth) {
    response.authenticated = true;
    response.user = {
      id: auth.user.id,
      tier: auth.user.tier,
    };
    response.tier_limits = {
      cpu_time_per_month_ms: tierLimits.cpuTimePerMonth,
      requests_per_minute: tierLimits.requestsPerMinute,
      expensive_per_minute: tierLimits.expensivePerMinute,
      async_jobs: tierLimits.asyncJobs,
    };
  } else {
    response.authenticated = false;
    response.tier = 'free';
    response.tier_limits = {
      cpu_time_per_month_ms: TIER_LIMITS.free.cpuTimePerMonth,
      requests_per_minute: TIER_LIMITS.free.requestsPerMinute,
      expensive_per_minute: TIER_LIMITS.free.expensivePerMinute,
      async_jobs: TIER_LIMITS.free.asyncJobs,
    };
  }

  // Available tiers info
  response.available_tiers = {
    free: {
      cpu_time_per_month: '5 minutes',
      requests_per_minute: TIER_LIMITS.free.requestsPerMinute,
      expensive_per_minute: TIER_LIMITS.free.expensivePerMinute,
      async_jobs: TIER_LIMITS.free.asyncJobs,
    },
    pro: {
      cpu_time_per_month: 'unlimited (pay-per-use)',
      requests_per_minute: TIER_LIMITS.pro.requestsPerMinute,
      expensive_per_minute: TIER_LIMITS.pro.expensivePerMinute,
      async_jobs: TIER_LIMITS.pro.asyncJobs,
    },
    enterprise: {
      cpu_time_per_month: 'custom',
      requests_per_minute: TIER_LIMITS.enterprise.requestsPerMinute,
      expensive_per_minute: TIER_LIMITS.enterprise.expensivePerMinute,
      async_jobs: TIER_LIMITS.enterprise.asyncJobs,
    },
  };

  return c.json(response);
});
