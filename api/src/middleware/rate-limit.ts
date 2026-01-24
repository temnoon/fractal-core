/**
 * Rate Limiting Middleware
 *
 * Implements a sliding window rate limiter using Workers KV for persistence.
 * Falls back to per-worker memory if KV is unavailable.
 * Supports tiered rate limits based on user authentication.
 */

import { Context, Next } from 'hono';
import type { Env } from '../types/env.js';
import type { AuthContext, TierLimits } from '../types/user.js';
import { TIER_LIMITS } from '../types/user.js';

interface RateLimitConfig {
  windowMs: number;       // Time window in milliseconds
  maxRequests: number;    // Maximum requests per window
  keyGenerator?: (c: Context) => string;  // Custom key generator
  skipFailedRequests?: boolean;  // Don't count failed requests
  message?: string;       // Custom rate limit message
}

interface RateLimitInfo {
  count: number;
  resetAt: number;
}

// In-memory store for rate limiting (fallback when KV unavailable)
const memoryStore = new Map<string, RateLimitInfo>();

// Default rate limit configuration
const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000,    // 1 minute
  maxRequests: 100,       // 100 requests per minute
  message: 'Too many requests, please try again later.',
};

// Stricter limits for expensive endpoints
const EXPENSIVE_ENDPOINTS_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000,
  maxRequests: 20,
  message: 'Rate limit exceeded for computation-heavy endpoint.',
};

/**
 * Get client identifier for rate limiting
 */
function getClientKey(c: Context): string {
  // Try CF-Connecting-IP first (most reliable on Cloudflare)
  const cfIp = c.req.header('CF-Connecting-IP');
  if (cfIp) return `ip:${cfIp}`;

  // Fall back to X-Forwarded-For
  const xForwardedFor = c.req.header('X-Forwarded-For');
  if (xForwardedFor) {
    const ip = xForwardedFor.split(',')[0].trim();
    return `ip:${ip}`;
  }

  // Fall back to X-Real-IP
  const xRealIp = c.req.header('X-Real-IP');
  if (xRealIp) return `ip:${xRealIp}`;

  // Last resort: use a generic key (not recommended for production)
  return 'ip:unknown';
}

/**
 * Clean up expired entries from memory store
 */
function cleanupMemoryStore(): void {
  const now = Date.now();
  for (const [key, info] of memoryStore.entries()) {
    if (info.resetAt < now) {
      memoryStore.delete(key);
    }
  }
}

/**
 * Check rate limit using memory store
 */
function checkMemoryRateLimit(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const info = memoryStore.get(key);

  // Clean up periodically (every 100th request)
  if (Math.random() < 0.01) {
    cleanupMemoryStore();
  }

  if (!info || info.resetAt < now) {
    // Window expired or first request
    const newInfo: RateLimitInfo = {
      count: 1,
      resetAt: now + config.windowMs,
    };
    memoryStore.set(key, newInfo);
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetAt: newInfo.resetAt,
    };
  }

  // Increment counter
  info.count++;
  memoryStore.set(key, info);

  const allowed = info.count <= config.maxRequests;
  return {
    allowed,
    remaining: Math.max(0, config.maxRequests - info.count),
    resetAt: info.resetAt,
  };
}

/**
 * Check rate limit using KV store (persistent across workers)
 */
async function checkKvRateLimit(
  kv: KVNamespace,
  key: string,
  config: RateLimitConfig
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const now = Date.now();
  const kvKey = `ratelimit:${key}`;

  try {
    const stored = await kv.get(kvKey, 'json') as RateLimitInfo | null;

    if (!stored || stored.resetAt < now) {
      // Window expired or first request
      const newInfo: RateLimitInfo = {
        count: 1,
        resetAt: now + config.windowMs,
      };
      // Store with TTL slightly longer than window to auto-cleanup
      await kv.put(kvKey, JSON.stringify(newInfo), {
        expirationTtl: Math.ceil(config.windowMs / 1000) + 60,
      });
      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetAt: newInfo.resetAt,
      };
    }

    // Increment counter
    stored.count++;
    await kv.put(kvKey, JSON.stringify(stored), {
      expirationTtl: Math.ceil(config.windowMs / 1000) + 60,
    });

    const allowed = stored.count <= config.maxRequests;
    return {
      allowed,
      remaining: Math.max(0, config.maxRequests - stored.count),
      resetAt: stored.resetAt,
    };
  } catch (error) {
    console.error('KV rate limit error, falling back to memory:', error);
    return checkMemoryRateLimit(key, config);
  }
}

/**
 * Create rate limiting middleware
 */
