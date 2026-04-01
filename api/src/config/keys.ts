/**
 * Key management for Ed25519 signing
 *
 * Uses Workers KV for persistent key storage when available.
 * Falls back to ephemeral keys for local development.
 */

import { getOrCreateKeyPair, getKeyInfo, clearKeyCache } from '../services/key-manager.js';
import { publicKeyToBase64, generateKeyPair } from '../crypto/signing.js';
import type { KeyPair } from '../crypto/signing.js';

interface SigningKeyInfo {
  keyId: string;
  publicKeyB64: string;
  keyPair: KeyPair;
}

// In-memory key store for the current request
let signingKeys: SigningKeyInfo[] | null = null;
let primaryKey: SigningKeyInfo | null = null;
let currentKv: KVNamespace | undefined;

/**
 * Set the KV namespace for key storage
 * Call this at the start of each request with the env binding
 */
export function setKeyStorageKv(kv?: KVNamespace): void {
  currentKv = kv;
}

/**
 * Initialize keys (async version for KV support)
 */
async function ensureInitializedAsync(): Promise<void> {
  if (signingKeys !== null) return;

  const keyPair = await getOrCreateKeyPair(currentKv);
  const info: SigningKeyInfo = {
    keyId: keyPair.keyId,
    publicKeyB64: publicKeyToBase64(keyPair.publicKey),
    keyPair,
  };

  signingKeys = [info];
  primaryKey = info;
}

/**
 * Synchronous initialization (uses cached key or generates ephemeral)
 * For backwards compatibility with sync routes
 */
function ensureInitializedSync(): void {
  if (signingKeys !== null) return;

  // Generate ephemeral key pair (won't persist to KV)
  const keyId = `ephemeral-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
  const keyPair = generateKeyPair(keyId);

  const info: SigningKeyInfo = {
    keyId: keyPair.keyId,
    publicKeyB64: publicKeyToBase64(keyPair.publicKey),
    keyPair,
  };

  signingKeys = [info];
  primaryKey = info;
}

/**
 * Get all signing keys (public info only)
 * Async version that supports KV
 */
export async function getSigningKeysAsync(): Promise<{ keyId: string; publicKeyB64: string }[]> {
  await ensureInitializedAsync();
  return signingKeys!.map((k) => ({
    keyId: k.keyId,
    publicKeyB64: k.publicKeyB64,
  }));
}

/**
 * Get all signing keys (public info only)
 * Sync version for backwards compatibility
 */
export function getSigningKeys(): { keyId: string; publicKeyB64: string }[] {
  ensureInitializedSync();
  return signingKeys!.map((k) => ({
    keyId: k.keyId,
    publicKeyB64: k.publicKeyB64,
  }));
}

/**
 * Get the primary signing key pair for signing responses
 * Async version that supports KV
 */
export async function getPrimaryKeyPairAsync(): Promise<KeyPair | null> {
  await ensureInitializedAsync();
  return primaryKey?.keyPair ?? null;
}

/**
 * Get the primary signing key pair for signing responses
 * Sync version for backwards compatibility
 */
export function getPrimaryKeyPair(): KeyPair | null {
  ensureInitializedSync();
  return primaryKey?.keyPair ?? null;
}

/**
 * Get a key pair by ID
 */
export function getKeyPairById(keyId: string): KeyPair | null {
  ensureInitializedSync();
  const info = signingKeys!.find((k) => k.keyId === keyId);
  return info?.keyPair ?? null;
}

/**
 * Get public key by ID (as Uint8Array)
 */
export function getPublicKeyById(keyId: string): Uint8Array | null {
  ensureInitializedSync();
  const info = signingKeys!.find((k) => k.keyId === keyId);
  return info?.keyPair.publicKey ?? null;
}

/**
 * Reset keys (useful for testing or request isolation)
 */
export function resetKeys(): void {
  signingKeys = null;
  primaryKey = null;
  clearKeyCache();
}

/**
 * Get detailed key info including persistence status
 */
export async function getDetailedKeyInfo(): Promise<{
  key_id: string;
  public_key_b64: string;
  created_at?: string;
  persistent: boolean;
}> {
  return getKeyInfo(currentKv);
}
