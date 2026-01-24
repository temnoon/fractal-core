/**
 * Authentication Middleware
 *
 * Extracts and validates API keys from request headers.
 * Sets auth context for downstream middleware and routes.
 */

import { Context, Next } from 'hono';
import type { Env } from '../types/env.js';
import type { AuthContext, TierLimits } from '../types/user.js';
import { TIER_LIMITS } from '../types/user.js';
import { validateApiKey, updateKeyLastUsed } from '../services/api-key-manager.js';
import { getUser } from '../services/user-manager.js';
import { getUsage } from '../services/usage-tracker.js';

// Extend Hono context variables
declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext | null;
    isAdmin: boolean;
  }
}

/**
 * Extract API key from request
 * Supports: Authorization: Bearer <key> or X-API-Key: <key>
 */
function extractApiKey(c: Context): string | null {
  // Try Authorization header first
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Try X-API-Key header
  const apiKeyHeader = c.req.header('X-API-Key');
  if (apiKeyHeader) {
    return apiKeyHeader;
  }

  return null;
}

/**
 * Check if request is from admin (using ADMIN_API_KEY)
 */
function checkAdminAccess(c: Context<{ Bindings: Env }>, key: string): boolean {
  const adminKey = c.env?.ADMIN_API_KEY;
  return adminKey !== undefined && adminKey === key;
}

/**
 * Authentication middleware
 *
 * - Extracts API key from headers
 * - Validates key against KV storage
 * - Loads user and sets auth context
 * - Gracefully handles unauthenticated requests (backward compatible)
 */
export function authMiddleware() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    // Initialize auth context as null (unauthenticated)
    c.set('auth', null);
    c.set('isAdmin', false);

    const kv = c.env?.USERS_KV;
    const apiKey = extractApiKey(c);

    // No API key provided - continue as unauthenticated
    if (!apiKey) {
      return next();
    }

    // Check for admin access first
    if (checkAdminAccess(c, apiKey)) {
      c.set('isAdmin', true);
      return next();
    }

    // No KV available - cannot validate keys
    if (!kv) {
      console.warn('USERS_KV not available, cannot validate API key');
      return next();
    }

    try {
      // Validate the API key
      const keyRecord = await validateApiKey(kv, apiKey);
      if (!keyRecord) {
        // Invalid key - return 401
        return c.json(
          {
            error: 'Unauthorized',
            message: 'Invalid or expired API key',
          },
          401
        );
      }

      // Load the user
      const user = await getUser(kv, keyRecord.user_id);
      if (!user) {
        console.error(`User not found for API key: ${keyRecord.key_prefix}***`);
        return c.json(
          {
            error: 'Unauthorized',
            message: 'User account not found',
          },
          401
        );
      }

      // Get current usage
      const usage = await getUsage(kv, user.id);

      // Get tier limits
      const limits: TierLimits = TIER_LIMITS[user.tier];

      // Set auth context
      const authContext: AuthContext = {
        user,
        apiKey: keyRecord,
        limits,
        usage,
      };

      c.set('auth', authContext);

      // Update last_used_at asynchronously (don't await)
      c.executionCtx?.waitUntil?.(updateKeyLastUsed(kv, keyRecord));

      return next();
    } catch (error) {
      console.error('Auth middleware error:', error);
      // On error, continue as unauthenticated rather than failing
      return next();
    }
  };
}

/**
 * Middleware to require authentication
 * Use this for endpoints that require a valid API key
 */
export function requireAuth() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const auth = c.get('auth');

    if (!auth) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'API key required',
        },
        401
      );
    }

    return next();
  };
}

/**
 * Middleware to require admin access
 * Use this for admin-only endpoints
 */
export function requireAdmin() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const isAdmin = c.get('isAdmin');

    if (!isAdmin) {
      return c.json(
        {
          error: 'Forbidden',
          message: 'Admin access required',
        },
        403
      );
    }

    return next();
  };
}

/**
 * Get tier limits for current request
 * Returns free tier limits if unauthenticated
 */
export function getRequestLimits(c: Context): TierLimits {
  const auth = c.get('auth');
  return auth?.limits || TIER_LIMITS.free;
}
