# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fractal-Core consists of two components:

1. **Prime Neighborhood Navigator** (`index.html`) - Interactive web visualization exploring prime neighborhoods with physics-based animation
2. **Prime Terrain API** (`api/`) - Backend service providing prime neighborhood data with canonicalization, hashing, and Ed25519 signing

### Mathematical Model

- **Gap**: gₙ = pₙ₊₁ − pₙ
- **Second difference**: Δ² = gₙ − gₙ₋₁
- **Second ratio**: r = Δ² / (pₙ₊₁ − pₙ₋₁), always in [-1, 1]

## Development

### Visualization (index.html)

Open `index.html` directly in a browser. No build required.

### API Server

```bash
cd api
npm install
npm run dev      # development with hot reload
npm run build    # compile TypeScript
npm start        # production
npm test         # run tests
```

## API Architecture

Base URL: `https://fractal-core.com/api/v1`

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Service status (public) |
| `/capabilities` | GET | Plan limits, engines, signing keys |
| `/neighborhood` | GET | Full neighborhood with optional derived sequences |
| `/gaps` | GET | Prime gaps only |
| `/second-differences` | GET | Δ² values only |
| `/second-ratios` | GET | Normalized ratio r values |
| `/fingerprint` | GET | Request/result hashes without payload |
| `/verify` | POST | Verify signature + canonical hashes |
| `/jobs` | POST | Create async job for large requests |
| `/jobs/{job_id}` | GET | Job status |
| `/jobs/{job_id}/result` | GET | Job result |
| `/users/me` | GET | Current user info + usage (auth required) |
| `/users` | POST | Create user (admin only) |
| `/api-keys` | POST | Create API key (auth required) |
| `/api-keys` | GET | List user's API keys (auth required) |
| `/api-keys/:prefix` | DELETE | Revoke API key (auth required) |

### Authentication

API keys are passed via headers:
- `Authorization: Bearer frc_...` (preferred)
- `X-API-Key: frc_...`

**API Key Format**: `frc_<32 alphanumeric chars>` (e.g., `frc_a7B3c9D5e1F8g2H4j6K0l8M1n3O9p5Q7`)

### User Tiers

| Tier | CPU Time/Month | Req/Min | Expensive/Min | Async Jobs |
|------|----------------|---------|---------------|------------|
| free | 5 minutes | 100 | 20 | 5 |
| pro | unlimited (pay-per-use) | 500 | 100 | 50 |
| enterprise | custom | 2000 | 500 | 500 |

### Key Query Parameters

- `n` (required): Anchor value (string for bigint support)
- `n_type`: `index` (prime index pₙ) or `value` (numeric center)
- `mode`: `count` or `span`
- `k`: Number of primes each side (count mode)
- `w`: Half-width of window (span mode, bigint string)
- `include`: Comma-separated: `primes,gaps,d2,ratio,indices`
- `engine`: `auto|sieve|mr64|bpsw|mr-prob|precomputed`
- `validate`: `none|dual|triple` (multi-engine validation)
- `proof`: `none|receipt|signed`
- `format`: `json|bin`
- `compress`: `none|gzip|zstd`

## Canonical Rules (v1)

### Canonical JSON

1. UTF-8 only
2. Object keys sorted lexicographically (bytewise)
3. No whitespace (compact encoding)
4. All bigints as strings (primes, gaps, d2, rationals)
5. Arrays preserve order

**Request hash**: SHA-256 of canonical request object with all fields explicit, `include` array sorted.

**Result hash**: SHA-256 of canonical `result` object alone.

**Signing**: Ed25519 signs SHA-256 of canonical `{request, result, receipt}` bytes.

### Canonical BIN Format

```
[Header][gaps section][d2 section][ratio section][indices section]
```

**Header**:
- `magic`: 4 bytes "FCP1"
- `version`: u16 LE (0x0001)
- `flags`: u32 LE (bit0=primes implicit, bit1=gaps, bit2=d2, bit3=ratio, bit4=indices)
- `n_type`: u8 (0=index, 1=value)
- `mode`: u8 (0=count, 1=span)
- `reserved`: u16 LE (0)
- `count_*`: varints for primes/gaps/d2/ratio counts
- `center_index`: varint
- `p0`: uvarint (first prime)

**Encoding**:
- Unsigned integers: LEB128 varint
- Signed integers (d2): zigzag then varint
- Rationals: zigzag(num) + uvarint(den)

### Varint (LEB128)

```typescript
function uvarintEncode(x: bigint): Uint8Array {
  const out: number[] = [];
  while (x >= 0x80n) {
    out.push(Number((x & 0x7Fn) | 0x80n));
    x >>= 7n;
  }
  out.push(Number(x & 0x7Fn));
  return Uint8Array.from(out);
}
```

### Zigzag (signed → unsigned)

```typescript
function zigzagEncode(s: bigint): bigint {
  return s >= 0n ? 2n * s : -2n * s - 1n;
}

function zigzagDecode(z: bigint): bigint {
  return (z & 1n) === 0n ? z / 2n : -(z + 1n) / 2n;
}
```

## API Response Structure

```typescript
interface SignedResponse {
  request: CanonicalRequestEcho;
  result: NeighborhoodResult;
  receipt?: Receipt;      // when proof != 'none'
  signature?: SignatureBlock;  // when proof == 'signed'
}

interface NeighborhoodResult {
  n: string;
  n_type: 'index' | 'value';
  mode: 'count' | 'span';
  center_prime?: string;
  primes?: string[];
  gaps?: string[];        // unsigned bigint strings
  d2?: string[];          // signed bigint strings
  ratio?: Rational[];     // {num: string, den: string}
  indices?: number[];
}

interface Receipt {
  request_hash: string;   // SHA-256 hex
  result_hash: string;    // SHA-256 hex
  engines: string[];
  validation: { mode: string; agreement: boolean };
  deterministic: boolean;
  generated_at: string;   // ISO 8601
}

interface SignatureBlock {
  alg: 'ed25519';
  key_id: string;
  signed_hash_alg: 'sha256';
  sig_b64: string;        // base64 signature
}
```

## Visualization Architecture

`index.html` is self-contained with:

- **Lines 7-117**: CSS design system
- **Lines 137-285**: SVG visualization
- **Lines 369-776**: JavaScript IIFE

| Function | Purpose |
|----------|---------|
| `sieve(limit)` | Sieve of Eratosthenes |
| `measureAtIndex(idx)` | Core measurement: {pₙ₋₁, pₙ, pₙ₊₁, gPrev, g, d2, span, r} |
| `physicsStep(dt, m)` | Semi-implicit Euler with collision |
| `needleVectorFromR(r)` | Maps r ∈ [-1,1] to compass direction |
