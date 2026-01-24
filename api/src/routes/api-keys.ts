/**
 * API Key Management Routes
 *
 * Endpoints for creating, listing, and revoking API keys.
 */

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import type { AuthContext, ApiKey } from '../types/user.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { CreateApiKeySchema, ApiKeyPrefixSchema } from '../schemas/user.js';
import {
  generateApiKey,
  storeApiKey,
  getUserApiKeys,
  findKeyByPrefix,
  revokeApiKey,
  removeKeyFromUserList,
  addKeyToUserList,
} from '../services/api-key-manager.js';
import { getUser } from '../services/user-manager.js';

export const apiKeysRoute = new Hono<{ Bindings: Env }>();

/**
 * POST /api/v1/api-keys
 * Create a new API key for the authenticated user
 * Returns the full key ONCE - it cannot be retrieved later
 */
apiKeysRoute.post('/', requireAuth(), async (c) => {
  const auth = c.get('auth') as AuthContext;
  const kv = c.env.USERS_KV!;

  // Parse request body (optional)
  let keyName: string | undefined;
  let expiresInDays: number | undefined;
  try {
    const body = await c.req.json();
    const result = CreateApiKeySchema.safeParse(body);
    if (result.success) {
      keyName = result.data.name;
      expiresInDays = result.data.expires_in_days;
    }
  } catch {
    // Empty body is allowed
  }

  // Generate the API key
  const generated = await generateApiKey();

  // Calculate expiration if specified
  let expires_at: string | undefined;
  if (expiresInDays) {
    const expireDate = new Date();
    expireDate.setDate(expireDate.getDate() + expiresInDays);
    expires_at = expireDate.toISOString();
  }

  // Create API key record
  const apiKey: ApiKey = {
    key_hash: generated.hash,
    key_prefix: generated.prefix,
    user_id: auth.user.id,
    name: keyName,
    status: 'active',
    created_at: new Date().toISOString(),
    expires_at,
  };

  // Store the key
  await storeApiKey(kv, apiKey);

  // Add to user's key list
  await addKeyToUserList(kv, auth.user.id, generated.hash);

  return c.json({
    message: 'API key created successfully',
    key: generated.key,  // Full key - shown only once!
    prefix: generated.prefix,
    name: apiKey.name,
    expires_at: apiKey.expires_at,
    warning: 'Save this key now. It cannot be retrieved later.',
  }, 201);
});

/**
 * GET /api/v1/api-keys
 * List all API keys for the authenticated user
 * Returns metadata only (prefix, name, status), not the actual keys
 */
apiKeysRoute.get('/', requireAuth(), async (c) => {
  const auth = c.get('auth') as AuthContext;
  const kv = c.env.USERS_KV!;

  const keys = await getUserApiKeys(kv, auth.user.id);

  return c.json({
    keys: keys.map((k) => ({
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
 * DELETE /api/v1/api-keys/:prefix
 * Revoke an API key by its prefix
 */
apiKeysRoute.delete('/:prefix', requireAuth(), async (c) => {
  const auth = c.get('auth') as AuthContext;
  const kv = c.env.USERS_KV!;

  const prefix = c.req.param('prefix');

  // Validate prefix format
  const result = ApiKeyPrefixSchema.safeParse(prefix);
  if (!result.success) {
    return c.json({
      error: 'Validation error',
      message: 'Invalid API key prefix format',
    }, 400);
  }

  // Find the key by prefix
  const apiKey = await findKeyByPrefix(kv, auth.user.id, prefix);

  if (!apiKey) {
    return c.json({
      error: 'Not found',
      message: 'API key not found',
    }, 404);
  }

  // Revoke the key
  await revokeApiKey(kv, apiKey.key_hash);

  // Remove from user's key list
  await removeKeyFromUserList(kv, auth.user.id, apiKey.key_hash);

  return c.json({
    message: 'API key revoked successfully',
    prefix: apiKey.key_prefix,
  });
});

/**
 * POST /api/v1/api-keys/admin/:user_id
 * Create an API key for a specific user (admin only)
 */
apiKeysRoute.post('/admin/:user_id', requireAdmin(), async (c) => {
  const kv = c.env.USERS_KV;
  if (!kv) {
    return c.json({ error: 'Service unavailable', message: 'User storage not configured' }, 503);
  }

  const userId = c.req.param('user_id');

  // Verify user exists
  const user = await getUser(kv, userId);
  if (!user) {
    return c.json({ error: 'Not found', message: 'User not found' }, 404);
  }

  // Parse request body (optional)
  let keyName: string | undefined;
  let expiresInDays: number | undefined;
  try {
    const body = await c.req.json();
    const result = CreateApiKeySchema.safeParse(body);
    if (result.success) {
      keyName = result.data.name;
      expiresInDays = result.data.expires_in_days;
    }
  } catch {
    // Empty body is allowed
  }

  // Generate the API key
  const generated = await generateApiKey();

  // Calculate expiration if specified
  let expires_at: string | undefined;
  if (expiresInDays) {
    const expireDate = new Date();
    expireDate.setDate(expireDate.getDate() + expiresInDays);
    expires_at = expireDate.toISOString();
  }

  // Create API key record
  const apiKey: ApiKey = {
    key_hash: generated.hash,
    key_prefix: generated.prefix,
    user_id: userId,
    name: keyName,
    status: 'active',
    created_at: new Date().toISOString(),
    expires_at,
  };

  // Store the key
  await storeApiKey(kv, apiKey);

  // Add to user's key list
  await addKeyToUserList(kv, userId, generated.hash);

  return c.json({
    message: 'API key created successfully',
    key: generated.key,  // Full key - shown only once!
    prefix: generated.prefix,
    user_id: userId,
    name: apiKey.name,
    expires_at: apiKey.expires_at,
    warning: 'Save this key now. It cannot be retrieved later.',
  }, 201);
});

/**
 * GET /api/v1/api-keys/admin/:user_id
 * List all API keys for a specific user (admin only)
 */
apiKeysRoute.get('/admin/:user_id', requireAdmin(), async (c) => {
  const kv = c.env.USERS_KV;
  if (!kv) {
    return c.json({ error: 'Service unavailable', message: 'User storage not configured' }, 503);
  }

  const userId = c.req.param('user_id');

  // Verify user exists
  const user = await getUser(kv, userId);
  if (!user) {
    return c.json({ error: 'Not found', message: 'User not found' }, 404);
  }

  const keys = await getUserApiKeys(kv, userId);

  return c.json({
    user_id: userId,
    keys: keys.map((k) => ({
      prefix: k.key_prefix,
      name: k.name,
      status: k.status,
      created_at: k.created_at,
      expires_at: k.expires_at,
      last_used_at: k.last_used_at,
    })),
  });
});
