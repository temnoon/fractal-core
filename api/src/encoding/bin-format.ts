/**
 * BIN v1 format encoder/decoder
 *
 * Binary format for compact prime neighborhood data.
 *
 * Header:
 *   magic: "FCP1" (4 bytes)
 *   version: u16 LE (0x0001)
 *   flags: u32 LE (bit0=primes implicit, bit1=gaps, bit2=d2, bit3=ratio, bit4=indices)
 *   n_type: u8 (0=index, 1=value)
 *   mode: u8 (0=count, 1=span)
 *   reserved: u16 LE (0)
 *   count_primes: varint
 *   count_gaps: varint
 *   count_d2: varint
 *   count_ratio: varint
 *   center_index: varint
 *   p0: uvarint (first prime)
 *
 * Sections:
 *   [gaps section: uvarints]
 *   [d2 section: zigzag varints]
 *   [ratio section: zigzag(num) + uvarint(den) pairs]
 *   [indices section: varints]
 */

import { uvarintEncode, uvarintDecode } from './varint.js';
import { zigzagEncode, zigzagDecode } from './zigzag.js';
import type { NeighborhoodResult } from '../types/api.js';
import type { Rational, NType, NeighborhoodMode } from '../types/neighborhood.js';

// Magic bytes
const MAGIC = new Uint8Array([0x46, 0x43, 0x50, 0x31]); // "FCP1"
const VERSION = 0x0001;

// Flag bits
const FLAG_PRIMES_IMPLICIT = 0x01;
const FLAG_GAPS = 0x02;
const FLAG_D2 = 0x04;
const FLAG_RATIO = 0x08;
const FLAG_INDICES = 0x10;

export interface BinEncodeOptions {
  result: NeighborhoodResult;
  centerIndex: number;
}

/**
 * Encode neighborhood result to BIN v1 format
 */
