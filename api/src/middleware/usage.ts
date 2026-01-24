/**
 * Usage Tracking and Limit Enforcement Middleware
 *
 * Tracks CPU time usage and enforces monthly limits per tier.
 */

import { Context, Next } from 'hono';
import type { Env } from '../types/env.js';
import type { AuthContext } from '../types/user.js';
import { trackUsage, hasExceededCpuLimit, getRemainingCpuTime, formatCpuTime } from '../services/usage-tracker.js';
import { TIER_LIMITS } from '../types/user.js';

/**
 * Check if user has exceeded their CPU time limit
 * Returns 429 if limit exceeded for free tier users
 */
export function cpuLimitCheck() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const auth = c.get('auth') as AuthContext | null;

    // No limit check for unauthenticated or unlimited tiers
    if (!auth) {
      return next();
    }

    const limits = auth.limits;
    if (limits.cpuTimePerMonth === -1) {
      // Unlimited tier
      return next();
    }

    // Check if limit exceeded
    if (hasExceededCpuLimit(auth.usage, limits)) {
      return c.json({
        error: 'CPU time limit exceeded',
        message: `Monthly CPU time limit of ${formatCpuTime(limits.cpuTimePerMonth)} exceeded. Upgrade to Pro for unlimited usage.`,
        tier: auth.user.tier,
        limit_ms: limits.cpuTimePerMonth,
        used_ms: auth.usage?.cpu_time_ms || 0,
      }, 429);
    }

    // Add remaining time header
    const remaining = getRemainingCpuTime(auth.usage, limits);
    c.header('X-CPU-Time-Remaining-Ms', remaining.toString());

    return next();
  };
}

/**
 * Track CPU time for a request
 * Call this after the request completes with the measured CPU time
 */
export async function recordUsage(
  c: Context<{ Bindings: Env }>,
  cpuTimeMs: number,
  isExpensive: boolean
): Promise<void> {
  const auth = c.get('auth') as AuthContext | null;
  const kv = c.env?.USERS_KV;

  // Only track for authenticated users with KV available
  if (!auth || !kv) {
    return;
  }

  try {
    await trackUsage(kv, {
      user_id: auth.user.id,
      cpu_time_ms: cpuTimeMs,
      is_expensive: isExpensive,
    });
  } catch (error) {
    // Log but don't fail the request
    console.error('Failed to record usage:', error);
  }
}

/**
 * Middleware that wraps request handling to measure and record CPU time
 * Use this on expensive endpoints
 *
 * Note: Uses performance.now() instead of Date.now() because Workers
 * freezes Date.now() during request execution for determinism.
 */
export function trackCpuTime(isExpensive: boolean = false) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const startTime = performance.now();

    await next();

    const cpuTimeMs = Math.round(performance.now() - startTime);

    // Record usage asynchronously (don't block response)
    const auth = c.get('auth') as AuthContext | null;
    const kv = c.env?.USERS_KV;

    if (auth && kv) {
      c.executionCtx?.waitUntil?.(
        trackUsage(kv, {
          user_id: auth.user.id,
          cpu_time_ms: cpuTimeMs,
          is_expensive: isExpensive,
        }).catch((err) => console.error('Failed to track usage:', err))
      );
    }

    // Add timing header
    c.header('X-CPU-Time-Ms', cpuTimeMs.toString());
  };
}
