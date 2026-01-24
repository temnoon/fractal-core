/**
 * Zod validation schemas for user and API key operations
 */

import { z } from 'zod';
import type { UserTier } from '../types/user.js';

const UserTierSchema = z.enum(['free', 'pro', 'enterprise']);

const EmailSchema = z.string()
  .email('Invalid email format')
  .max(255, 'Email too long')
  .transform((val) => val.toLowerCase().trim());

/**
 * Schema for creating a new user
 */
export const CreateUserSchema = z.object({
  email: EmailSchema,
  tier: UserTierSchema.optional().default('free'),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;

/**
 * Schema for updating a user
 */
export const UpdateUserSchema = z.object({
  tier: UserTierSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

/**
 * Schema for creating a new API key
 */
export const CreateApiKeySchema = z.object({
  name: z.string().max(100, 'Name too long').optional(),
  expires_in_days: z.number().int().positive().max(365).optional(),
});

export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;

/**
 * API key format validation
 * Format: frc_<32 alphanumeric chars>
 */
export const ApiKeyFormatSchema = z.string()
  .regex(/^frc_[a-zA-Z0-9]{32}$/, 'Invalid API key format');

/**
 * Schema for API key prefix (for deletion)
 */
export const ApiKeyPrefixSchema = z.string()
  .regex(/^frc_[a-zA-Z0-9]{4}$/, 'Invalid API key prefix format');