export function rateLimit(customConfig?: Partial<RateLimitConfig>) {
  const config = { ...DEFAULT_CONFIG, ...customConfig };

  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    // Skip rate limiting if disabled or no env (testing)
    if (c.env?.DISABLE_RATE_LIMIT === 'true' || !c.env) {
      return next();
    }

    const key = config.keyGenerator ? config.keyGenerator(c) : getClientKey(c);
    const kv = c.env?.KEYS_KV;  // Reuse the same KV namespace

    let result: { allowed: boolean; remaining: number; resetAt: number };

    if (kv) {
      result = await checkKvRateLimit(kv, key, config);
    } else {
      result = checkMemoryRateLimit(key, config);
    }

    // Set rate limit headers
    c.header('X-RateLimit-Limit', config.maxRequests.toString());
    c.header('X-RateLimit-Remaining', result.remaining.toString());
    c.header('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000).toString());

    if (!result.allowed) {
      c.header('Retry-After', Math.ceil((result.resetAt - Date.now()) / 1000).toString());
      return c.json(
        {
          error: 'Rate limit exceeded',
          message: config.message,
          retry_after: Math.ceil((result.resetAt - Date.now()) / 1000),
        },
        429
      );
    }

    await next();
  };
}

/**
 * Rate limiter for expensive computation endpoints
 */
export function expensiveRateLimit() {
  return rateLimit(EXPENSIVE_ENDPOINTS_CONFIG);
}

/**
 * Rate limiter by API key (for future authenticated requests)
 */
export function apiKeyRateLimit(maxRequests: number = 1000) {
  return rateLimit({
    maxRequests,
    windowMs: 60 * 60 * 1000, // 1 hour
    keyGenerator: (c) => {
      const apiKey = c.req.header('X-API-Key') || c.req.query('api_key');
      if (apiKey) {
        return `apikey:${apiKey}`;
      }
      return getClientKey(c);
    },
  });
}

/**
 * Get rate limit key for authenticated or unauthenticated requests
 */
function getTieredKey(c: Context): string {
  const auth = c.get('auth') as AuthContext | null | undefined;
  if (auth?.user) {
    return `user:${auth.user.id}`;
  }
  return getClientKey(c);
}

/**
 * Tiered rate limiter for general requests
 * Uses auth context to apply appropriate limits per tier
 */
export function tieredRateLimit() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    // Skip rate limiting if disabled
    if (c.env?.DISABLE_RATE_LIMIT === 'true' || !c.env) {
      return next();
    }

    const auth = c.get('auth') as AuthContext | null | undefined;
    const limits: TierLimits = auth?.limits || TIER_LIMITS.free;

    const config: RateLimitConfig = {
      windowMs: 60 * 1000,  // 1 minute
      maxRequests: limits.requestsPerMinute,
      message: 'Too many requests, please try again later.',
    };

    const key = getTieredKey(c);
    const kv = c.env?.KEYS_KV;

    let result: { allowed: boolean; remaining: number; resetAt: number };

    if (kv) {
      result = await checkKvRateLimit(kv, key, config);
    } else {
      result = checkMemoryRateLimit(key, config);
    }

    // Set rate limit headers
    c.header('X-RateLimit-Limit', config.maxRequests.toString());
    c.header('X-RateLimit-Remaining', result.remaining.toString());
    c.header('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000).toString());

    if (!result.allowed) {
      c.header('Retry-After', Math.ceil((result.resetAt - Date.now()) / 1000).toString());
      return c.json(
        {
          error: 'Rate limit exceeded',
          message: config.message,
          retry_after: Math.ceil((result.resetAt - Date.now()) / 1000),
        },
        429
      );
    }

    await next();
  };
}

/**
 * Tiered rate limiter for expensive computation endpoints
 * Uses auth context to apply appropriate limits per tier
 */
export function tieredExpensiveRateLimit() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    // Skip rate limiting if disabled
    if (c.env?.DISABLE_RATE_LIMIT === 'true' || !c.env) {
      return next();
    }

    const auth = c.get('auth') as AuthContext | null | undefined;
    const limits: TierLimits = auth?.limits || TIER_LIMITS.free;

    const config: RateLimitConfig = {
      windowMs: 60 * 1000,  // 1 minute
      maxRequests: limits.expensivePerMinute,
      message: 'Rate limit exceeded for computation-heavy endpoint.',
    };

    const key = `expensive:${getTieredKey(c)}`;
    const kv = c.env?.KEYS_KV;

    let result: { allowed: boolean; remaining: number; resetAt: number };

    if (kv) {
      result = await checkKvRateLimit(kv, key, config);
    } else {
      result = checkMemoryRateLimit(key, config);
    }

    // Set rate limit headers (for expensive endpoint)
    c.header('X-RateLimit-Expensive-Limit', config.maxRequests.toString());
    c.header('X-RateLimit-Expensive-Remaining', result.remaining.toString());
    c.header('X-RateLimit-Expensive-Reset', Math.ceil(result.resetAt / 1000).toString());

    if (!result.allowed) {
      c.header('Retry-After', Math.ceil((result.resetAt - Date.now()) / 1000).toString());
      return c.json(
        {
          error: 'Rate limit exceeded',
          message: config.message,
          retry_after: Math.ceil((result.resetAt - Date.now()) / 1000),
        },
        429
      );
    }

    await next();
  };
}
