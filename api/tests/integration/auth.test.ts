/**
 * Integration tests for authentication and user management
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createApp } from '../../src/app.js';

describe('Authentication API', () => {
  const app = createApp();

  describe('GET /api/v1/capabilities', () => {
    it('returns free tier info when unauthenticated', async () => {
      const res = await app.request('/api/v1/capabilities');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.authenticated).toBe(false);
      expect(data.tier).toBe('free');
      expect(data.tier_limits).toBeDefined();
      expect(data.tier_limits.requests_per_minute).toBe(100);
      expect(data.tier_limits.expensive_per_minute).toBe(20);
      expect(data.tier_limits.async_jobs).toBe(5);
    });

    it('includes available tiers info', async () => {
      const res = await app.request('/api/v1/capabilities');
      const data = await res.json();

      expect(data.available_tiers).toBeDefined();
      expect(data.available_tiers.free).toBeDefined();
      expect(data.available_tiers.pro).toBeDefined();
      expect(data.available_tiers.enterprise).toBeDefined();
    });
  });

  describe('GET /api/v1/users/me', () => {
    it('returns 401 without authentication', async () => {
      const res = await app.request('/api/v1/users/me');
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toBe('Unauthorized');
      expect(data.message).toBe('API key required');
    });

    it('returns 401 with invalid API key', async () => {
      const res = await app.request('/api/v1/users/me', {
        headers: {
          'Authorization': 'Bearer frc_invalidkey12345678901234567890',
        },
      });
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('returns 401 with malformed API key', async () => {
      const res = await app.request('/api/v1/users/me', {
        headers: {
          'X-API-Key': 'not-a-valid-key-format',
        },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/users', () => {
    it('returns 403 without admin access', async () => {
      const res = await app.request('/api/v1/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'test@example.com',
          tier: 'free',
        }),
      });
      expect(res.status).toBe(403);

      const data = await res.json();
      expect(data.error).toBe('Forbidden');
      expect(data.message).toBe('Admin access required');
    });
  });

  describe('POST /api/v1/api-keys', () => {
    it('returns 401 without authentication', async () => {
      const res = await app.request('/api/v1/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'test-key' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/api-keys', () => {
    it('returns 401 without authentication', async () => {
      const res = await app.request('/api/v1/api-keys');
      expect(res.status).toBe(401);
    });
  });

  describe('Rate limit headers', () => {
    it('includes rate limit headers in response', async () => {
      const res = await app.request('/api/v1/status');
      expect(res.status).toBe(200);

      // Rate limit headers should be present
      expect(res.headers.get('X-RateLimit-Limit')).toBeDefined();
      expect(res.headers.get('X-RateLimit-Remaining')).toBeDefined();
      expect(res.headers.get('X-RateLimit-Reset')).toBeDefined();
    });
  });
});
