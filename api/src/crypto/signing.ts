/**
 * Ed25519 signing and verification using @noble/ed25519
 */

import * as ed25519 from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { canonicalBytes } from './canonical.js';
import type {
  CanonicalRequest,
  NeighborhoodResult,
  Receipt,
  SignatureBlock,
} from '../types/api.js';

// Enable synchronous operations by providing sha512Sync
// @noble/ed25519 v2 requires this for sync operations
ed25519.etc.sha512Sync = (...m) => sha512(ed25519.etc.concatBytes(...m));

/**
 * Key pair for signing
 */
export interface KeyPair {
  keyId: string;
  secretKey: Uint8Array;  // 32 bytes
  publicKey: Uint8Array;  // 32 bytes
}

/**
 * Generate a new Ed25519 key pair
 */
export function generateKeyPair(keyId: string): KeyPair {
  const secretKey = ed25519.utils.randomPrivateKey();
  // Use the top-level sync getPublicKey function
  const publicKey = ed25519.getPublicKey(secretKey);
  return { keyId, secretKey, publicKey };
}

/**
 * Create a key pair from existing secret key bytes
 */
export function keyPairFromSecret(keyId: string, secretKey: Uint8Array): KeyPair {
  const publicKey = ed25519.getPublicKey(secretKey);
  return { keyId, secretKey, publicKey };
}

/**
 * Sign the combined {request, result, receipt} object
 * Signs SHA-256 hash of canonical JSON bytes
 */
export function signResponse(
  request: CanonicalRequest,
  result: NeighborhoodResult,
  receipt: Receipt,
  keyPair: KeyPair
): SignatureBlock {
  const toSign = { request, result, receipt };
  const hash = sha256(canonicalBytes(toSign));
  // Use top-level sync sign function
  const signature = ed25519.sign(hash, keyPair.secretKey);

  return {
    alg: 'ed25519',
    key_id: keyPair.keyId,
    signed_hash_alg: 'sha256',
    sig_b64: base64Encode(signature),
  };
}

/**
 * Verify a signature against {request, result, receipt}
 */
export function verifySignature(
  request: CanonicalRequest,
  result: NeighborhoodResult,
  receipt: Receipt,
  signature: SignatureBlock,
  publicKey: Uint8Array
): boolean {
  try {
    const toVerify = { request, result, receipt };
    const hash = sha256(canonicalBytes(toVerify));
    const sig = base64Decode(signature.sig_b64);
    // Use top-level sync verify function
    return ed25519.verify(sig, hash, publicKey);
  } catch {
    return false;
  }
}

/**
 * Get public key as base64
 */
export function publicKeyToBase64(publicKey: Uint8Array): string {
  return base64Encode(publicKey);
}

/**
 * Parse base64 public key
 */
export function publicKeyFromBase64(b64: string): Uint8Array {
  return base64Decode(b64);
}

// Base64 encoding/decoding helpers
function base64Encode(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

function base64Decode(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