export function binEncode(options: BinEncodeOptions): Uint8Array {
  const { result, centerIndex } = options;

  const chunks: Uint8Array[] = [];

  // Build flags
  let flags = FLAG_PRIMES_IMPLICIT; // Primes are implicit (derived from p0 + gaps)

  if (result.gaps) flags |= FLAG_GAPS;
  if (result.d2) flags |= FLAG_D2;
  if (result.ratio) flags |= FLAG_RATIO;
  if (result.indices) flags |= FLAG_INDICES;

  // Header (fixed part: 12 bytes)
  const header = new Uint8Array(12);
  header.set(MAGIC, 0);

  // Version (u16 LE)
  header[4] = VERSION & 0xff;
  header[5] = (VERSION >> 8) & 0xff;

  // Flags (u32 LE)
  header[6] = flags & 0xff;
  header[7] = (flags >> 8) & 0xff;
  header[8] = (flags >> 16) & 0xff;
  header[9] = (flags >> 24) & 0xff;

  // n_type (u8)
  header[10] = result.n_type === 'index' ? 0 : 1;

  // mode (u8)
  header[11] = result.mode === 'count' ? 0 : 1;

  chunks.push(header);

  // Reserved (u16 LE = 0)
  chunks.push(new Uint8Array([0, 0]));

  // Counts as varints
  const primes = result.primes ?? [];
  const gaps = result.gaps ?? [];
  const d2 = result.d2 ?? [];
  const ratios = result.ratio ?? [];

  chunks.push(uvarintEncode(BigInt(primes.length)));
  chunks.push(uvarintEncode(BigInt(gaps.length)));
  chunks.push(uvarintEncode(BigInt(d2.length)));
  chunks.push(uvarintEncode(BigInt(ratios.length)));

  // Center index as varint
  chunks.push(uvarintEncode(BigInt(centerIndex)));

  // First prime (p0) as uvarint
  const p0 = primes.length > 0 ? BigInt(primes[0]) : 0n;
  chunks.push(uvarintEncode(p0));

  // Gaps section: unsigned varints
  for (const gap of gaps) {
    chunks.push(uvarintEncode(BigInt(gap)));
  }

  // D2 section: zigzag varints (signed)
  for (const d of d2) {
    chunks.push(uvarintEncode(zigzagEncode(BigInt(d))));
  }

  // Ratio section: zigzag(num) + uvarint(den) pairs
  for (const r of ratios) {
    chunks.push(uvarintEncode(zigzagEncode(BigInt(r.num))));
    chunks.push(uvarintEncode(BigInt(r.den)));
  }

  // Indices section: varints
  if (result.indices) {
    for (const idx of result.indices) {
      chunks.push(uvarintEncode(BigInt(idx)));
    }
  }

  // Concatenate all chunks
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

export interface BinDecodeResult {
  result: NeighborhoodResult;
  centerIndex: number;
}

/**
 * Decode BIN v1 format to neighborhood result
 */
export function binDecode(data: Uint8Array): BinDecodeResult {
  let offset = 0;

  // Check magic
  if (
    data[0] !== MAGIC[0] ||
    data[1] !== MAGIC[1] ||
    data[2] !== MAGIC[2] ||
    data[3] !== MAGIC[3]
  ) {
    throw new Error('Invalid BIN format: bad magic');
  }
  offset += 4;

  // Version (u16 LE)
  const version = data[offset] | (data[offset + 1] << 8);
  if (version !== VERSION) {
    throw new Error(`Unsupported BIN version: ${version}`);
  }
  offset += 2;

  // Flags (u32 LE)
  const flags =
    data[offset] |
    (data[offset + 1] << 8) |
    (data[offset + 2] << 16) |
    (data[offset + 3] << 24);
  offset += 4;

  // n_type (u8)
  const nType: NType = data[offset] === 0 ? 'index' : 'value';
  offset += 1;

  // mode (u8)
  const mode: NeighborhoodMode = data[offset] === 0 ? 'count' : 'span';
  offset += 1;

  // Reserved (u16 LE)
  offset += 2;

  // Read counts
  let [countPrimes, bytesRead] = uvarintDecode(data, offset);
  offset += bytesRead;

  let countGaps: bigint;
  [countGaps, bytesRead] = uvarintDecode(data, offset);
  offset += bytesRead;

  let countD2: bigint;
  [countD2, bytesRead] = uvarintDecode(data, offset);
  offset += bytesRead;

  let countRatio: bigint;
  [countRatio, bytesRead] = uvarintDecode(data, offset);
  offset += bytesRead;

  // Center index
  let centerIndex: bigint;
  [centerIndex, bytesRead] = uvarintDecode(data, offset);
  offset += bytesRead;

  // First prime (p0)
  let p0: bigint;
  [p0, bytesRead] = uvarintDecode(data, offset);
  offset += bytesRead;

  // Read gaps
  const gaps: string[] = [];
  if (flags & FLAG_GAPS) {
    for (let i = 0n; i < countGaps; i++) {
      let gap: bigint;
      [gap, bytesRead] = uvarintDecode(data, offset);
      offset += bytesRead;
      gaps.push(gap.toString());
    }
  }

  // Read d2
  const d2: string[] = [];
  if (flags & FLAG_D2) {
    for (let i = 0n; i < countD2; i++) {
      let encoded: bigint;
      [encoded, bytesRead] = uvarintDecode(data, offset);
      offset += bytesRead;
      d2.push(zigzagDecode(encoded).toString());
    }
  }

  // Read ratios
  const ratios: Rational[] = [];
  if (flags & FLAG_RATIO) {
    for (let i = 0n; i < countRatio; i++) {
      let numEncoded: bigint;
      [numEncoded, bytesRead] = uvarintDecode(data, offset);
      offset += bytesRead;

      let den: bigint;
      [den, bytesRead] = uvarintDecode(data, offset);
      offset += bytesRead;

      ratios.push({
        num: zigzagDecode(numEncoded).toString(),
        den: den.toString(),
      });
    }
  }

  // Read indices
  const indices: number[] = [];
  if (flags & FLAG_INDICES) {
    for (let i = 0n; i < countPrimes; i++) {
      let idx: bigint;
      [idx, bytesRead] = uvarintDecode(data, offset);
      offset += bytesRead;
      indices.push(Number(idx));
    }
  }

  // Reconstruct primes from p0 and gaps
  const primes: string[] = [];
  if (flags & FLAG_PRIMES_IMPLICIT) {
    let current = p0;
    primes.push(current.toString());
    for (const gapStr of gaps) {
      current += BigInt(gapStr);
      primes.push(current.toString());
    }
  }

  const result: NeighborhoodResult = {
    n: '0', // Will be filled by caller
    n_type: nType,
    mode,
    primes: primes.length > 0 ? primes : undefined,
    gaps: gaps.length > 0 ? gaps : undefined,
    d2: d2.length > 0 ? d2 : undefined,
    ratio: ratios.length > 0 ? ratios : undefined,
    indices: indices.length > 0 ? indices : undefined,
  };

  return {
    result,
    centerIndex: Number(centerIndex),
  };
}
