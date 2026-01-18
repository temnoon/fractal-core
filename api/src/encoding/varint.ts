/**
 * LEB128 varint encoding/decoding for unsigned bigints
 */

/**
 * Encode an unsigned bigint as LEB128 varint
 */
export function uvarintEncode(x: bigint): Uint8Array {
  if (x < 0n) {
    throw new Error('uvarintEncode: negative values not allowed');
  }

  const out: number[] = [];
  while (x >= 0x80n) {
    out.push(Number((x & 0x7fn) | 0x80n));
    x >>= 7n;
  }
  out.push(Number(x & 0x7fn));
  return Uint8Array.from(out);
}

/**
 * Decode a LEB128 varint to unsigned bigint
 * Returns [value, bytesRead]
 */
export function uvarintDecode(buf: Uint8Array, offset = 0): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  let bytesRead = 0;

  while (offset + bytesRead < buf.length) {
    const byte = buf[offset + bytesRead];
    result |= BigInt(byte & 0x7f) << shift;
    bytesRead++;

    if ((byte & 0x80) === 0) {
      return [result, bytesRead];
    }

    shift += 7n;

    // Prevent infinite loops on malformed input
    if (shift > 70n) {
      throw new Error('uvarintDecode: varint too long');
    }
  }

  throw new Error('uvarintDecode: unexpected end of buffer');
}

/**
 * Calculate the number of bytes needed to encode a value
 */
export function uvarintSize(x: bigint): number {
  if (x < 0n) {
    throw new Error('uvarintSize: negative values not allowed');
  }

  let size = 1;
  while (x >= 0x80n) {
    x >>= 7n;
    size++;
  }
  return size;
}
