/**
 * Tests for API Key Manager
 */

import { describe, it, expect } from 'vitest';
import {
  hashApiKey,
  generateApiKey,
  getKeyPrefix,
  isValidKeyFormat,
  isKeyExpired,
} from '../../src/services/api-key-manager.js';
import type { ApiKey } from '../../src/types/user.js';

describe('API Key Manager', () => {
  describe('generateApiKey', () => {
    it('generates key with correct format', async () => {
      const result = await generateApiKey();

      expect(result.key).toMatch(/^frc_[a-zA-Z0-9]{32}$/);
      expect(result.prefix).toBe(result.key.substring(0, 8));
      expect(result.hash).toHaveLength(64); // SHA-256 hex
    });

    it('generates unique keys', async () => {
      const key1 = await generateApiKey();
      const key2 = await generateApiKey();

      expect(key1.key).not.toBe(key2.key);
      expect(key1.hash).not.toBe(key2.hash);
    });
  });

  describe('hashApiKey', () => {
    it('produces consistent hash for same key', async () => {
      const key = 'frc_abcdefghijklmnopqrstuvwxyz123456';
      const hash1 = await hashApiKey(key);
      const hash2 = await hashApiKey(key);

      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different keys', async () => {
      const hash1 = await hashApiKey('frc_abcdefghijklmnopqrstuvwxyz123456');
      const hash2 = await hashApiKey('frc_zyxwvutsrqponmlkjihgfedcba654321');

      expect(hash1).not.toBe(hash2);
    });

    it('returns 64-character hex string', async () => {
      const hash = await hashApiKey('frc_test1234567890abcdefghijklmnop');

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('getKeyPrefix', () => {
    it('extracts first 8 characters', () => {
      const key = 'frc_abcdefghijklmnopqrstuvwxyz123456';
      expect(getKeyPrefix(key)).toBe('frc_abcd');
    });
  });

  describe('isValidKeyFormat', () => {
    it('accepts valid key format', () => {
      expect(isValidKeyFormat('frc_abcdefghijklmnopqrstuvwxyz123456')).toBe(true);
      expect(isValidKeyFormat('frc_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456')).toBe(true);
      expect(isValidKeyFormat('frc_aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV')).toBe(true);
    });

    it('rejects invalid formats', () => {
      // Wrong prefix
      expect(isValidKeyFormat('abc_abcdefghijklmnopqrstuvwxyz123456')).toBe(false);
      // Too short
      expect(isValidKeyFormat('frc_abc')).toBe(false);
      // Too long
      expect(isValidKeyFormat('frc_abcdefghijklmnopqrstuvwxyz1234567')).toBe(false);
      // Invalid characters
      expect(isValidKeyFormat('frc_abcdefghijklmnopqrstuvwxyz12345!')).toBe(false);
      // No prefix
      expect(isValidKeyFormat('abcdefghijklmnopqrstuvwxyz12345678')).toBe(false);
    });
  });

  describe('isKeyExpired', () => {
    it('returns false for key without expiration', () => {
      const apiKey: ApiKey = {
        key_hash: 'abc123',
        key_prefix: 'frc_abcd',
        user_id: 'usr_123',
        status: 'active',
        created_at: new Date().toISOString(),
      };

      expect(isKeyExpired(apiKey)).toBe(false);
    });

    it('returns false for key with future expiration', () => {
      const future = new Date();
      future.setDate(future.getDate() + 30);

      const apiKey: ApiKey = {
        key_hash: 'abc123',
        key_prefix: 'frc_abcd',
        user_id: 'usr_123',
        status: 'active',
        created_at: new Date().toISOString(),
        expires_at: future.toISOString(),
      };

      expect(isKeyExpired(apiKey)).toBe(false);
    });

    it('returns true for key with past expiration', () => {
      const past = new Date();
      past.setDate(past.getDate() - 1);

      const apiKey: ApiKey = {
        key_hash: 'abc123',
        key_prefix: 'frc_abcd',
        user_id: 'usr_123',
        status: 'active',
        created_at: new Date().toISOString(),
        expires_at: past.toISOString(),
      };

      expect(isKeyExpired(apiKey)).toBe(true);
    });
  });
});
