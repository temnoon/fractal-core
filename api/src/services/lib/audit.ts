/**
 * Verbose audit logging for primality math (opt-in per request).
 *
 * Each computation step inside the engines can call `audit.log(event)` and the
 * event lands in the per-request log if the caller asked for one. By using
 * Node's AsyncLocalStorage (enabled in Workers via the nodejs_compat flag),
 * concurrent requests in the same isolate don't interleave events.
 *
 * Granularity is selectable so an 8K isPrime audit doesn't blow up the
 * payload with 8000+ Lucas-step events when the caller only wants milestones.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export type AuditCategory =
  | 'trial-division'
  | 'miller-rabin'
  | 'lucas'
  | 'wheel'
  | 'nextprime'
  | 'isprime'
  | 'lookup';

export type AuditLevel = 'milestone' | 'detail';

export interface AuditEvent {
  ts_ms: number;            // performance.now() snapshot (relative to request start)
  category: AuditCategory;
  level: AuditLevel;
  message: string;
  data?: Record<string, unknown>;
}

export interface AuditContext {
  enabled: boolean;
  level: AuditLevel;
  start: number;
  events: AuditEvent[];
  /** Optional cap on event count — drops further events but flags truncation. */
  maxEvents: number;
  truncated: boolean;
}

const storage = new AsyncLocalStorage<AuditContext>();

const DEFAULT_MAX_EVENTS = 5000;

/**
 * Run `fn` with an active audit context. Returns the events collected.
 * If `enabled=false`, this is a no-op shell that just runs `fn`.
 */
export async function withAudit<T>(
  options: { enabled: boolean; level?: AuditLevel; maxEvents?: number },
  fn: () => Promise<T> | T,
): Promise<{ result: T; events: AuditEvent[]; truncated: boolean }> {
  const ctx: AuditContext = {
    enabled: options.enabled,
    level: options.level ?? 'milestone',
    start: performance.now(),
    events: [],
    maxEvents: options.maxEvents ?? DEFAULT_MAX_EVENTS,
    truncated: false,
  };
  return storage.run(ctx, async () => {
    const result = await fn();
    return { result, events: ctx.events, truncated: ctx.truncated };
  });
}

/** Synchronous variant — same semantics, no Promise. */
export function withAuditSync<T>(
  options: { enabled: boolean; level?: AuditLevel; maxEvents?: number },
  fn: () => T,
): { result: T; events: AuditEvent[]; truncated: boolean } {
  const ctx: AuditContext = {
    enabled: options.enabled,
    level: options.level ?? 'milestone',
    start: performance.now(),
    events: [],
    maxEvents: options.maxEvents ?? DEFAULT_MAX_EVENTS,
    truncated: false,
  };
  return storage.run(ctx, () => {
    const result = fn();
    return { result, events: ctx.events, truncated: ctx.truncated };
  });
}

/** Engine-side: emit an event if a request is auditing. */
export function logAudit(
  category: AuditCategory,
  level: AuditLevel,
  message: string,
  data?: Record<string, unknown>,
): void {
  const ctx = storage.getStore();
  if (!ctx || !ctx.enabled) return;
  if (level === 'detail' && ctx.level !== 'detail') return;
  if (ctx.events.length >= ctx.maxEvents) {
    ctx.truncated = true;
    return;
  }
  ctx.events.push({
    ts_ms: Math.round((performance.now() - ctx.start) * 1000) / 1000,
    category,
    level,
    message,
    data,
  });
}

/** Quick helper for engines: only build the data object if auditing. */
export function ifAuditing(fn: () => void): void {
  const ctx = storage.getStore();
  if (ctx && ctx.enabled) fn();
}
