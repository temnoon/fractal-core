# RFC-001: Prime Terrain API Protocol Specification

**Status:** Draft
**Version:** 1.0.0
**Date:** 2026-01-27
**Authors:** Fractal-Core Team

---

## Abstract

This document specifies the Prime Terrain API, a RESTful service for computing and retrieving prime number neighborhoods with cryptographic attestation. The API provides deterministic primality testing, canonical data encoding, Ed25519 digital signatures, and multi-engine validation for mathematical reproducibility.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Terminology](#2-terminology)
3. [Protocol Overview](#3-protocol-overview)
4. [Authentication](#4-authentication)
5. [Endpoints](#5-endpoints)
6. [Request Parameters](#6-request-parameters)
7. [Response Structures](#7-response-structures)
8. [Canonical Encoding](#8-canonical-encoding)
9. [Binary Format Specification](#9-binary-format-specification)
10. [Cryptographic Signing](#10-cryptographic-signing)
11. [Verification Protocol](#11-verification-protocol)
12. [Rate Limiting](#12-rate-limiting)
13. [Error Handling](#13-error-handling)
14. [Async Job Processing](#14-async-job-processing)
15. [Security Considerations](#15-security-considerations)
16. [IANA Considerations](#16-iana-considerations)
17. [References](#17-references)
18. [Appendix A: Mathematical Definitions](#appendix-a-mathematical-definitions)
19. [Appendix B: Example Requests](#appendix-b-example-requests)
20. [Appendix C: OEIS Compatibility](#appendix-c-oeis-compatibility)

---

## 1. Introduction

### 1.1 Purpose

The Prime Terrain API provides programmatic access to prime number computations with cryptographic guarantees of correctness. It enables clients to:

- Retrieve prime neighborhoods centered on arbitrary indices or values
- Obtain derived sequences (gaps, second differences, ratios)
- Verify computational results through digital signatures
- Cross-validate results using multiple primality engines

### 1.2 Scope

This specification covers:

- HTTP request/response protocols
- Data serialization formats (JSON and binary)
- Cryptographic signing and verification
- Authentication and rate limiting
- Async job processing for expensive computations

### 1.3 Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119.

---

## 2. Terminology

| Term | Definition |
|------|------------|
| **Prime Index** | The 0-based position of a prime in the sequence (p₀=2, p₁=3, p₂=5, ...) |
| **Prime Value** | The numeric value of a prime number |
| **Gap** | The difference between consecutive primes: gₙ = pₙ₊₁ − pₙ |
| **Second Difference** | The change in gap size: Δ² = gₙ − gₙ₋₁ |
| **Second Ratio** | Normalized second difference: r = Δ² / (pₙ₊₁ − pₙ₋₁), always in [-1, 1] |
| **Neighborhood** | A contiguous sequence of primes centered on an anchor point |
| **Canonical Form** | The deterministic serialization of data for hashing/signing |
| **Receipt** | Metadata about computation including hashes and validation info |

---

## 3. Protocol Overview

### 3.1 Base URL

```
https://fractal-core.com/api/v1
```

### 3.2 Transport

All communication MUST use HTTPS (TLS 1.2 or higher). HTTP requests SHOULD be redirected to HTTPS.

### 3.3 Content Types

| Format | Content-Type | Use Case |
|--------|--------------|----------|
| JSON | `application/json` | Default, human-readable |
| Binary | `application/octet-stream` | Compact, efficient |

### 3.4 Character Encoding

All text MUST be encoded as UTF-8.

### 3.5 Request Flow

```
┌─────────┐     ┌──────────────┐     ┌─────────────┐
│ Client  │────▶│ Auth/Rate    │────▶│ Computation │
│         │     │ Middleware   │     │ Engine      │
└─────────┘     └──────────────┘     └─────────────┘
                       │                    │
                       ▼                    ▼
                ┌──────────────┐     ┌─────────────┐
                │ User/Quota   │     │ Canonical   │
                │ Validation   │     │ Encoding    │
                └──────────────┘     └─────────────┘
                                           │
                                           ▼
                                    ┌─────────────┐
                                    │ Signing     │
                                    │ (optional)  │
                                    └─────────────┘
```

---

## 4. Authentication

### 4.1 API Key Format

API keys MUST follow this format:

```
frc_<32 alphanumeric characters>
```

**Regex:** `^frc_[a-zA-Z0-9]{32}$`

**Example:** `frc_a7B3c9D5e1F8g2H4j6K0l8M1n3O9p5Q7`

### 4.2 Authentication Headers

Clients SHOULD provide API keys via one of these headers (in precedence order):

1. `Authorization: Bearer <key>`
2. `X-API-Key: <key>`

### 4.3 User Tiers

| Tier | CPU Time/Month | Requests/Min | Expensive/Min | Async Jobs |
|------|----------------|--------------|---------------|------------|
| free | 5 minutes | 100 | 20 | 5 |
| pro | unlimited | 500 | 100 | 50 |
| enterprise | custom | 2000 | 500 | 500 |

### 4.4 Unauthenticated Requests

Requests without valid API keys are treated as `free` tier with shared rate limits based on IP address.

---

## 5. Endpoints

### 5.1 Status Endpoints

#### GET /status

Returns service health information.

**Authentication:** Not required

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime_seconds": 86400
}
```

#### GET /capabilities

Returns service capabilities, available engines, and tier limits.

**Authentication:** Optional (affects returned limits)

**Response:**
```json
{
  "engines": ["auto", "sieve", "mr64", "bpsw", "mr-prob"],
  "validation_modes": ["none", "dual", "triple"],
  "proof_levels": ["none", "receipt", "signed"],
  "formats": ["json", "bin"],
  "compression": ["none", "gzip", "zstd"],
  "signing_keys": [{
    "key_id": "primary-2026",
    "algorithm": "ed25519",
    "public_key_b64": "..."
  }],
  "limits": {
    "max_k": 10000,
    "max_w": "1000000000",
    "sieve_limit": 10000000
  }
}
```

### 5.2 Computation Endpoints

#### GET /neighborhood

Returns full prime neighborhood with all requested derived sequences.

**Authentication:** Optional (affects rate limits)

**Query Parameters:** See [Section 6](#6-request-parameters)

**Response:** See [Section 7](#7-response-structures)

#### GET /gaps

Returns prime gaps only. Equivalent to `/neighborhood?include=gaps`.

#### GET /second-differences

Returns second differences only. Equivalent to `/neighborhood?include=d2`.

#### GET /second-ratios

Returns second ratios only. Equivalent to `/neighborhood?include=ratio`.

#### GET /fingerprint

Returns request/result hashes without the full payload.

**Response:**
```json
{
  "request_hash": "a1b2c3...",
  "result_hash": "d4e5f6...",
  "engines": ["sieve"],
  "generated_at": "2026-01-27T12:00:00Z"
}
```

### 5.3 Verification Endpoint

#### POST /verify

Verifies signatures and canonical hashes.

**Request Body:** Complete `SignedResponse` structure

**Response:**
```json
{
  "valid": true,
  "checks": {
    "request_hash": {
      "expected": "a1b2c3...",
      "actual": "a1b2c3...",
      "match": true
    },
    "result_hash": {
      "expected": "d4e5f6...",
      "actual": "d4e5f6...",
      "match": true
    },
    "signature": {
      "valid": true,
      "key_id": "primary-2026"
    }
  }
}
```

### 5.4 Job Endpoints

#### POST /jobs

Creates an async job for expensive computations.

**Request Body:** Same parameters as query parameters (JSON)

**Response (202 Accepted):**
```json
{
  "job_id": "job_abc123",
  "status": "pending",
  "poll_url": "/api/v1/jobs/job_abc123"
}
```

#### GET /jobs

Lists all jobs for the authenticated user.

#### GET /jobs/{job_id}

Returns job status.

**Response:**
```json
{
  "job_id": "job_abc123",
  "status": "completed",
  "created_at": "2026-01-27T12:00:00Z",
  "completed_at": "2026-01-27T12:00:05Z",
  "result_url": "/api/v1/jobs/job_abc123/result"
}
```

#### GET /jobs/{job_id}/result

Returns completed job result (full `SignedResponse`).

#### DELETE /jobs/{job_id}

Cancels or deletes a job.

### 5.5 User Management Endpoints

#### GET /users/me

Returns current user info and usage statistics.

**Authentication:** Required

#### POST /api-keys

Creates a new API key for the authenticated user.

**Authentication:** Required

**Request Body:**
```json
{
  "name": "My App Key",
  "expires_in_days": 90
}
```

**Response (201 Created):**
```json
{
  "key": "frc_a7B3c9D5e1F8g2H4j6K0l8M1n3O9p5Q7",
  "prefix": "frc_a7B3",
  "name": "My App Key",
  "expires_at": "2026-04-27T12:00:00Z",
  "warning": "Save this key now. It cannot be retrieved later."
}
```

#### GET /api-keys

Lists user's API keys (without full key values).

#### DELETE /api-keys/{prefix}

Revokes an API key by its prefix.

---

## 6. Request Parameters

### 6.1 Core Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `n` | string | Yes | - | Anchor value (bigint as string) |
| `n_type` | enum | No | `index` | `index` (prime index pₙ) or `value` (numeric value) |
| `mode` | enum | No | `count` | `count` (fixed number) or `span` (fixed width) |

### 6.2 Mode-Specific Parameters

| Parameter | Mode | Type | Constraints | Description |
|-----------|------|------|-------------|-------------|
| `k` | count | string | 1 ≤ k ≤ 10,000 | Primes per side of center |
| `w` | span | string | 1 ≤ w ≤ 10⁹ | Half-width of window (bigint) |

### 6.3 Output Parameters

| Parameter | Type | Default | Values |
|-----------|------|---------|--------|
| `include` | string | `primes,gaps,d2,ratio` | Comma-separated: `primes`, `gaps`, `d2`, `ratio`, `indices` |
| `format` | enum | `json` | `json`, `bin` |
| `compress` | enum | `none` | `none`, `gzip`, `zstd` |

### 6.4 Validation Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `engine` | enum | `auto` | Primality engine: `auto`, `sieve`, `mr64`, `bpsw`, `mr-prob` |
| `validate` | enum | `none` | Cross-validation: `none`, `dual`, `triple` |
| `proof` | enum | `none` | Attestation level: `none`, `receipt`, `signed` |

### 6.5 Engine Selection

| Engine | Algorithm | Range | Deterministic |
|--------|-----------|-------|---------------|
| `auto` | Auto-select | Any | Yes |
| `sieve` | Sieve of Eratosthenes | n ≤ 10⁷ | Yes |
| `mr64` | Miller-Rabin (64-bit witnesses) | Any | Yes (n < 2⁶⁴) |
| `bpsw` | Baillie-PSW | Any | Yes (no counterexamples known) |
| `mr-prob` | Miller-Rabin (random witnesses) | Any | No |

---

## 7. Response Structures

### 7.1 Base Response (proof=none)

```typescript
interface BaseResponse {
  request: CanonicalRequest;
  result: NeighborhoodResult;
}
```

### 7.2 Receipt Response (proof=receipt)

```typescript
interface ReceiptResponse extends BaseResponse {
  receipt: Receipt;
}
```

### 7.3 Signed Response (proof=signed)

```typescript
interface SignedResponse extends ReceiptResponse {
  signature: SignatureBlock;
}
```

### 7.4 CanonicalRequest

```typescript
interface CanonicalRequest {
  n: string;                    // Anchor (bigint string)
  n_type: 'index' | 'value';
  mode: 'count' | 'span';
  k?: number;                   // Count mode only
  w?: string;                   // Span mode only
  include: string[];            // Sorted array
  engine: EngineType;
  validate: ValidationMode;
  proof: ProofLevel;
  format: OutputFormat;
  compress: CompressionType;
}
```

### 7.5 NeighborhoodResult

```typescript
interface NeighborhoodResult {
  n: string;                    // Echo of anchor
  n_type: 'index' | 'value';
  mode: 'count' | 'span';
  center_prime?: string;        // Center prime value
  primes?: string[];            // Primes as bigint strings
  gaps?: string[];              // Unsigned gaps
  d2?: string[];                // Signed second differences
  ratio?: Rational[];           // Normalized ratios
  indices?: number[];           // Prime indices
}

interface Rational {
  num: string;                  // Signed numerator
  den: string;                  // Unsigned denominator
}
```

### 7.6 Receipt

```typescript
interface Receipt {
  request_hash: string;         // SHA-256 hex of canonical request
  result_hash: string;          // SHA-256 hex of canonical result
  engines: string[];            // Engines used
  validation: {
    mode: 'none' | 'dual' | 'triple';
    agreement: boolean;
  };
  deterministic: boolean;
  generated_at: string;         // ISO 8601
}
```

### 7.7 SignatureBlock

```typescript
interface SignatureBlock {
  alg: 'ed25519';
  key_id: string;
  signed_hash_alg: 'sha256';
  sig_b64: string;              // Base64 signature
}
```

---

## 8. Canonical Encoding

### 8.1 Canonical JSON Rules (v1)

All JSON serialization for hashing and signing MUST follow these rules:

1. **Encoding:** UTF-8 only, no BOM
2. **Key Order:** Object keys MUST be sorted lexicographically (bytewise)
3. **Whitespace:** No whitespace between tokens
4. **Numbers:** Integers only (no floats)
5. **BigInts:** Serialized as quoted strings
6. **Arrays:** Preserve element order
7. **Null/Undefined:** Omit keys with undefined values; include explicit nulls

### 8.2 Canonical Stringify Algorithm

```typescript
function canonicalStringify(obj: unknown): string {
  if (obj === null) return 'null';
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (typeof obj === 'number') return String(obj);
  if (typeof obj === 'boolean') return String(obj);
  if (typeof obj === 'bigint') return `"${obj.toString()}"`;

  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }

  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    const pairs = keys
      .filter(k => obj[k] !== undefined)
      .map(k => `"${k}":${canonicalStringify(obj[k])}`);
    return '{' + pairs.join(',') + '}';
  }

  throw new Error(`Unsupported type: ${typeof obj}`);
}
```

### 8.3 Hash Computation

**Request Hash:**
1. Construct `CanonicalRequest` with all fields explicit
2. Sort `include` array alphabetically
3. Serialize using canonical stringify
4. Compute SHA-256 of UTF-8 bytes
5. Return lowercase hex string

**Result Hash:**
1. Construct `NeighborhoodResult`
2. Serialize using canonical stringify
3. Compute SHA-256 of UTF-8 bytes
4. Return lowercase hex string

---

## 9. Binary Format Specification

### 9.1 Format Identifier

Magic bytes: `FCP1` (0x46 0x43 0x50 0x31)

### 9.2 Header Structure

```
Offset  Size    Type      Field
------  ----    ----      -----
0       4       bytes     Magic ("FCP1")
4       2       u16 LE    Version (0x0001)
6       4       u32 LE    Flags
10      1       u8        n_type (0=index, 1=value)
11      1       u8        mode (0=count, 1=span)
12      2       u16 LE    Reserved (0x0000)
14      var     varint    count_primes
...     var     varint    count_gaps
...     var     varint    count_d2
...     var     varint    count_ratio
...     var     varint    center_index
...     var     uvarint   p0 (first prime)
```

### 9.3 Flags Bitfield

| Bit | Mask | Name | Description |
|-----|------|------|-------------|
| 0 | 0x01 | PRIMES_IMPLICIT | Primes derived from p0 + gaps |
| 1 | 0x02 | HAS_GAPS | Gaps section present |
| 2 | 0x04 | HAS_D2 | D2 section present |
| 3 | 0x08 | HAS_RATIO | Ratio section present |
| 4 | 0x10 | HAS_INDICES | Indices section present |

### 9.4 Section Encoding

**Gaps Section:** Sequence of unsigned varints
```
[gap_0][gap_1][gap_2]...
```

**D2 Section:** Sequence of zigzag-encoded signed varints
```
[zigzag(d2_0)][zigzag(d2_1)]...
```

**Ratio Section:** Pairs of (zigzag numerator, unsigned denominator)
```
[zigzag(num_0)][den_0][zigzag(num_1)][den_1]...
```

**Indices Section:** Sequence of unsigned varints
```
[idx_0][idx_1][idx_2]...
```

### 9.5 LEB128 Varint Encoding

Unsigned integers use Little-Endian Base 128 (LEB128):

```typescript
function uvarintEncode(x: bigint): Uint8Array {
  const out: number[] = [];
  while (x >= 0x80n) {
    out.push(Number((x & 0x7fn) | 0x80n));
    x >>= 7n;
  }
  out.push(Number(x & 0x7fn));
  return Uint8Array.from(out);
}

function uvarintDecode(buf: Uint8Array, offset: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  let bytesRead = 0;

  while (true) {
    const byte = buf[offset + bytesRead];
    result |= BigInt(byte & 0x7f) << shift;
    bytesRead++;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
    if (shift > 70n) throw new Error('varint overflow');
  }

  return [result, bytesRead];
}
```

### 9.6 Zigzag Encoding

Maps signed integers to unsigned for efficient varint encoding:

```typescript
function zigzagEncode(s: bigint): bigint {
  return s >= 0n ? 2n * s : -2n * s - 1n;
}

function zigzagDecode(z: bigint): bigint {
  return (z & 1n) === 0n ? z / 2n : -(z + 1n) / 2n;
}
```

Mapping: 0→0, -1→1, 1→2, -2→3, 2→4, ...

---

## 10. Cryptographic Signing

### 10.1 Algorithm

- **Signature Algorithm:** Ed25519 (RFC 8032)
- **Hash Algorithm:** SHA-256

### 10.2 Signed Data Structure

The signature covers the SHA-256 hash of the canonical JSON encoding of:

```typescript
{
  request: CanonicalRequest,
  result: NeighborhoodResult,
  receipt: Receipt
}
```

### 10.3 Signing Process

1. Construct the complete `{request, result, receipt}` object
2. Serialize using canonical JSON rules
3. Compute SHA-256 of UTF-8 encoded bytes
4. Sign the hash using Ed25519 secret key
5. Base64-encode the 64-byte signature
6. Construct `SignatureBlock`:
   ```json
   {
     "alg": "ed25519",
     "key_id": "primary-2026",
     "signed_hash_alg": "sha256",
     "sig_b64": "..."
   }
   ```

### 10.4 Key Distribution

Public keys are distributed via the `/capabilities` endpoint:

```json
{
  "signing_keys": [{
    "key_id": "primary-2026",
    "algorithm": "ed25519",
    "public_key_b64": "MCowBQYDK2VwAyEA..."
  }]
}
```

---

## 11. Verification Protocol

### 11.1 Client Verification Steps

To verify a `SignedResponse`:

1. **Verify Request Hash:**
   - Sort `include` array in request
   - Canonical stringify request object
   - Compute SHA-256
   - Compare to `receipt.request_hash`

2. **Verify Result Hash:**
   - Canonical stringify result object
   - Compute SHA-256
   - Compare to `receipt.result_hash`

3. **Verify Signature:**
   - Retrieve public key by `signature.key_id` from `/capabilities`
   - Construct `{request, result, receipt}` object
   - Canonical stringify and SHA-256 hash
   - Base64-decode `signature.sig_b64`
   - Verify Ed25519 signature

### 11.2 Verification Endpoint

The `/verify` endpoint performs all checks server-side:

```http
POST /api/v1/verify
Content-Type: application/json

{
  "request": {...},
  "result": {...},
  "receipt": {...},
  "signature": {...}
}
```

Response indicates which checks passed/failed.

---

## 12. Rate Limiting

### 12.1 Rate Limit Headers

Responses include these headers:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests per window |
| `X-RateLimit-Remaining` | Remaining requests in window |
| `X-RateLimit-Reset` | Unix timestamp when window resets |

### 12.2 Sliding Window

Rate limits use a 60-second sliding window.

### 12.3 Two-Tier Limits

**General Limit:** Applies to all requests

**Expensive Limit:** Applies to computation-heavy endpoints:
- `/neighborhood`
- `/gaps`
- `/second-differences`
- `/second-ratios`
- `/formats`
- `/oeis/*`

### 12.4 Rate Limit Exceeded Response

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30

{
  "error": "rate_limit_exceeded",
  "message": "Rate limit exceeded. Try again in 30 seconds.",
  "retry_after": 30
}
```

### 12.5 CPU Time Quota (Free Tier)

Free tier users have a monthly CPU time quota:

| Header | Description |
|--------|-------------|
| `X-CPU-Time-Ms` | CPU time consumed by this request |
| `X-CPU-Time-Remaining-Ms` | Remaining monthly quota |

---

## 13. Error Handling

### 13.1 HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Resource created |
| 202 | Request accepted (async) |
| 400 | Bad request / validation error |
| 401 | Unauthorized (invalid/missing API key) |
| 403 | Forbidden (insufficient tier/permissions) |
| 404 | Resource not found |
| 429 | Rate limit exceeded |
| 500 | Internal server error |
| 503 | Service unavailable |

### 13.2 Error Response Format

```json
{
  "error": "error_code",
  "message": "Human-readable description",
  "details": {},
  "retry_after": 30
}
```

### 13.3 Validation Errors

```json
{
  "error": "validation_error",
  "message": "Invalid query parameters",
  "details": [
    {
      "code": "invalid_type",
      "path": ["n"],
      "message": "Expected string, received undefined"
    },
    {
      "code": "too_small",
      "path": ["k"],
      "message": "Number must be greater than 0"
    }
  ]
}
```

---

## 14. Async Job Processing

### 14.1 Job Lifecycle

```
POST /jobs → pending → running → completed/failed
                ↓           ↓
            GET /jobs/:id  GET /jobs/:id/result
```

### 14.2 Job States

| State | Description |
|-------|-------------|
| `pending` | Job queued, awaiting execution |
| `running` | Job currently executing |
| `completed` | Job finished successfully |
| `failed` | Job failed with error |

### 14.3 Job Limits by Tier

| Tier | Max Concurrent Jobs |
|------|---------------------|
| free | 5 |
| pro | 50 |
| enterprise | 500 |

### 14.4 Job Timeout

Jobs timeout after 5 minutes of execution.

### 14.5 Job Retention

Completed/failed jobs are retained for 24 hours before automatic deletion.

---

## 15. Security Considerations

### 15.1 API Key Security

- Keys are generated with 190+ bits of entropy
- Server stores only SHA-256 hash of keys
- Keys are shown once at creation; cannot be retrieved
- Compromised keys should be revoked immediately

### 15.2 Transport Security

- All endpoints require HTTPS
- TLS 1.2 minimum; TLS 1.3 recommended
- HSTS headers SHOULD be enabled

### 15.3 Signature Verification

- Clients SHOULD always verify signatures for critical applications
- Public keys SHOULD be cached and periodically refreshed
- Key rotation: watch for new keys in `/capabilities`

### 15.4 Rate Limiting

- Prevents abuse and DoS attacks
- IP-based limits for unauthenticated requests
- User-based limits for authenticated requests

---

## 16. IANA Considerations

This document has no IANA actions.

The media type `application/octet-stream` is used for binary responses. A dedicated media type (e.g., `application/vnd.prime-terrain+bin`) MAY be registered in future versions.

---

## 17. References

### 17.1 Normative References

- **RFC 2119** - Key words for use in RFCs
- **RFC 8032** - Edwards-Curve Digital Signature Algorithm (EdDSA)
- **RFC 7515** - JSON Web Signature (JWS)
- **RFC 8259** - The JavaScript Object Notation (JSON) Data Interchange Format

### 17.2 Informative References

- **FIPS 180-4** - Secure Hash Standard (SHA-256)
- **OEIS A000040** - The prime numbers
- **OEIS A001223** - Prime gaps
- **OEIS A036263** - Second differences of primes

---

## Appendix A: Mathematical Definitions

### A.1 Prime Sequence

Let p₀ = 2, p₁ = 3, p₂ = 5, ... be the sequence of prime numbers in ascending order.

### A.2 Gap

The gap at index n is defined as:

```
gₙ = pₙ₊₁ − pₙ
```

### A.3 Second Difference

The second difference at index n is defined as:

```
Δ²ₙ = gₙ − gₙ₋₁ = (pₙ₊₁ − pₙ) − (pₙ − pₙ₋₁) = pₙ₊₁ − 2pₙ + pₙ₋₁
```

### A.4 Second Ratio

The normalized second ratio at index n is:

```
rₙ = Δ²ₙ / (pₙ₊₁ − pₙ₋₁)
```

**Theorem:** For all n ≥ 1, -1 ≤ rₙ ≤ 1.

**Proof:** The span sₙ = pₙ₊₁ − pₙ₋₁ = gₙ + gₙ₋₁. Since gaps are positive:
- Maximum Δ² occurs when gₙ = sₙ (gₙ₋₁ = 0), giving r = 1
- Minimum Δ² occurs when gₙ₋₁ = sₙ (gₙ = 0), giving r = -1

Since gaps cannot be zero (primes are distinct), strict inequality holds for n > 1.

---

## Appendix B: Example Requests

### B.1 Simple Neighborhood Query

**Request:**
```http
GET /api/v1/neighborhood?n=100&n_type=index&mode=count&k=3 HTTP/1.1
Host: fractal-core.com
```

**Response:**
```json
{
  "request": {
    "n": "100",
    "n_type": "index",
    "mode": "count",
    "k": 3,
    "include": ["d2", "gaps", "primes", "ratio"],
    "engine": "sieve",
    "validate": "none",
    "proof": "none",
    "format": "json",
    "compress": "none"
  },
  "result": {
    "n": "100",
    "n_type": "index",
    "mode": "count",
    "center_prime": "547",
    "primes": ["523", "541", "547", "557", "563", "569", "571"],
    "gaps": ["18", "6", "10", "6", "6", "2"],
    "d2": ["-12", "4", "-4", "0", "-4"],
    "ratio": [
      {"num": "-1", "den": "2"},
      {"num": "1", "den": "4"},
      {"num": "-1", "den": "4"},
      {"num": "0", "den": "1"},
      {"num": "-1", "den": "2"}
    ]
  }
}
```

### B.2 Signed Response with Validation

**Request:**
```http
GET /api/v1/neighborhood?n=1000&proof=signed&validate=dual HTTP/1.1
Host: fractal-core.com
Authorization: Bearer frc_a7B3c9D5e1F8g2H4j6K0l8M1n3O9p5Q7
```

**Response:**
```json
{
  "request": {...},
  "result": {...},
  "receipt": {
    "request_hash": "a1b2c3d4e5f6...",
    "result_hash": "f6e5d4c3b2a1...",
    "engines": ["sieve", "mr64"],
    "validation": {
      "mode": "dual",
      "agreement": true
    },
    "deterministic": true,
    "generated_at": "2026-01-27T12:00:00.000Z"
  },
  "signature": {
    "alg": "ed25519",
    "key_id": "primary-2026",
    "signed_hash_alg": "sha256",
    "sig_b64": "..."
  }
}
```

### B.3 Async Job Creation

**Request:**
```http
POST /api/v1/jobs HTTP/1.1
Host: fractal-core.com
Authorization: Bearer frc_a7B3c9D5e1F8g2H4j6K0l8M1n3O9p5Q7
Content-Type: application/json

{
  "n": "1000000000000",
  "n_type": "value",
  "mode": "count",
  "k": 100,
  "proof": "signed"
}
```

**Response:**
```http
HTTP/1.1 202 Accepted

{
  "job_id": "job_abc123def456",
  "status": "pending",
  "poll_url": "/api/v1/jobs/job_abc123def456"
}
```

---

## Appendix C: OEIS Compatibility

### C.1 Supported Sequences

| Endpoint | OEIS ID | Description |
|----------|---------|-------------|
| `/oeis/primes` | A000040 | Prime numbers |
| `/oeis/gaps` | A001223 | Prime gaps |
| `/oeis/d2` | A036263 | Second differences |

### C.2 b-file Format

The `format=bfile` option produces OEIS-compatible b-files:

```
# A000040: Prime numbers
# Data retrieved from Prime Terrain API
1 2
2 3
3 5
4 7
5 11
...
```

### C.3 Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `start` | number | 1 | Starting index |
| `count` | number | 100 | Number of terms |
| `format` | enum | `json` | Output format |

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-27 | Initial specification |

---

*End of RFC-001*
