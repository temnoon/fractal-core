/**
 * Usage Tracking Service
 *
 * Tracks CPU time and request counts for billing and rate limiting.
 */

import type { UsageRecord, TierLimits, UserTier } from '../types/user.js';
import { TIER_LIMITS } from '../types/user.js';

/**
 * Get current billing period in YYYY-MM format
 */
export function getCurrentPeriod(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Get usage record for a user in a specific period
 */
export async function getUsage(
  kv: KVNamespace,
  userId: string,
  period?: string
): Promise<UsageRecord | null> {
  const usagePeriod = period || getCurrentPeriod();
  const kvKey = `usage:${userId}:${usagePeriod}`;

  try {
    const record = await kv.get(kvKey, 'json') as UsageRecord | null;
    return record;
  } catch (error) {
    console.error('Error getting usage:', error);
    return null;
  }
}

/**
 * Track usage for a request
 */
export async function trackUsage(
  kv: KVNamespace,
  params: {
    user_id: string;
    cpu_time_ms: number;
    is_expensive: boolean;
  }
): Promise<UsageRecord> {
  const period = getCurrentPeriod();
  const kvKey = `usage:${params.user_id}:${period}`;

  // Get existing record or create new one
  let record = await getUsage(kv, params.user_id, period);

  if (!record) {
    record = {
      user_id: params.user_id,
      period,
      cpu_time_ms: 0,
      request_count: 0,
      expensive_request_count: 0,
      updated_at: new Date().toISOString(),
    };
  }

  // Update counters
  record.cpu_time_ms += params.cpu_time_ms;
  record.request_count += 1;
  if (params.is_expensive) {
    record.expensive_request_count += 1;
  }
  record.updated_at = new Date().toISOString();

  // Store with TTL of 90 days (covers current + 2 previous months)
  await kv.put(kvKey, JSON.stringify(record), {
    expirationTtl: 90 * 24 * 60 * 60,  // 90 days in seconds
  });

  return record;
}

/**
 * Check if user has exceeded their CPU time limit
 */
export function hasExceededCpuLimit(
  usage: UsageRecord | null,
  limits: TierLimits
): boolean {
  if (limits.cpuTimePerMonth === -1) {
    return false;  // Unlimited
  }

  if (!usage) {
    return false;  // No usage yet
  }

  return usage.cpu_time_ms >= limits.cpuTimePerMonth;
}

/**
 * Get remaining CPU time for user
 */
export function getRemainingCpuTime(
  usage: UsageRecord | null,
  limits: TierLimits
): number {
  if (limits.cpuTimePerMonth === -1) {
    return -1;  // Unlimited
  }

  const used = usage?.cpu_time_ms || 0;
  return Math.max(0, limits.cpuTimePerMonth - used);
}

/**
 * Format CPU time for display
 */
export function formatCpuTime(ms: number): string {
  if (ms < 0) {
    return 'unlimited';
  }

  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Get usage summary for display
 */
export interface UsageSummary {
  period: string;
  cpu_time_used: string;
  cpu_time_remaining: string;
  request_count: number;
  expensive_request_count: number;
  limit_exceeded: boolean;
}

export function getUsageSummary(
  usage: UsageRecord | null,
  tier: UserTier
): UsageSummary {
  const limits = TIER_LIMITS[tier];
  const period = usage?.period || getCurrentPeriod();

  return {
    period,
    cpu_time_used: formatCpuTime(usage?.cpu_time_ms || 0),
    cpu_time_remaining: formatCpuTime(getRemainingCpuTime(usage, limits)),
    request_count: usage?.request_count || 0,
    expensive_request_count: usage?.expensive_request_count || 0,
    limit_exceeded: hasExceededCpuLimit(usage, limits),
  };
}

/**
 * Get historical usage for multiple periods
 */
export async function getHistoricalUsage(
  kv: KVNamespace,
  userId: string,
  monthsBack: number = 3
): Promise<UsageRecord[]> {
  const records: UsageRecord[] = [];
  const now = new Date();

  for (let i = 0; i < monthsBack; i++) {
    const date = new Date(now.getUTCFullYear(), now.getUTCMonth() - i, 1);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const period = `${year}-${month}`;

    const record = await getUsage(kv, userId, period);
    if (record) {
      records.push(record);
    }
  }

  return records;
}
