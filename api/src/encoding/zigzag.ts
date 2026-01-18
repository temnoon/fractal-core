/**
 * Zigzag encoding for signed bigints
 * Maps signed integers to unsigned: 0 -> 0, -1 -> 1, 1 -> 2, -2 -> 3, 2 -> 4, ...
 */

/**
 * Encode a signed bigint to unsigned using zigzag encoding
 */
export function zigzagEncode(s: bigint): bigint {
  return s >= 0n ? 2n * s : -2n * s - 1n;
}

/**
 * Decode an unsigned bigint back to signed using zigzag decoding
 */
export function zigzagDecode(z: bigint): bigint {
  if (z < 0n) {
    throw new Error('zigzagDecode: input must be non-negative');
  }
  return (z & 1n) === 0n ? z / 2n : -(z + 1n) / 2n;
}
