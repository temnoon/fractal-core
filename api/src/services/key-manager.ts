/**
 * Key Manager Service
 *
 * Manages Ed25519 signing keys with Workers KV for persistent storage.
 * Keys are generated once and stored permanently, ensuring consistent
 * signatures across deployments and cold starts.
 */

import { generateKeyPair, keyPairFromSecret, publicKeyToBase64, type KeyPair } from '../crypto/signing.js';

// KV keys
const SECRET_KEY_KV = 'signing_secret_key';
const KEY_ID_KV = 'signing_key_id';
const PUBLIC_KEY_KV = 'signing_public_key';
const KEY_CREATED_AT_KV = 'signing_key_created_at';

// In-memory cache for the current request
let cachedKeyPair: KeyPair | null = null;

/**
 * Encode Uint8Array to hex string for KV storage
 */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Decode hex string to Uint8Array
 */
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Generate a unique key ID based on timestamp and random component
 */
function generateKeyId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `pt-${timestamp}-${random}`;
}

/**
 * Initialize or retrieve the signing key pair
 *
 * If KV is provided, attempts to load existing keys from KV storage.
 * If no keys exist or KV is unavailable, generates new keys and stores them.
 *
 * @param kv - Workers KV namespace binding (optional)
 * @returns The signing key pair
 */
export async function getOrCreateKeyPair(kv?: KVNamespace): Promise<KeyPair> {
  // Return cached key if available
  if (cachedKeyPair) {
    return cachedKeyPair;
  }

  // Try to load from KV if available
  if (kv) {
    try {
      const [secretKeyHex, keyId] = await Promise.all([
        kv.get(SECRET_KEY_KV),
        kv.get(KEY_ID_KV),
      ]);

      if (secretKeyHex && keyId) {
        // Reconstruct key pair from stored secret key
        const secretKey = fromHex(secretKeyHex);
        cachedKeyPair = keyPairFromSecret(keyId, secretKey);
        return cachedKeyPair;
      }

      // No existing keys - generate new ones and store
      const newKeyId = generateKeyId();
      const newKeyPair = generateKeyPair(newKeyId);

      // Store in KV (non-blocking)
      await Promise.all([
        kv.put(SECRET_KEY_KV, toHex(newKeyPair.secretKey)),
        kv.put(KEY_ID_KV, newKeyId),
        kv.put(PUBLIC_KEY_KV, publicKeyToBase64(newKeyPair.publicKey)),
        kv.put(KEY_CREATED_AT_KV, new Date().toISOString()),
      ]);

      cachedKeyPair = newKeyPair;
      return cachedKeyPair;
    } catch (error) {
      console.error('KV key storage error, falling back to ephemeral keys:', error);
    }
  }

  // Fallback: generate ephemeral key pair (will change on cold start)
  const ephemeralKeyId = `ephemeral-${generateKeyId()}`;
  cachedKeyPair = generateKeyPair(ephemeralKeyId);
  return cachedKeyPair;
}

/**
 * Get key info without exposing the secret key
 *
 * @param kv - Workers KV namespace binding (optional)
 * @returns Public key information
 */
export async function getKeyInfo(kv?: KVNamespace): Promise<{
  key_id: string;
  public_key_b64: string;
  created_at?: string;
  persistent: boolean;
}> {
  const keyPair = await getOrCreateKeyPair(kv);

  let createdAt: string | undefined;
  let persistent = false;

  if (kv) {
    try {
      createdAt = await kv.get(KEY_CREATED_AT_KV) ?? undefined;
      persistent = !keyPair.keyId.startsWith('ephemeral-');
    } catch {
      // Ignore KV errors
    }
  }

  return {
    key_id: keyPair.keyId,
    public_key_b64: publicKeyToBase64(keyPair.publicKey),
    created_at: createdAt,
    persistent,
  };
}

/**
 * Force rotation of signing keys
 *
 * Generates a new key pair and stores it in KV, replacing the old one.
 * Old signatures will no longer verify with the new public key.
 *
 * @param kv - Workers KV namespace binding (required for rotation)
 * @returns The new key pair info
 */
export async function rotateKeys(kv: KVNamespace): Promise<{
  key_id: string;
  public_key_b64: string;
  created_at: string;
}> {
  const newKeyId = generateKeyId();
  const newKeyPair = generateKeyPair(newKeyId);
  const createdAt = new Date().toISOString();

  await Promise.all([
    kv.put(SECRET_KEY_KV, toHex(newKeyPair.secretKey)),
    kv.put(KEY_ID_KV, newKeyId),
    kv.put(PUBLIC_KEY_KV, publicKeyToBase64(newKeyPair.publicKey)),
    kv.put(KEY_CREATED_AT_KV, createdAt),
  ]);

  // Clear cache to force reload
  cachedKeyPair = newKeyPair;

  return {
    key_id: newKeyId,
    public_key_b64: publicKeyToBase64(newKeyPair.publicKey),
    created_at: createdAt,
  };
}

/**
 * Clear the in-memory key cache
 * Useful for testing or forcing a reload from KV
 */
export function clearKeyCache(): void {
  cachedKeyPair = null;
}
