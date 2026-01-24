/**
 * API Key Management Service
 *
 * Handles generation, hashing, and validation of API keys.
 * Keys are stored as SHA-256 hashes for security.
 */

import type { ApiKey, GeneratedApiKey } from '../types/user.js';

const API_KEY_PREFIX = 'frc_';
const KEY_LENGTH = 32;  // Characters after prefix
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Generate cryptographically secure random string
 */
function generateSecureRandom(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += ALPHABET[array[i] % ALPHABET.length];
  }
  return result;
}

/**
 * Hash an API key using SHA-256
 */
export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a new API key
 * Returns the full key (shown once), its hash, and prefix
 */
export async function generateApiKey(): Promise<GeneratedApiKey> {
  const randomPart = generateSecureRandom(KEY_LENGTH);
  const key = `${API_KEY_PREFIX}${randomPart}`;
  const hash = await hashApiKey(key);
  const prefix = key.substring(0, 8);  // "frc_" + first 4 random chars

  return { key, hash, prefix };
}

/**
 * Extract prefix from a full API key
 */
export function getKeyPrefix(key: string): string {
  return key.substring(0, 8);
}

/**
 * Validate API key format
 */
export function isValidKeyFormat(key: string): boolean {
  return /^frc_[a-zA-Z0-9]{32}$/.test(key);
}

/**
 * Check if API key is expired
 */
export function isKeyExpired(apiKey: ApiKey): boolean {
  if (!apiKey.expires_at) return false;
  return new Date(apiKey.expires_at) < new Date();
}

/**
 * Validate and lookup an API key from KV storage
 * Returns the ApiKey record if valid, null otherwise
 */
export async function validateApiKey(
  kv: KVNamespace,
  key: string
): Promise<ApiKey | null> {
  // Check format
  if (!isValidKeyFormat(key)) {
    return null;
  }

  // Hash the key to look up
  const keyHash = await hashApiKey(key);
  const kvKey = `apikey:${keyHash}`;

  try {
    const stored = await kv.get(kvKey, 'json') as ApiKey | null;

    if (!stored) {
      return null;
    }

    // Check status
    if (stored.status !== 'active') {
      return null;
    }

    // Check expiration
    if (isKeyExpired(stored)) {
      return null;
    }

    return stored;
  } catch (error) {
    console.error('Error validating API key:', error);
    return null;
  }
}

/**
 * Store a new API key in KV
 */
export async function storeApiKey(
  kv: KVNamespace,
  apiKey: ApiKey
): Promise<void> {
  const kvKey = `apikey:${apiKey.key_hash}`;

  // Calculate TTL if key has expiration
  const options: KVNamespacePutOptions = {};
  if (apiKey.expires_at) {
    const expiresAt = new Date(apiKey.expires_at).getTime();
    const now = Date.now();
    const ttlSeconds = Math.ceil((expiresAt - now) / 1000);
    if (ttlSeconds > 0) {
      options.expirationTtl = ttlSeconds;
    }
  }

  await kv.put(kvKey, JSON.stringify(apiKey), options);
}

/**
 * Update API key's last_used_at timestamp
 */
export async function updateKeyLastUsed(
  kv: KVNamespace,
  apiKey: ApiKey
): Promise<void> {
  const updatedKey: ApiKey = {
    ...apiKey,
    last_used_at: new Date().toISOString(),
  };
  await storeApiKey(kv, updatedKey);
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(
  kv: KVNamespace,
  keyHash: string
): Promise<boolean> {
  const kvKey = `apikey:${keyHash}`;

  try {
    const stored = await kv.get(kvKey, 'json') as ApiKey | null;
    if (!stored) {
      return false;
    }

    const revokedKey: ApiKey = {
      ...stored,
      status: 'revoked',
    };

    await kv.put(kvKey, JSON.stringify(revokedKey));
    return true;
  } catch (error) {
    console.error('Error revoking API key:', error);
    return false;
  }
}

/**
 * Get all API keys for a user (metadata only, not hashes for security)
 */
export async function getUserApiKeys(
  kv: KVNamespace,
  userId: string
): Promise<Omit<ApiKey, 'key_hash'>[]> {
  const listKey = `user_keys:${userId}`;

  try {
    const keyHashes = await kv.get(listKey, 'json') as string[] | null;
    if (!keyHashes || keyHashes.length === 0) {
      return [];
    }

    const keys: Omit<ApiKey, 'key_hash'>[] = [];
    for (const hash of keyHashes) {
      const apiKey = await kv.get(`apikey:${hash}`, 'json') as ApiKey | null;
      if (apiKey) {
        // Don't expose the hash
        const { key_hash, ...rest } = apiKey;
        keys.push(rest);
      }
    }

    return keys;
  } catch (error) {
    console.error('Error getting user API keys:', error);
    return [];
  }
}

/**
 * Add key hash to user's key list
 */
export async function addKeyToUserList(
  kv: KVNamespace,
  userId: string,
  keyHash: string
): Promise<void> {
  const listKey = `user_keys:${userId}`;

  const existing = await kv.get(listKey, 'json') as string[] | null;
  const keyHashes = existing || [];

  if (!keyHashes.includes(keyHash)) {
    keyHashes.push(keyHash);
    await kv.put(listKey, JSON.stringify(keyHashes));
  }
}

/**
 * Find API key by prefix for a specific user
 */
export async function findKeyByPrefix(
  kv: KVNamespace,
  userId: string,
  prefix: string
): Promise<ApiKey | null> {
  const listKey = `user_keys:${userId}`;

  try {
    const keyHashes = await kv.get(listKey, 'json') as string[] | null;
    if (!keyHashes) {
      return null;
    }

    for (const hash of keyHashes) {
      const apiKey = await kv.get(`apikey:${hash}`, 'json') as ApiKey | null;
      if (apiKey && apiKey.key_prefix === prefix) {
        return apiKey;
      }
    }

    return null;
  } catch (error) {
    console.error('Error finding key by prefix:', error);
    return null;
  }
}

/**
 * Remove key hash from user's key list
 */
export async function removeKeyFromUserList(
  kv: KVNamespace,
  userId: string,
  keyHash: string
): Promise<void> {
  const listKey = `user_keys:${userId}`;

  const existing = await kv.get(listKey, 'json') as string[] | null;
  if (!existing) return;

  const updated = existing.filter(h => h !== keyHash);
  await kv.put(listKey, JSON.stringify(updated));
}
