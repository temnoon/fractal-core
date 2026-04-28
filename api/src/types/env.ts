/**
 * Cloudflare Workers environment bindings
 */

export interface Env {
  // KV namespace for persistent key storage (signing keys, rate limits)
  KEYS_KV?: KVNamespace;

  // KV namespace for user data, API keys, and usage records
  USERS_KV?: KVNamespace;

  // KV namespace for LPP data (nodes, repeaters, epochs)
  LPP_KV?: KVNamespace;

  // KV namespace for async job queue persistence
  JOBS_KV?: KVNamespace;

  // D1 database for LPP2 relational data (nodes, networks, conversations)
  LPP_DB?: D1Database;

  // Environment variables
  ENVIRONMENT?: string;

  // Rate limiting control
  DISABLE_RATE_LIMIT?: string;

  // Admin API key for privileged operations
  ADMIN_API_KEY?: string;
}
