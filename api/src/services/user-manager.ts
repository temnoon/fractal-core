/**
 * User Management Service
 *
 * Handles user CRUD operations with KV storage.
 */

import type { User, UserTier } from '../types/user.js';

/**
 * Generate a unique user ID
 */
function generateUserId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = crypto.getRandomValues(new Uint8Array(8));
  const random = Array.from(randomPart)
    .map(b => b.toString(36).padStart(2, '0'))
    .join('')
    .substring(0, 8);
  return `usr_${timestamp}${random}`;
}

/**
 * Create a new user
 */
export async function createUser(
  kv: KVNamespace,
  email: string,
  tier: UserTier = 'free',
  metadata?: Record<string, unknown>
): Promise<User> {
  // Check if email already exists
  const existingUserId = await getUserIdByEmail(kv, email);
  if (existingUserId) {
    throw new Error('User with this email already exists');
  }

  const now = new Date().toISOString();
  const user: User = {
    id: generateUserId(),
    email: email.toLowerCase().trim(),
    tier,
    created_at: now,
    updated_at: now,
    metadata,
  };

  // Store user document
  await kv.put(`user:${user.id}`, JSON.stringify(user));

  // Create email index
  await kv.put(`user_by_email:${user.email}`, user.id);

  return user;
}

/**
 * Get user by ID
 */
export async function getUser(
  kv: KVNamespace,
  userId: string
): Promise<User | null> {
  try {
    const user = await kv.get(`user:${userId}`, 'json') as User | null;
    return user;
  } catch (error) {
    console.error('Error getting user:', error);
    return null;
  }
}

/**
 * Get user ID by email (via index)
 */
export async function getUserIdByEmail(
  kv: KVNamespace,
  email: string
): Promise<string | null> {
  try {
    const userId = await kv.get(`user_by_email:${email.toLowerCase().trim()}`);
    return userId;
  } catch (error) {
    console.error('Error getting user by email:', error);
    return null;
  }
}

/**
 * Get user by email
 */
export async function getUserByEmail(
  kv: KVNamespace,
  email: string
): Promise<User | null> {
  const userId = await getUserIdByEmail(kv, email);
  if (!userId) {
    return null;
  }
  return getUser(kv, userId);
}

/**
 * Update user
 */
export async function updateUser(
  kv: KVNamespace,
  userId: string,
  updates: Partial<Pick<User, 'tier' | 'metadata'>>
): Promise<User | null> {
  const user = await getUser(kv, userId);
  if (!user) {
    return null;
  }

  const updatedUser: User = {
    ...user,
    ...updates,
    updated_at: new Date().toISOString(),
  };

  await kv.put(`user:${userId}`, JSON.stringify(updatedUser));
  return updatedUser;
}

/**
 * Delete user (and associated data)
 */
export async function deleteUser(
  kv: KVNamespace,
  userId: string
): Promise<boolean> {
  const user = await getUser(kv, userId);
  if (!user) {
    return false;
  }

  // Delete user document
  await kv.delete(`user:${userId}`);

  // Delete email index
  await kv.delete(`user_by_email:${user.email}`);

  // Note: API keys and usage records should be cleaned up separately
  // or handled by KV TTL auto-expiration

  return true;
}

/**
 * Check if user exists
 */
export async function userExists(
  kv: KVNamespace,
  userId: string
): Promise<boolean> {
  const user = await getUser(kv, userId);
  return user !== null;
}
