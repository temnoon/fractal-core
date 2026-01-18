/**
 * SHA-256 hashing utilities using @noble/hashes
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { canonicalBytes } from './canonical.js';
import type { CanonicalRequest, NeighborhoodResult } from '../types/api.js';

/**
 * Compute SHA-256 hash of bytes, returning hex string
 */
export function sha256Hex(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}

/**
 * Compute SHA-256 hash of canonical JSON object
 */
export function hashCanonical(obj: unknown): string {
  return sha256Hex(canonicalBytes(obj));
}

/**
 * Compute request hash from canonical request
 * Includes all fields with include array sorted
 */
export function computeRequestHash(request: CanonicalRequest): string {
  // Ensure include array is sorted for canonical form
  const canonicalRequest = {
    ...request,
    include: [...request.include].sort(),
  };
  return hashCanonical(canonicalRequest);
}

/**
 * Compute result hash from neighborhood result
 */
export function computeResultHash(result: NeighborhoodResult): string {
  return hashCanonical(result);
}
