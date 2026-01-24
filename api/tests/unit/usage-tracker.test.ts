/**
 * Tests for Usage Tracker
 */

import { describe, it, expect } from 'vitest';
import {
  getCurrentPeriod,
  hasExceededCpuLimit,
  getRemainingCpuTime,
  formatCpuTime,
  getUsageSummary,
} from '../../src/services/usage-tracker.js';
import type { UsageRecord, TierLimits } from '../../src/types/user.js';
import { TIER_LIMITS } from '../../src/types/user.js';

describe('Usage Tracker', () => {
  describe('getCurrentPeriod', () => {
    it('returns YYYY-MM format', () => {
      const period = getCurrentPeriod();
      expect(period).toMatch(/^\d{4}-\d{2}$/);
    });
  });

  describe('hasExceededCpuLimit', () => {
    const freeLimits = TIER_LIMITS.free;

    it('returns false for null usage', () => {
      expect(hasExceededCpuLimit(null, freeLimits)).toBe(false);
    });

    it('returns false when under limit', () => {
      const usage: UsageRecord = {
        user_id: 'usr_123',
        period: '2024-01',
        cpu_time_ms: 60000, // 1 minute
        request_count: 100,
        expensive_request_count: 10,
        updated_at: new Date().toISOString(),
      };

      expect(hasExceededCpuLimit(usage, freeLimits)).toBe(false);
    });

    it('returns true when at limit', () => {
      const usage: UsageRecord = {
        user_id: 'usr_123',
        period: '2024-01',
        cpu_time_ms: 5 * 60 * 1000, // exactly 5 minutes
        request_count: 100,
        expensive_request_count: 10,
        updated_at: new Date().toISOString(),
      };

      expect(hasExceededCpuLimit(usage, freeLimits)).toBe(true);
    });

    it('returns true when over limit', () => {
      const usage: UsageRecord = {
        user_id: 'usr_123',
        period: '2024-01',
        cpu_time_ms: 10 * 60 * 1000, // 10 minutes
        request_count: 100,
        expensive_request_count: 10,
        updated_at: new Date().toISOString(),
      };

      expect(hasExceededCpuLimit(usage, freeLimits)).toBe(true);
    });

    it('returns false for unlimited tier', () => {
      const proLimits = TIER_LIMITS.pro;
      const usage: UsageRecord = {
        user_id: 'usr_123',
        period: '2024-01',
        cpu_time_ms: 100 * 60 * 1000, // 100 minutes
        request_count: 10000,
        expensive_request_count: 1000,
        updated_at: new Date().toISOString(),
      };

      expect(hasExceededCpuLimit(usage, proLimits)).toBe(false);
    });
  });

  describe('getRemainingCpuTime', () => {
    const freeLimits = TIER_LIMITS.free;

    it('returns full limit for null usage', () => {
      expect(getRemainingCpuTime(null, freeLimits)).toBe(5 * 60 * 1000);
    });

    it('returns remaining time', () => {
      const usage: UsageRecord = {
        user_id: 'usr_123',
        period: '2024-01',
        cpu_time_ms: 2 * 60 * 1000, // 2 minutes used
        request_count: 50,
        expensive_request_count: 5,
        updated_at: new Date().toISOString(),
      };

      expect(getRemainingCpuTime(usage, freeLimits)).toBe(3 * 60 * 1000); // 3 minutes remaining
    });

    it('returns 0 when over limit', () => {
      const usage: UsageRecord = {
        user_id: 'usr_123',
        period: '2024-01',
        cpu_time_ms: 10 * 60 * 1000, // 10 minutes (over 5 min limit)
        request_count: 100,
        expensive_request_count: 10,
        updated_at: new Date().toISOString(),
      };

      expect(getRemainingCpuTime(usage, freeLimits)).toBe(0);
    });

    it('returns -1 for unlimited tier', () => {
      const proLimits = TIER_LIMITS.pro;
      expect(getRemainingCpuTime(null, proLimits)).toBe(-1);
    });
  });

  describe('formatCpuTime', () => {
    it('formats milliseconds', () => {
      expect(formatCpuTime(500)).toBe('500ms');
    });

    it('formats seconds', () => {
      expect(formatCpuTime(5000)).toBe('5s');
      expect(formatCpuTime(45000)).toBe('45s');
    });

    it('formats minutes', () => {
      expect(formatCpuTime(60000)).toBe('1m');
      expect(formatCpuTime(120000)).toBe('2m');
    });

    it('formats minutes and seconds', () => {
      expect(formatCpuTime(90000)).toBe('1m 30s');
      expect(formatCpuTime(185000)).toBe('3m 5s');
    });

    it('formats unlimited as string', () => {
      expect(formatCpuTime(-1)).toBe('unlimited');
    });
  });

  describe('getUsageSummary', () => {
    it('returns summary for null usage', () => {
      const summary = getUsageSummary(null, 'free');

      expect(summary.cpu_time_used).toBe('0ms');
      expect(summary.cpu_time_remaining).toBe('5m');
      expect(summary.request_count).toBe(0);
      expect(summary.expensive_request_count).toBe(0);
      expect(summary.limit_exceeded).toBe(false);
    });

    it('returns summary with usage data', () => {
      const usage: UsageRecord = {
        user_id: 'usr_123',
        period: '2024-01',
        cpu_time_ms: 120000, // 2 minutes
        request_count: 500,
        expensive_request_count: 50,
        updated_at: new Date().toISOString(),
      };

      const summary = getUsageSummary(usage, 'free');

      expect(summary.period).toBe('2024-01');
      expect(summary.cpu_time_used).toBe('2m');
      expect(summary.cpu_time_remaining).toBe('3m');
      expect(summary.request_count).toBe(500);
      expect(summary.expensive_request_count).toBe(50);
      expect(summary.limit_exceeded).toBe(false);
    });

    it('shows unlimited for pro tier', () => {
      const summary = getUsageSummary(null, 'pro');

      expect(summary.cpu_time_remaining).toBe('unlimited');
      expect(summary.limit_exceeded).toBe(false);
    });
  });
});
