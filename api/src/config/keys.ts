/**
 * Key management for Ed25519 signing
 *
 * Keys are lazily initialized on first access to support
 * Cloudflare Workers (no random generation at global scope).
 */

import { generateKeyPair, publicKeyToBase64 } from '../crypto/signing.js';
import type { KeyPair } from '../crypto/signing.js';

interface SigningKeyInfo {
  keyId: string;
  publicKeyB64: string;
  keyPair: KeyPair;
}

// In-memory key store (in production, use secure key management)
let signingKeys: SigningKeyInfo[] | null = null;
let primaryKey: SigningKeyInfo | null = null;
let initialized = false;

/**
 * Ensure keys are initialized (lazy initialization)
 */
function ensureInitialized(): void {
  if (initialized) return;

  // Generate a primary signing key
  const keyPair = generateKeyPair('primary-v1');
  const info: SigningKeyInfo = {
    keyId: keyPair.keyId,
    publicKeyB64: publicKeyToBase64(keyPair.publicKey),
    keyPair,
  };

  signingKeys = [info];
  primaryKey = info;
  initialized = true;
}

/**
 * Get all signing keys (public info only)
 */
export function getSigningKeys(): { keyId: string; publicKeyB64: string }[] {
  ensureInitialized();
  return signingKeys!.map((k) => ({
    keyId: k.keyId,
    publicKeyB64: k.publicKeyB64,
  }));
}

/**
 * Get the primary signing key pair for signing responses
 */
export function getPrimaryKeyPair(): KeyPair | null {
  ensureInitialized();
  return primaryKey?.keyPair ?? null;
}

/**
 * Get a key pair by ID
 */
export function getKeyPairById(keyId: string): KeyPair | null {
  ensureInitialized();
  const info = signingKeys!.find((k) => k.keyId === keyId);
  return info?.keyPair ?? null;
}

/**
 * Get public key by ID (as Uint8Array)
 */
export function getPublicKeyById(keyId: string): Uint8Array | null {
  ensureInitialized();
  const info = signingKeys!.find((k) => k.keyId === keyId);
  return info?.keyPair.publicKey ?? null;
}
