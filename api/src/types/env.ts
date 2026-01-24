/**
 * Cloudflare Workers environment bindings
 */

export interface Env {
  // KV namespace for persistent key storage (signing keys, rate limits)
  KEYS_KV?: KVNamespace;

  // KV namespace for user data, API keys, and usage records
  USERS_KV?: KVNamespace;

  // Environment variables
  ENVIRONMENT?: string;

  // Rate limiting control
  DISABLE_RATE_LIMIT?: string;

  // Admin API key for privileged operations
  ADMIN_API_KEY?: string;
}
