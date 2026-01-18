/**
 * Canonical JSON serialization
 *
 * Rules (v1):
 * 1. UTF-8 only
 * 2. Object keys sorted lexicographically (bytewise)
 * 3. No whitespace (compact encoding)
 * 4. All bigints as strings
 * 5. Arrays preserve order
 */

/**
 * Serialize a value to canonical JSON string
 */
export function canonicalStringify(obj: unknown): string {
  if (obj === null) {
    return 'null';
  }

  if (obj === undefined) {
    return 'null'; // Treat undefined as null for consistency
  }

  if (typeof obj === 'boolean') {
    return obj ? 'true' : 'false';
  }

  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) {
      throw new Error('canonicalStringify: non-finite numbers not allowed');
    }
    return JSON.stringify(obj);
  }

  if (typeof obj === 'bigint') {
    // Bigints are serialized as quoted strings
    return JSON.stringify(obj.toString());
  }

  if (typeof obj === 'string') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }

  if (typeof obj === 'object') {
    // Sort keys lexicographically (bytewise)
    const keys = Object.keys(obj).sort();
    const pairs = keys
      .filter((k) => (obj as Record<string, unknown>)[k] !== undefined)
      .map((k) => {
        return JSON.stringify(k) + ':' + canonicalStringify((obj as Record<string, unknown>)[k]);
      });
    return '{' + pairs.join(',') + '}';
  }

  throw new Error(`canonicalStringify: unsupported type ${typeof obj}`);
}

/**
 * Serialize a value to canonical JSON bytes (UTF-8)
 */
export function canonicalBytes(obj: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalStringify(obj));
}

/**
 * Parse canonical JSON - standard JSON.parse is sufficient
 * since canonical JSON is valid JSON
 */
export function canonicalParse<T>(json: string): T {
  return JSON.parse(json) as T;
}
