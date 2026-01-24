/**
 * User Management Routes
 *
 * Endpoints for user information and management.
 */

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import type { AuthContext } from '../types/user.js';
import { TIER_LIMITS } from '../types/user.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { CreateUserSchema, UpdateUserSchema } from '../schemas/user.js';
import { createUser, getUser, getUserByEmail, updateUser, deleteUser } from '../services/user-manager.js';
import { getUsage, getUsageSummary, getHistoricalUsage } from '../services/usage-tracker.js';
import { getUserApiKeys } from '../services/api-key-manager.js';

export const usersRoute = new Hono<{ Bindings: Env }>();

/**
 * GET /api/v1/users/me
 * Get current user info + usage
 * Requires authentication
 */
usersRoute.get('/me', requireAuth(), async (c) => {
  const auth = c.get('auth') as AuthContext;
  const kv = c.env.USERS_KV!;

  // Get fresh usage data
  const usage = await getUsage(kv, auth.user.id);
  const usageSummary = getUsageSummary(usage, auth.user.tier);

  // Get API keys (without hashes)
  const apiKeys = await getUserApiKeys(kv, auth.user.id);

  return c.json({
    user: {
      id: auth.user.id,
      email: auth.user.email,
      tier: auth.user.tier,
      created_at: auth.user.created_at,
    },
    limits: auth.limits,
    usage: usageSummary,
    api_keys: apiKeys.map((k) => ({
      prefix: k.key_prefix,
      name: k.name,
      status: k.status,
      created_at: k.created_at,
      expires_at: k.expires_at,
      last_used_at: k.last_used_at,
    })),
  });
});

/**
 * GET /api/v1/users/me/usage
 * Get detailed usage history
 * Requires authentication
 */
usersRoute.get('/me/usage', requireAuth(), async (c) => {
  const auth = c.get('auth') as AuthContext;
  const kv = c.env.USERS_KV!;

  const monthsBack = parseInt(c.req.query('months') || '3', 10);
  const history = await getHistoricalUsage(kv, auth.user.id, Math.min(monthsBack, 12));

  return c.json({
    user_id: auth.user.id,
    tier: auth.user.tier,
    limits: auth.limits,
    history: history.map((record) => ({
      period: record.period,
      cpu_time_ms: record.cpu_time_ms,
      request_count: record.request_count,
      expensive_request_count: record.expensive_request_count,
    })),
  });
});

/**
 * POST /api/v1/users
 * Create a new user
 * Requires admin authentication
 */
usersRoute.post('/', requireAdmin(), async (c) => {
  const kv = c.env.USERS_KV;
  if (!kv) {
    return c.json({ error: 'Service unavailable', message: 'User storage not configured' }, 503);
  }

  // Parse and validate request body
  const body = await c.req.json();
  const result = CreateUserSchema.safeParse(body);

  if (!result.success) {
    return c.json({
      error: 'Validation error',
      message: result.error.issues.map((i) => i.message).join(', '),
    }, 400);
  }

  try {
    const user = await createUser(kv, result.data.email, result.data.tier, result.data.metadata);

    return c.json({
      message: 'User created successfully',
      user: {
        id: user.id,
        email: user.email,
        tier: user.tier,
        created_at: user.created_at,
      },
    }, 201);
  } catch (error) {
    if (error instanceof Error && error.message.includes('already exists')) {
      return c.json({ error: 'Conflict', message: error.message }, 409);
    }
    throw error;
  }
});

/**
 * GET /api/v1/users/:id
 * Get user by ID
 * Requires admin authentication
 */
usersRoute.get('/:id', requireAdmin(), async (c) => {
  const kv = c.env.USERS_KV;
  if (!kv) {
    return c.json({ error: 'Service unavailable', message: 'User storage not configured' }, 503);
  }

  const userId = c.req.param('id');
  const user = await getUser(kv, userId);

  if (!user) {
    return c.json({ error: 'Not found', message: 'User not found' }, 404);
  }

  const usage = await getUsage(kv, userId);
  const usageSummary = getUsageSummary(usage, user.tier);

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      tier: user.tier,
      created_at: user.created_at,
      updated_at: user.updated_at,
      metadata: user.metadata,
    },
    limits: TIER_LIMITS[user.tier],
    usage: usageSummary,
  });
});

/**
 * PATCH /api/v1/users/:id
 * Update user
 * Requires admin authentication
 */
usersRoute.patch('/:id', requireAdmin(), async (c) => {
  const kv = c.env.USERS_KV;
  if (!kv) {
    return c.json({ error: 'Service unavailable', message: 'User storage not configured' }, 503);
  }

  const userId = c.req.param('id');

  // Parse and validate request body
  const body = await c.req.json();
  const result = UpdateUserSchema.safeParse(body);

  if (!result.success) {
    return c.json({
      error: 'Validation error',
      message: result.error.issues.map((i) => i.message).join(', '),
    }, 400);
  }

  const user = await updateUser(kv, userId, result.data);

  if (!user) {
    return c.json({ error: 'Not found', message: 'User not found' }, 404);
  }

  return c.json({
    message: 'User updated successfully',
    user: {
      id: user.id,
      email: user.email,
      tier: user.tier,
      updated_at: user.updated_at,
    },
  });
});

/**
 * DELETE /api/v1/users/:id
 * Delete user
 * Requires admin authentication
 */
usersRoute.delete('/:id', requireAdmin(), async (c) => {
  const kv = c.env.USERS_KV;
  if (!kv) {
    return c.json({ error: 'Service unavailable', message: 'User storage not configured' }, 503);
  }

  const userId = c.req.param('id');
  const deleted = await deleteUser(kv, userId);

  if (!deleted) {
    return c.json({ error: 'Not found', message: 'User not found' }, 404);
  }

  return c.json({ message: 'User deleted successfully' });
});

/**
 * GET /api/v1/users/by-email/:email
 * Get user by email
 * Requires admin authentication
 */
usersRoute.get('/by-email/:email', requireAdmin(), async (c) => {
  const kv = c.env.USERS_KV;
  if (!kv) {
    return c.json({ error: 'Service unavailable', message: 'User storage not configured' }, 503);
  }

  const email = c.req.param('email');
  const user = await getUserByEmail(kv, email);

  if (!user) {
    return c.json({ error: 'Not found', message: 'User not found' }, 404);
  }

  const usage = await getUsage(kv, user.id);
  const usageSummary = getUsageSummary(usage, user.tier);

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      tier: user.tier,
      created_at: user.created_at,
      updated_at: user.updated_at,
    },
    limits: TIER_LIMITS[user.tier],
    usage: usageSummary,
  });
});
