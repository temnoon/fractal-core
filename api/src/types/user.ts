/**
 * User and API Key Type Definitions
 */

export type UserTier = 'free' | 'pro' | 'enterprise';

export interface TierLimits {
  cpuTimePerMonth: number;  // milliseconds, -1 for unlimited
  requestsPerMinute: number;
  expensivePerMinute: number;
  asyncJobs: number;
}

export const TIER_LIMITS: Record<UserTier, TierLimits> = {
  free: {
    cpuTimePerMonth: 5 * 60 * 1000,  // 5 minutes in ms
    requestsPerMinute: 100,
    expensivePerMinute: 20,
    asyncJobs: 5,
  },
  pro: {
    cpuTimePerMonth: -1,  // unlimited (pay-per-use)
    requestsPerMinute: 500,
    expensivePerMinute: 100,
    asyncJobs: 50,
  },
  enterprise: {
    cpuTimePerMonth: -1,  // custom
    requestsPerMinute: 2000,
    expensivePerMinute: 500,
    asyncJobs: 500,
  },
};

export interface User {
  id: string;
  email: string;
  tier: UserTier;
  created_at: string;  // ISO 8601
  updated_at: string;  // ISO 8601
  metadata?: Record<string, unknown>;
}

export type ApiKeyStatus = 'active' | 'revoked' | 'expired';

export interface ApiKey {
  key_hash: string;      // SHA-256 hash of the key
  key_prefix: string;    // First 8 chars for identification (e.g., "frc_a7B3")
  user_id: string;
  name?: string;         // Optional friendly name
  status: ApiKeyStatus;
  created_at: string;    // ISO 8601
  expires_at?: string;   // ISO 8601, optional expiration
  last_used_at?: string; // ISO 8601
}

export interface UsageRecord {
  user_id: string;
  period: string;        // YYYY-MM format
  cpu_time_ms: number;
  request_count: number;
  expensive_request_count: number;
  updated_at: string;    // ISO 8601
}

export interface AuthContext {
  user: User;
  apiKey: ApiKey;
  limits: TierLimits;
  usage: UsageRecord | null;
}

export interface GeneratedApiKey {
  key: string;        // Full key (only returned once at creation)
  hash: string;       // SHA-256 hash
  prefix: string;     // First 8 chars
}
