/**
 * Key management for Ed25519 signing
 */

import { generateKeyPair, publicKeyToBase64, keyPairFromSecret } from '../crypto/signing.js';
import type { KeyPair } from '../crypto/signing.js';

interface SigningKeyInfo {
  keyId: string;
  publicKeyB64: string;
  keyPair: KeyPair;
}

// In-memory key store (in production, use secure key management)
let signingKeys: SigningKeyInfo[] = [];
let primaryKey: SigningKeyInfo | null = null;

/**
 * Initialize signing keys
 * In production, load from secure storage
 */
export function initializeKeys(): void {
  // Generate a primary signing key
  const keyPair = generateKeyPair('primary-v1');
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
 */
export function getSigningKeys(): { keyId: string; publicKeyB64: string }[] {
  return signingKeys.map((k) => ({
    keyId: k.keyId,
    publicKeyB64: k.publicKeyB64,
  }));
}

/**
 * Get the primary signing key pair for signing responses
 */
export function getPrimaryKeyPair(): KeyPair | null {
  return primaryKey?.keyPair ?? null;
}

/**
 * Get a key pair by ID
 */
export function getKeyPairById(keyId: string): KeyPair | null {
  const info = signingKeys.find((k) => k.keyId === keyId);
  return info?.keyPair ?? null;
}

/**
 * Get public key by ID (as Uint8Array)
 */
export function getPublicKeyById(keyId: string): Uint8Array | null {
  const info = signingKeys.find((k) => k.keyId === keyId);
  return info?.keyPair.publicKey ?? null;
}

// Initialize keys on module load
initializeKeys();
