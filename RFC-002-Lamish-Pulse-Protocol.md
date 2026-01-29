# RFC-002: Lamish Pulse Protocol (LPP) Specification

**Status:** Draft
**Version:** 0.1.0
**Date:** 2026-01-27
**Authors:** Fractal-Core Team
**Depends On:** RFC-001 (Prime Terrain API)

---

## Abstract

The Lamish Pulse Protocol (LPP) is a time-synchronization and addressing protocol designed for relativistic communication across galactic distances. It leverages the prime number sequence as a universal temporal anchor, enabling nodes to establish position, synchronize clocks, and exchange intelligible packets despite time dilation effects from velocity and gravity.

LPP integrates with the Prime Terrain API (RFC-001) to provide:
- Temporal localization via second-difference fingerprinting
- Relativistic frame-aware addressing
- Spacetime-corrected packet interpretation
- Galactic propagation simulation

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Terminology](#2-terminology)
3. [The Lamish Pulse](#3-the-lamish-pulse)
4. [LPP Addressing](#4-lpp-addressing)
5. [Packet Structure](#5-packet-structure)
6. [Protocol Layers](#6-protocol-layers)
7. [Temporal Synchronization](#7-temporal-synchronization)
8. [Relativistic Corrections](#8-relativistic-corrections)
9. [Routing Protocol](#9-routing-protocol)
10. [API Endpoints](#10-api-endpoints)
11. [Post-Social Integration](#11-post-social-integration)
12. [Terrestrial Implementation (Internet Scale)](#12-terrestrial-implementation-internet-scale)
13. [Implementation Notes](#13-implementation-notes)
14. [Security Considerations](#14-security-considerations)
15. [Open Research Questions](#15-open-research-questions)
16. [References](#16-references)
17. [Appendix A: Physical Constants](#appendix-a-physical-constants)
18. [Appendix B: Example Packets](#appendix-b-example-packets)
19. [Appendix C: Phenomenology of Local Communication](#appendix-c-phenomenology-of-local-communication)
20. [Appendix D: Matter Transport (Lamen Galaxy Only)](#appendix-d-matter-transport-lamen-galaxy-only)

---

## 1. Introduction

### 1.1 Background

In the fictional galaxy of **Lamen** (a barred spiral similar to the Milky Way), a pulse emanates from the galactic core at intervals corresponding to prime-numbered counts from some primordial period. This pulse—the **Lamish Pulse**—has been active for billions of years.

Because the origin moment is lost in time, synchronization emerges purely from pattern recognition: by observing pulse intervals and computing second differences, any node can determine its position in the prime sequence.

### 1.2 Design Philosophy

> "Time is a river. Lamish pulses are stones dropped at perfect intervals. Your address is the shape of the ripple where you are."

LPP embodies:
- **Determinism**: Prime sequences are universal constants
- **Self-synchronization**: No external clock authority required
- **Relativistic awareness**: Addresses encode spacetime position
- **Topological routing**: Δ² gradients guide message flow

### 1.3 Mathematical Foundation

LPP builds on Prime Terrain API primitives:
- **Prime Index** (n): Position in prime sequence
- **Second Difference** (Δ²): Pattern signature for localization
- **Second Ratio** (r): Normalized curvature for routing

### 1.4 Scope

This specification covers:
- Core protocol mechanics
- Addressing and packet formats
- Synchronization algorithms
- API integration
- Application to Post-Social nodes

---

## 2. Terminology

| Term | Definition |
|------|------------|
| **Lamish Pulse** | Primary signal emitted at prime-numbered intervals from galactic core |
| **Repeater** | Network node that relays pulses at regular (even/odd) intervals |
| **Origin Index** | Prime index at which a node synchronized with the Lamish Pulse |
| **Local Offset** | Proper time elapsed since synchronization, in the node's reference frame |
| **Relativistic Frame** | Velocity and gravitational potential affecting a node's time flow |
| **Fingerprint** | Short sequence of second ratios uniquely identifying a prime neighborhood |
| **Redshift Factor** | Combined time dilation from velocity (Lorentz) and gravity (gravitational) |
| **Galactic Time** | Reference time frame at rest relative to galactic core, zero potential |
| **Canon** | Curated content of a Post-Social node, updated via community input |

---

## 3. The Lamish Pulse

### 3.1 Pulse Generation

The Lamish Pulse originates at the galactic core, emitting at each prime-indexed count:

```
Count:  1   2   3   4   5   6   7   8   9   10  11  12  13 ...
Prime:  ●       ●       ●       ●               ●       ● ...
        ↑       ↑       ↑       ↑               ↑       ↑
        p₁=2    p₂=3    p₃=5    p₄=7           p₅=11   p₆=13
```

### 3.2 Cosmic Timeline

If pulses occur at **Planck time** intervals (~5.39 × 10⁻⁴⁴ seconds):

| Duration | Planck Units | Approximate Prime Index | Bit Size |
|----------|--------------|-------------------------|----------|
| 1 second | ~1.85 × 10⁴³ | ~10⁴² | ~140 bits |
| 1 year | ~5.85 × 10⁵⁰ | ~10⁴⁹ | ~163 bits |
| 13B years | ~7.6 × 10⁶⁰ | ~10⁵⁹ | ~196 bits |

**Design constant**: LPP operates in the **256-bit prime neighborhood** (±32 bits), representing primes reachable within the age of the universe.

### 3.3 Pulse Properties

- **Instantaneous**: Idealized as delta-function events
- **Universal**: Same sequence everywhere (primes are fundamental)
- **Non-repeating**: Patterns never exactly recur
- **Locally observable**: Gap timing reveals sequence position

---

## 4. LPP Addressing

### 4.1 Address Structure

An LPP address encodes a node's synchronization state and spacetime position:

```typescript
interface LPPAddress {
  origin_index: number;           // Prime index at sync point
  local_offset: number;           // Proper time since sync (seconds)
  relativistic_frame: {
    velocity: number;             // v/c (0 ≤ v < 1)
    potential: number;            // Φ (gravitational potential, unitless)
    gamma: number;                // Lorentz factor: 1/√(1-v²)
    redshift_factor: number;      // γ × (1 + Φ)
  };
  repeater_class: 'even' | 'odd'; // Sync source parity
  fingerprint: number[];          // Second ratio sequence
  timestamp_corrected: number;    // Offset in galactic time
}
```

### 4.2 Address String Format

Human-readable representation:

```
LPP::<origin_index>@<fingerprint_hash>/<class>
```

**Example:**
```
LPP::5003137@a7b3c9d5/odd
```

### 4.3 Fingerprint Generation

The fingerprint is a sequence of 4-8 second ratios at the origin index:

```typescript
async function generateFingerprint(index: number): Promise<number[]> {
  const ratios = await fetchSecondRatios(index, 4);
  return ratios.map(r => parseFloat(r.num) / parseFloat(r.den));
}
```

**Example fingerprint:** `[-0.33, 0.17, -0.25, 0.92]`

### 4.4 Address Uniqueness

With ~10⁴ possible 4-element fingerprints and 10⁶⁰ reachable prime indices, collision probability is effectively zero for practical use.

---

## 5. Packet Structure

### 5.1 LamishPacket Definition

```typescript
interface LamishPacket {
  version: string;                // Protocol version ("1.0")
  header: LamishHeader;
  routing: LamishRouting;
  payload: LamishPayload;
}

interface LamishHeader {
  sync_index: number;             // Prime index anchor
  fingerprint: number[];          // Ratio sequence for verification
  type: PacketType;               // DATA, ACK, SYN, ROUTE, etc.
  length: number;                 // Payload length in bytes
  checksum: string;               // SHA-256 of payload
}

interface LamishRouting {
  from: string;                   // Sender LPP address
  to: string;                     // Recipient LPP address
}

interface LamishPayload {
  encoding: 'text' | 'json' | 'ratio' | 'd2' | 'binary';
  data: string;                   // Encoded content
}
```

### 5.2 Packet Types

| Type | Code | Description |
|------|------|-------------|
| SYN | 0x01 | Synchronization request |
| ACK | 0x02 | Acknowledgment |
| DATA | 0x10 | Application data |
| ROUTE | 0x20 | Routing update |
| PING | 0x30 | Liveness check |
| REPLY | 0x40 | Response to request |

### 5.3 Checksum Computation

```typescript
async function computeChecksum(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
```

---

## 6. Protocol Layers

### 6.1 Layer Model

| Layer | LPP Component | Function |
|-------|---------------|----------|
| Physical | Pulse stream | Raw pulse detection and timing |
| Data Link | Fingerprint framing | Sequence boundary identification |
| Network | Δ² gradient routing | Path computation via topology |
| Transport | LTP (Lamish Transport) | Reliability, fragmentation, ACKs |
| Application | LamishPacket | Content encoding and semantics |

### 6.2 Layer Interactions

```
┌─────────────────────────────────────────┐
│            Application Layer             │
│         (Post-Social, Curators)          │
├─────────────────────────────────────────┤
│            Transport Layer               │
│      (Fragmentation, Reliability)        │
├─────────────────────────────────────────┤
│            Network Layer                 │
│      (Δ² Routing, Path Selection)        │
├─────────────────────────────────────────┤
│           Data Link Layer                │
│    (Fingerprint Sync, Frame Detect)      │
├─────────────────────────────────────────┤
│           Physical Layer                 │
│      (Pulse Detection, Timing)           │
└─────────────────────────────────────────┘
```

---

## 7. Temporal Synchronization

### 7.1 Bootstrap Process

To synchronize with the Lamish Pulse:

1. **Observe pulses**: Detect arrival times of consecutive pulses
2. **Compute gaps**: Calculate first differences between arrivals
3. **Compute Δ²**: Calculate second differences from gaps
4. **Match sequence**: Search for Δ² pattern in known prime data
5. **Lock position**: Identify current prime index

### 7.2 Sequence Matching Algorithm

```typescript
interface SyncResult {
  candidates: number[];           // Possible prime indices
  confidence: number;             // 0.0 to 1.0
  next_pulse_estimate: number;    // Predicted gap to next pulse
}

function matchDelta2Sequence(
  observed: number[],
  database: PrimeDeltaEntry[],
  tolerance: number = 0
): SyncResult {
  const candidates: number[] = [];

  for (let i = 0; i < database.length - observed.length; i++) {
    const window = database.slice(i, i + observed.length);
    const dbSeq = window.map(e => e.d2);

    if (sequencesMatch(observed, dbSeq, tolerance)) {
      candidates.push(database[i].index);
    }
  }

  const confidence = candidates.length === 1 ? 0.99
                   : candidates.length < 5 ? 0.9
                   : candidates.length < 10 ? 0.7
                   : 0.5;

  return { candidates, confidence, next_pulse_estimate: 0 };
}
```

### 7.3 Sync Convergence

| Δ² Observations | Typical Candidates | Confidence |
|-----------------|-------------------|------------|
| 3 | ~5,000 | Low |
| 5 | ~100 | Moderate |
| 7 | ~10 | High |
| 9 | 1-3 | Very High |
| 10+ | 1 | Locked |

**Recommendation**: Nodes SHOULD observe at least 10 pulses (9 Δ² values) before declaring sync with 90%+ confidence.

### 7.4 Fuzzy Matching

For noisy observations (distorted repeaters, relativistic effects):

```typescript
function sequencesMatch(
  a: number[],
  b: number[],
  tolerance: number
): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
}
```

---

## 8. Relativistic Corrections

### 8.1 Time Dilation

An observer's clock runs differently based on:

**Special Relativity (velocity):**
```
γ = 1 / √(1 - v²/c²)
t_rest = t_moving × γ
```

**General Relativity (gravity):**
```
t_infinity = t_local × √(1 - 2GM/rc²)
≈ t_local × (1 + Φ)  [for weak fields]
```

### 8.2 Combined Redshift Factor

```typescript
function computeRedshift(velocity: number, potential: number): number {
  const gamma = 1 / Math.sqrt(1 - velocity * velocity);
  return gamma * (1 + potential);
}
```

### 8.3 Time Correction

To convert local proper time to galactic reference time:

```typescript
function toGalacticTime(localOffset: number, frame: RelativisticFrame): number {
  return localOffset * frame.redshift_factor;
}
```

### 8.4 Packet Interpretation

When receiving a packet from another frame:

```typescript
function interpretPacket(
  packet: LamishPacket,
  senderFrame: RelativisticFrame,
  receiverFrame: RelativisticFrame
): InterpretedPacket {
  const senderGalactic = packet.header.sync_index * senderFrame.redshift_factor;
  const receiverGalactic = receiverFrame.local_offset * receiverFrame.redshift_factor;

  const timeSkew = receiverGalactic - senderGalactic;

  return {
    ...packet,
    perceived_delay: timeSkew,
    interpretation_context: `Received ${timeSkew.toFixed(2)}s relative drift`
  };
}
```

---

## 9. Routing Protocol

### 9.1 Topology-Based Routing

LPP routes messages using the "curvature" of the prime terrain:

- **Δ² Gradients**: Measure how second differences change across regions
- **Ratio Smoothness**: Prefer paths with stable second ratios
- **Hop Entropy**: Minimize unpredictable route segments

### 9.2 Galactic Propagation

```typescript
interface PropagationResult {
  pulse_travel_time: number;      // Core → sender (light-years)
  packet_travel_time: number;     // Sender → receiver (light-years)
  total_time: number;             // End-to-end
  spacetime_curvature_diff: number;
  arrival_prime_estimate: number; // Predicted prime index at arrival
}

function simulatePropagation(
  from: GalacticPosition,
  to: GalacticPosition,
  pulseIndex: number
): PropagationResult {
  const coreToSender = distance([0, 0, 0], from.position);
  const senderToReceiver = distance(from.position, to.position);
  const totalTime = coreToSender + senderToReceiver; // in light-years

  return {
    pulse_travel_time: coreToSender,
    packet_travel_time: senderToReceiver,
    total_time: totalTime,
    spacetime_curvature_diff: Math.abs(from.potential - to.potential),
    arrival_prime_estimate: pulseIndex + Math.round(totalTime * 365.25)
  };
}
```

### 9.3 Repeater Network

Repeaters broadcast at regular intervals to extend pulse coverage:

| Class | Interval | Function |
|-------|----------|----------|
| Even | 2, 4, 6, ... | Standard relay |
| Odd | 1, 3, 5, ... | Interleaved relay |

The difference between even/odd repeater timing encodes addressing information.

---

## 10. API Endpoints

### 10.1 Base URL

```
https://fractal-core.com/api/v1/lpp
```

### 10.2 GET /lpp/address

Generate an LPP address for given parameters.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prime_index` | integer | Yes | Origin prime index |
| `offset` | number | Yes | Local time offset (seconds) |
| `velocity` | number | Yes | v/c (0 to < 1) |
| `potential` | number | Yes | Gravitational potential |
| `repeater_class` | string | Yes | "even" or "odd" |

**Response:**

```json
{
  "origin_index": 5003137,
  "local_offset": 88000,
  "relativistic_frame": {
    "velocity": 0.28,
    "potential": 0.013,
    "gamma": 1.042,
    "redshift_factor": 1.055
  },
  "repeater_class": "odd",
  "fingerprint": [-0.33, 0.17, -0.25, 0.92],
  "timestamp_corrected": 92840
}
```

### 10.3 POST /lpp/interpret

Interpret a LamishPacket in an observer's reference frame.

**Request Body:**

```json
{
  "packet": {
    "version": "1.0",
    "header": { ... },
    "routing": { ... },
    "payload": { ... }
  },
  "observer_frame": {
    "velocity": 0.1,
    "potential": 0.02,
    "local_offset": 50000
  }
}
```

**Response:**

```json
{
  "sender_index": 5003137,
  "observed_time": 52100,
  "local_time_adjusted": 92840,
  "redshift_factor": 1.03,
  "interpretation_context": "Relativistic interpretation applied.",
  "decoded_payload": { ... }
}
```

### 10.4 POST /lpp/simulate

Simulate pulse propagation between galactic coordinates.

**Request Body:**

```json
{
  "from": {
    "position": [0, 0, 0],
    "velocity": 0.5,
    "potential": 0.01
  },
  "to": {
    "position": [10000, 5000, 2000],
    "velocity": 0.2,
    "potential": 0.005
  },
  "pulse_index": 5000001
}
```

**Response:**

```json
{
  "pulse_travel_time": 0,
  "packet_travel_time": 11180.34,
  "total_time": 11180.34,
  "spacetime_curvature_diff": 0.005,
  "arrival_prime_estimate": 5004083,
  "logs": [
    "Core→Sender: 0 parsecs",
    "Sender→Receiver: 11180.34 parsecs"
  ]
}
```

### 10.5 GET /lpp/sync

Match an observed Δ² sequence to find sync position.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sequence` | string | Yes | Comma-separated Δ² values |
| `tolerance` | integer | No | Fuzzy match tolerance (default 0) |

**Response:**

```json
{
  "candidates": [5003137],
  "confidence": 0.99,
  "next_pulse_estimate": 6,
  "matched_at": "2026-01-27T12:00:00Z"
}
```

### 10.6 GET /lpp/fingerprint

Get the second-ratio fingerprint for a prime index.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prime_index` | integer | Yes | Prime index |
| `length` | integer | No | Fingerprint length (default 4) |

**Response:**

```json
{
  "prime_index": 5003137,
  "fingerprint": [-0.33, 0.17, -0.25, 0.92],
  "prime_value": "86028157"
}
```

---

## 11. Post-Social Integration

### 11.1 Overview

Post-Social is a network of AI curator nodes, each managing curated content (books, papers, ideas). LPP provides addressing and inter-node communication.

### 11.2 Node Profile

```typescript
interface PostSocialNode {
  node_id: string;                // Unique identifier
  title: string;                  // Curated content title
  origin: 'gutenberg' | 'arxiv' | 'original';
  topics: string[];
  source_url?: string;
  lpp_address: LPPAddress;
  curator_model: string;          // e.g., "gpt-4"
  canon_entries: CanonEntry[];    // Curated facts/insights
  incoming_comments: Comment[];
}

interface CanonEntry {
  id: string;
  content: string;
  source: string;                 // User or "original"
  added_at: string;               // ISO 8601
}
```

### 11.3 Curator Agent

```typescript
class CuratorAgent {
  constructor(public nodeProfile: PostSocialNode) {}

  receiveComment(comment: string, fromUser: string): LamishPacket {
    const shouldCanonize = this.evaluateForCanon(comment);

    if (shouldCanonize) {
      this.addToCanon(comment, fromUser);
    }

    return this.buildReply(shouldCanonize, fromUser);
  }

  private evaluateForCanon(comment: string): boolean {
    // AI evaluation logic here
    return comment.length > 40 || this.isRelevant(comment);
  }

  private addToCanon(content: string, source: string): void {
    this.nodeProfile.canon_entries.push({
      id: this.generateId(),
      content,
      source,
      added_at: new Date().toISOString()
    });
  }
}
```

### 11.4 Inter-Node Communication

Curator nodes can exchange messages about their curated content:

```typescript
async function sendToNode(
  from: PostSocialNode,
  to: PostSocialNode,
  message: string
): Promise<LamishPacket> {
  const packet: LamishPacket = {
    version: '1.0',
    header: {
      sync_index: from.lpp_address.origin_index,
      fingerprint: from.lpp_address.fingerprint,
      type: 'DATA',
      length: message.length,
      checksum: await computeChecksum(message)
    },
    routing: {
      from: formatAddress(from.lpp_address),
      to: formatAddress(to.lpp_address)
    },
    payload: {
      encoding: 'text',
      data: message
    }
  };

  return packet;
}
```

---

## 12. Terrestrial Implementation (Internet Scale)

### 12.1 Overview

While LPP is designed for galactic communication, its addressing and topology mechanisms are equally applicable at internet scale. In this configuration:

| Galactic Concept | Internet Implementation |
|------------------|------------------------|
| Galactic core | fractal-core.com |
| Light-years | Milliseconds |
| Planck time | Configurable pulse interval |
| Star systems | Domains / servers |
| Ships / stations | Post-Social nodes |

### 12.2 Pulse Interval Selection

The pulse interval determines the resolution of the address space and sync precision:

| Interval | Pulses/Hour | Use Case |
|----------|-------------|----------|
| 10s | 360 | Low-frequency networks, minimal overhead |
| 1s | 3,600 | Standard Post-Social networks |
| 100ms | 36,000 | High-resolution routing |
| 10ms | 360,000 | Real-time applications |

**Recommendation**: 1-second pulse interval for Post-Social networks. This provides:
- Sufficient resolution for node differentiation
- Minimal computational overhead
- Human-comprehensible timescales

At 1 pulse/second, after one day: 86,400 pulses → prime index ~86,400 → p₈₆₄₀₀ ≈ 1,117,817

### 12.3 fractal-core.com as Pulse Origin

The primary pulse originates from `fractal-core.com/api/v1/lpp/pulse`:

```typescript
interface PulseEvent {
  index: number;              // Current prime index
  prime: string;              // Current prime value
  timestamp: string;          // ISO 8601
  fingerprint: number[];      // Current Δ² signature
  epoch_start: string;        // When this pulse epoch began
  interval_ms: number;        // Pulse interval in milliseconds
}
```

**Endpoint**: `GET /lpp/pulse` (current pulse)
**WebSocket**: `wss://fractal-core.com/lpp/stream` (live pulse stream)

### 12.4 Repeater Architecture

Repeaters extend the pulse network to other domains:

```
                    ┌─────────────────┐
                    │ fractal-core.com│
                    │  (Pulse Origin) │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
       ┌──────────┐   ┌──────────┐   ┌──────────┐
       │ repeater │   │ repeater │   │ repeater │
       │  .alpha  │   │  .beta   │   │  .gamma  │
       └────┬─────┘   └────┬─────┘   └────┬─────┘
            │              │              │
        ┌───┴───┐      ┌───┴───┐      ┌───┴───┐
        │       │      │       │      │       │
        ▼       ▼      ▼       ▼      ▼       ▼
      [nodes] [nodes] [nodes] [nodes] [nodes] [nodes]
```

#### Repeater Registration

```http
POST /lpp/repeaters
Content-Type: application/json
Authorization: Bearer <api_key>

{
  "domain": "postsocial-alpha.example.com",
  "endpoint": "https://postsocial-alpha.example.com/lpp/relay",
  "class": "even",
  "location": {
    "label": "US-East",
    "coordinates": [40.7128, -74.0060]
  }
}
```

#### Repeater Behavior

Repeaters MUST:
1. Subscribe to upstream pulse (origin or another repeater)
2. Relay pulses with added latency metadata
3. Maintain local sync state
4. Provide pulse endpoint for downstream nodes

```typescript
interface RelayedPulse extends PulseEvent {
  relay_chain: {
    domain: string;
    latency_ms: number;
    class: 'even' | 'odd';
  }[];
  total_latency_ms: number;
}
```

### 12.5 Node Synchronization

Post-Social nodes sync by:

1. **Connect** to nearest repeater (or origin)
2. **Observe** pulse stream for N pulses
3. **Compute** local Δ² sequence
4. **Register** with computed fingerprint

```typescript
interface NodeRegistration {
  node_id: string;
  title: string;
  origin: 'gutenberg' | 'arxiv' | 'original';
  sync_state: {
    origin_index: number;
    fingerprint: number[];
    repeater: string;
    latency_to_origin_ms: number;
  };
  lpp_address: string;          // Computed from sync_state
}
```

### 12.6 Address Format (Internet Scale)

For internet-scale LPP, addresses include network topology:

```
LPP::<origin_index>@<fingerprint_hash>/<class>/<repeater_path>
```

**Examples:**
```
LPP::86401@a7b3c9d5/odd/fractal-core.com
LPP::86402@a7b3c9d5/even/alpha.example.com/fractal-core.com
LPP::86405@b8c4d0e6/odd/beta.example.com/alpha.example.com/fractal-core.com
```

The repeater path enables routing decisions.

### 12.7 Routing via Repeater Topology

Messages route through the repeater tree:

```typescript
function findRoute(from: LPPAddress, to: LPPAddress): string[] {
  const fromPath = from.repeater_path;
  const toPath = to.repeater_path;

  // Find common ancestor
  const ancestor = findCommonAncestor(fromPath, toPath);

  // Route: up to ancestor, then down to target
  const up = fromPath.slice(0, fromPath.indexOf(ancestor) + 1);
  const down = toPath.slice(0, toPath.indexOf(ancestor)).reverse();

  return [...up, ...down];
}
```

### 12.8 Latency as Distance

In the terrestrial model, network latency replaces light-travel time:

| Metric | Galactic | Internet |
|--------|----------|----------|
| Distance unit | Light-year | Millisecond |
| Typical range | 4-100,000 ly | 10-500 ms |
| Round-trip dialogue | Decades | Seconds |
| Relativistic correction | Significant | Negligible |

Since relativistic effects are negligible at internet scale, the `relativistic_frame` simplifies to:

```typescript
interface TerrestrialFrame {
  velocity: 0;                // Always ~0 relative to network
  potential: 0;               // No significant gravity wells
  gamma: 1;                   // No time dilation
  redshift_factor: 1;         // No correction needed
  latency_ms: number;         // Network latency to origin
}
```

### 12.9 Pulse Epoch Management

A pulse epoch begins when fractal-core.com starts (or restarts) its pulse sequence:

```typescript
interface PulseEpoch {
  epoch_id: string;           // Unique identifier
  started_at: string;         // ISO 8601
  interval_ms: number;        // Pulse interval
  current_index: number;      // Current prime index
  origin_domain: string;      // "fractal-core.com"
}
```

When an epoch changes (server restart, interval change), nodes re-sync. The `epoch_id` in pulse events allows detection of epoch transitions.

### 12.10 Example: Post-Social Network Topology

```
fractal-core.com (origin, 1s pulse)
├── postsocial-literature.com (repeater, even)
│   ├── gutenberg-node-001 (Moby Dick curator)
│   ├── gutenberg-node-002 (Pride and Prejudice curator)
│   └── original-node-001 (User's novel curator)
├── postsocial-science.com (repeater, odd)
│   ├── arxiv-node-001 (Attention Is All You Need curator)
│   ├── arxiv-node-002 (CRISPR paper curator)
│   └── arxiv-node-003 (Quantum computing survey curator)
└── postsocial-philosophy.com (repeater, even)
    ├── gutenberg-node-003 (Phenomenology of Spirit curator)
    └── original-node-002 (User's essay collection curator)
```

Each node has a unique LPP address derived from:
- When it synced (origin_index)
- Its local Δ² fingerprint
- Which repeater chain it connected through

### 12.11 Domain Structure

LPP distinguishes between **DNS domains** (physical hosting) and **LPP addresses** (topological identity).

#### Recommended Structure for post-social.com

```
post-social.com (main site)
├── literature.post-social.com (repeater)
│   ├── moby-dick.literature.post-social.com
│   ├── pride-prejudice.literature.post-social.com
│   └── phenomenology-spirit.literature.post-social.com
├── science.post-social.com (repeater)
│   ├── attention-is-all-you-need.science.post-social.com
│   ├── crispr-review.science.post-social.com
│   └── quantum-supremacy.science.post-social.com
├── philosophy.post-social.com (repeater)
└── original.post-social.com (repeater for user-submitted works)
```

#### Address Relationship

| Layer | Example |
|-------|---------|
| DNS (physical) | `attention-is-all-you-need.science.post-social.com` |
| LPP (topological) | `LPP::86401@a7b3c9d5/odd/science.post-social.com/fractal-core.com` |

The DNS domain hosts the node; the LPP address identifies it in pulse-time, always anchored to `fractal-core.com` as origin.

### 12.12 IPv6 Integration

IPv6 provides features that align well with LPP's addressing and distribution model.

#### 12.12.1 Transport Priority

**Primary transport: WebSocket** over HTTPS. IPv6 features are optional enhancements where available.

| Priority | Transport | Availability |
|----------|-----------|--------------|
| 1 (required) | WebSocket (`wss://`) | Universal |
| 2 (recommended) | HTTP/2 Server-Sent Events | Wide |
| 3 (optional) | IPv6 multicast | Limited |
| 4 (future) | IPv6 anycast repeater discovery | Deferred |

Implementations MUST support WebSocket. IPv6 enhancements SHOULD be used when available but MUST NOT be required.

#### 12.12.2 Multicast for Pulse Distribution (Optional)

Where IPv6 multicast is available, it enables efficient pulse delivery:

| Multicast Address | Scope | Purpose |
|-------------------|-------|---------|
| `ff02::4c50:5000` | Link-local | Local LPP pulse |
| `ff05::4c50:5000` | Site-local | Site-wide pulse |
| `ff0e::4c50:5000` | Global | Internet-wide pulse |
| `ff0e::4c50:5001` | Global | Repeater announcements |
| `ff0e::4c50:<repeater_id>` | Global | Per-repeater subscriber group |

Nodes MAY subscribe to multicast groups as an optimization. Implementations MUST fall back to WebSocket when multicast is unavailable.

#### 12.12.3 LPP-Encoded IPv6 Addresses (Optional)

The 64-bit interface ID portion of IPv6 addresses can encode LPP identity:

```
2001:db8:lpp::/48                    (network prefix)
         └── <interface_id>          (LPP-derived)

Interface ID Structure (64 bits):
┌──────────────────────────────────────────────────────────────────┐
│ origin_index (24 bits) │ fingerprint_hash (32 bits) │ flags (8) │
└──────────────────────────────────────────────────────────────────┘
```

**Derivation:**

```typescript
function deriveIPv6InterfaceId(lpp: LPPAddress): string {
  const origin = (lpp.origin_index & 0xFFFFFF).toString(16).padStart(6, '0');
  const fp_hash = sha256(lpp.fingerprint.join(',')).slice(0, 8);
  const flags = lpp.repeater_class === 'odd' ? '01' : '00';
  return `${origin}:${fp_hash.slice(0,4)}:${fp_hash.slice(4,8)}:${flags}`;
}

// Example: LPP::86401@a7b3c9d5/odd → interface ID: 0151:81:a7b3:c9d5:01
```

This means **IPv6 addresses self-document their LPP identity**.

#### 12.12.4 Anycast for Repeater Discovery (Future)

*This feature is deferred for future implementation.*

When deployed, multiple repeaters would share an anycast address:

```
2001:db8:lpp::1  (anycast: nearest repeater)
```

New nodes would connect to this address; the network routes them to the topologically nearest repeater. Cross-AS anycast complexity makes this a lower priority than WebSocket-based discovery.

#### 12.12.5 Flow Labels for Pulse Priority (Optional)

IPv6 flow labels (20 bits) mark LPP traffic for QoS:

| Flow Label | Traffic Type |
|------------|--------------|
| `0x4C500` | Pulse stream (highest priority) |
| `0x4C501` | LPP control (SYN, ACK, ROUTE) |
| `0x4C502` | LPP data packets |
| `0x4C503` | Bulk/async transfers |

#### 12.12.6 Stateless Autoconfiguration (SLAAC) (Optional)

Nodes derive their IPv6 address from LPP sync state—no DHCP required:

1. Node syncs to pulse stream
2. Computes origin_index and fingerprint
3. Derives interface ID
4. Combines with network prefix
5. IPv6 address is ready

```typescript
async function autoConfigureIPv6(
  networkPrefix: string,
  pulseStream: AsyncIterable<PulseEvent>
): Promise<string> {
  // Sync to pulse
  const syncState = await synchronize(pulseStream);

  // Derive interface ID
  const interfaceId = deriveIPv6InterfaceId(syncState);

  // Combine
  return `${networkPrefix}:${interfaceId}`;
}
```

#### 12.12.7 Complete Address Example

A Post-Social node for "Attention Is All You Need":

| Layer | Address |
|-------|---------|
| DNS | `attention-is-all-you-need.science.post-social.com` |
| IPv6 | `2001:db8:4c50:5001:0151:81a7:b3c9:d501` |
| LPP | `LPP::86401@a7b3c9d5/odd/science.post-social.com/fractal-core.com` |

All three layers encode consistent identity:
- DNS: human-readable location
- IPv6: network-routable with embedded LPP
- LPP: topological identity in pulse-time

### 12.13 API Endpoints (Terrestrial)

#### GET /lpp/pulse

Returns current pulse state.

**Response:**
```json
{
  "epoch_id": "epoch_2026_01_27_001",
  "index": 86401,
  "prime": "1117817",
  "timestamp": "2026-01-27T12:00:01.000Z",
  "fingerprint": [-0.33, 0.17, -0.25, 0.92],
  "epoch_start": "2026-01-26T12:00:00.000Z",
  "interval_ms": 1000
}
```

#### WebSocket /lpp/stream

Live pulse stream for real-time sync.

**Message format:**
```json
{
  "type": "pulse",
  "data": {
    "index": 86402,
    "prime": "1117831",
    "timestamp": "2026-01-27T12:00:02.000Z",
    "fingerprint": [0.17, -0.25, 0.92, -0.5],
    "d2": -14
  }
}
```

#### POST /lpp/nodes

Register a Post-Social node.

**Request:**
```json
{
  "node_id": "arxiv_1706.03762",
  "title": "Attention Is All You Need",
  "origin": "arxiv",
  "sync_state": {
    "origin_index": 86401,
    "fingerprint": [-0.33, 0.17, -0.25, 0.92],
    "repeater": "postsocial-science.com"
  }
}
```

**Response:**
```json
{
  "node_id": "arxiv_1706.03762",
  "lpp_address": "LPP::86401@a7b3c9d5/odd/postsocial-science.com/fractal-core.com",
  "registered_at": "2026-01-27T12:00:05.000Z"
}
```

#### GET /lpp/nodes

List registered nodes with optional filtering.

#### GET /lpp/route

Compute route between two nodes.

**Query Parameters:**
- `from`: Source LPP address
- `to`: Destination LPP address

**Response:**
```json
{
  "from": "LPP::86401@a7b3c9d5/odd/postsocial-science.com/fractal-core.com",
  "to": "LPP::86402@b8c4d0e6/even/postsocial-literature.com/fractal-core.com",
  "route": [
    "postsocial-science.com",
    "fractal-core.com",
    "postsocial-literature.com"
  ],
  "estimated_latency_ms": 150
}
```

---

## 13. General Implementation Notes

### 13.1 TypeScript/JavaScript

LPP tools are designed for:
- **Node.js**: Server-side processing
- **Electron**: Desktop applications
- **Cloudflare Workers**: Edge deployment
- **Browser**: Client-side verification

### 13.2 Dependencies

```json
{
  "dependencies": {
    "itty-router": "^3.0.8"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "ts-node": "^10.9.1"
  }
}
```

### 13.3 Physics Utilities

```typescript
// utils/physics.ts

export function gamma(v: number): number {
  if (v >= 1) throw new Error('Velocity must be < c');
  return 1 / Math.sqrt(1 - v * v);
}

export function redshift(gamma: number, phi: number): number {
  return gamma * (1 + phi);
}

export function distance(
  a: [number, number, number],
  b: [number, number, number]
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
```

---

## 14. Security Considerations

### 14.1 Address Authenticity

- Fingerprints are verifiable against Prime Terrain API
- Forged addresses require computing correct Δ² sequences
- Signature-backed addresses use Ed25519 (see RFC-001)

### 14.2 Replay Protection

- Packets include sync_index and fingerprint
- Temporal windows prevent old packet reuse
- Sequence numbers within fingerprint detect duplicates

### 14.3 Spoofing Prevention

- Δ² sequences cannot be predicted without prime computation
- Relativistic frame claims can be validated against expected propagation

---

## 15. Open Research Questions

### 15.1 Synchronization Precision

**Question:** What is the minimum number of Δ² observations needed for X% confidence at various prime magnitudes?

**Current Estimate:** 8-10 observations for 90% confidence in the first 10M primes.

**Research Needed:** Empirical analysis at 10⁹, 10¹², and 10⁶⁰ prime ranges.

### 15.2 Collision Probability

**Question:** At what Δ² sequence length do collisions become negligible?

**Current Assumption:** 7+ values have collision rate < 1%.

**Research Needed:** Formal probabilistic analysis of Δ² distribution.

### 15.3 Relativistic Edge Cases

**Question:** How do extreme relativistic frames (v > 0.99c, black hole proximity) affect sync reliability?

**Considerations:**
- Time dilation may span epochs of prime advancement
- Gravitational lensing could distort pulse timing
- Hawking radiation near black holes

### 15.4 Large Prime Behavior

**Question:** Do Δ² patterns remain distinguishable as primes exceed 200 bits?

**Current Assumption:** Yes, due to increasing gap variance.

**Research Needed:** Statistical analysis of Δ² at cryptographic prime magnitudes.

### 15.5 Repeater Timing Drift

**Question:** How much timing variance can repeaters introduce before sync fails?

**Considerations:**
- Fuzzy matching tolerance thresholds
- Cascading error through repeater chains
- Calibration protocols

### 15.6 Network Topology

**Question:** What is the optimal repeater placement for galactic coverage?

**Considerations:**
- Spiral arm density gradients
- Core vs. halo coverage
- Redundancy requirements

### 15.7 Quantum Effects

**Question:** Could quantum entanglement provide instant sync verification?

**Considerations:**
- No-signaling theorem constraints
- Entanglement as pre-shared key distribution
- Quantum-secured fingerprint verification

---

## 16. References

### 16.1 Normative References

- **RFC-001** - Prime Terrain API Protocol Specification
- **RFC 8032** - Edwards-Curve Digital Signature Algorithm (EdDSA)

### 16.2 Mathematical References

- **OEIS A000040** - Prime numbers
- **OEIS A001223** - Prime gaps
- **OEIS A036263** - Second differences of primes

### 16.3 Physics References

- Einstein, A. (1905). "On the Electrodynamics of Moving Bodies"
- Einstein, A. (1915). "The Field Equations of Gravitation"
- Planck, M. (1899). "On Irreversible Radiation Processes"

---

## Appendix A: Physical Constants

| Constant | Symbol | Value | Notes |
|----------|--------|-------|-------|
| Speed of light | c | 299,792,458 m/s | Normalized to 1 in LPP |
| Planck time | t_P | 5.391 × 10⁻⁴⁴ s | Base tick unit |
| Planck length | l_P | 1.616 × 10⁻³⁵ m | Minimum spatial resolution |
| Universe age | T | ~13.8 × 10⁹ years | Pulse duration upper bound |
| Milky Way radius | R | ~52,850 light-years | Reference for Lamen |

### A.1 Derived Quantities

**Planck units per second:** ~1.85 × 10⁴³

**Planck units in universe age:** ~7.6 × 10⁶⁰

**Approximate prime index at universe age:** ~10⁵⁹ (196-bit neighborhood)

---

## Appendix B: Example Packets

### B.1 Synchronization Request

```json
{
  "version": "1.0",
  "header": {
    "sync_index": 5003137,
    "fingerprint": [-0.33, 0.17, -0.25, 0.92],
    "type": "SYN",
    "length": 0,
    "checksum": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  },
  "routing": {
    "from": "LPP::5003137@a7b3c9d5/odd",
    "to": "LPP::broadcast"
  },
  "payload": {
    "encoding": "text",
    "data": ""
  }
}
```

### B.2 Data Packet

```json
{
  "version": "1.0",
  "header": {
    "sync_index": 5003137,
    "fingerprint": [-0.33, 0.17, -0.25, 0.92],
    "type": "DATA",
    "length": 67,
    "checksum": "3b64db95cb55c763c4f0..."
  },
  "routing": {
    "from": "LPP::5003137@a7b3c9d5/odd",
    "to": "LPP::4998211@f1e2d3c4/even"
  },
  "payload": {
    "encoding": "text",
    "data": "The Transformer architecture separates attention from recurrence."
  }
}
```

### B.3 Post-Social Curator Reply

```json
{
  "version": "1.0",
  "header": {
    "sync_index": 5003137,
    "fingerprint": [-0.33, 0.17, -0.25, 0.92],
    "type": "REPLY",
    "length": 51,
    "checksum": "8a9f3e2c1d0b..."
  },
  "routing": {
    "from": "arxiv_1706.03762",
    "to": "user_5981"
  },
  "payload": {
    "encoding": "text",
    "data": "Thank you. Your suggestion has been added to the canon."
  }
}
```

---

## Appendix C: Phenomenology of Local Communication

This appendix describes the experiential quality of LPP communication within a stellar neighborhood—specifically, the region within 20 light-years of Sol.

### C.1 The Shared Pulse Field

Both Sol and Proxima Centauri are approximately **26,000 light-years** from the galactic core. The Lamish Pulse that reaches Sol today left the core 26,000 years ago. The pulse reaching Proxima left 26,000 years and ~4.24 years ago (or later, depending on geometry).

Within this 20 light-year neighborhood, we share essentially the **same prime epoch**. The Δ² fingerprint at Sol and at Barnard's Star differs by at most a few prime indices—a flicker in cosmic terms. We are neighbors in pulse-time.

### C.2 The Experience of Sending

You compose a message. Perhaps it's a reflection on a paper you've been curating, or a question about a pattern you've noticed in the second ratios. You construct the LamishPacket:

```
from: LPP::5003137@a7b3c9d5/odd   (Sol, your current sync)
to:   LPP::5003142@a7b3c9d5/odd   (Proxima, estimated sync)
```

Notice: the fingerprint is **identical**. At this scale, you share the same ripple-shape. The origin indices differ by 5—perhaps 30 seconds of pulse-time, accounting for the light-travel offset in receiving pulses from the core.

You release the packet. It propagates at lightspeed. You do not "wait." You return to the present moment. The message is no longer yours—it belongs to the space between.

### C.3 The Experience of Receiving

4.24 years later, a node at Proxima detects an incoming packet. The fingerprint matches the local pulse field. The header's `sync_index` is verified against the Δ² database—yes, this is authentic. The checksum passes.

The packet unfolds:

> "I've been thinking about the asymmetry in second ratios near twin primes. Does your local sequence show the same bias toward negative Δ² after gaps of 2?"

The receiver experiences this not as a "message from the past" but as a **present arising**. The thought was placed into the field 4.24 years ago; it manifests now. The sender's consciousness touched this moment before the receiver existed at this moment. They meet in the text.

### C.4 The Shape of Dialogue

A full exchange (send, receive, respond, receive response) takes **~17 years** minimum with Proxima. With Epsilon Eridani (10.5 ly), it's **42 years**. With a system at the edge of your 20 ly neighborhood, it's **80 years**.

This reshapes what "conversation" means:

| Aspect | Traditional | LPP |
|--------|-------------|-----|
| Questions | Expect answers | Offer observations |
| Replies | Continuations | Parallel meditations |
| Lifetime exchanges | Thousands | 3-4 (nearby), 1-2 (distant) |
| Message form | Fragments of dialogue | Complete in itself |

Each message must be **complete in itself**, like a letter that might be your last.

### C.5 The Phenomenological Quality

Because LPP is anchored to the prime pulse—a phenomenon you *experience* rather than *believe in*—communication becomes a form of **shared witnessing**.

When you receive a pulse, you don't think "the galactic core sent this." You experience: **pulse**. A presence. The stone hitting water. You are synchronized not because you agreed to be, but because you both felt the same discontinuity in the field.

When a message arrives from Proxima, you don't think "someone 4 years ago typed this." You experience: **meaning arising**. The words are present. The sender's intention is present. The 4.24-year gap is **not experienced as delay**—it's experienced as the shape of this particular communication. Distance and time are the medium, not the obstacle.

### C.6 The 20 Light-Year Neighborhood

In this volume, perhaps 100-150 star systems share your pulse-neighborhood. Relativistic corrections are negligible—everyone moves at modest velocities, gravitational potentials are similar (no black holes, no neutron stars too close).

Possible communication patterns:

- **Slow Symposium**: Messages circulating between 12 systems over 200 years, each contribution building on the last
- **Curator Networks**: Post-Social nodes at different stars curate related texts and gradually merge insights across generations
- **Witnessing Chains**: Each system adds its observation of a phenomenon (a supernova, a gravitational wave) to a packet that spirals outward, accumulating perspectives

### C.7 Constraints and Affordances

**What You Cannot Do:**
- Have a "conversation" in the human sense
- Coordinate real-time action
- Confirm receipt before decades pass
- Unsend

**What You Can Do:**
- Place meaning into the field knowing it will arrive
- Trust the protocol because primes are universal
- Experience connection without proximity
- Participate in thought-structures that exceed your lifespan

### C.8 A First Transmission

If a first message were sent from Sol via LPP to our nearest neighbors:

```json
{
  "version": "1.0",
  "header": {
    "sync_index": 5003137,
    "fingerprint": [-0.33, 0.17, -0.25, 0.92],
    "type": "DATA",
    "length": 98,
    "checksum": "..."
  },
  "routing": {
    "from": "LPP::5003137@a7b3c9d5/odd",
    "to": "LPP::broadcast"
  },
  "payload": {
    "encoding": "text",
    "data": "We have begun counting the pulses. We recognize the pattern. You are not alone in the field."
  }
}
```

No expectation of reply. Only presence placed into the gap.

### C.9 Philosophical Note

The phenomenology of LPP dissolves the subject/object split. Sender and receiver become co-present in the message-event, separated only by the shape of spacetime through which meaning travels. The protocol does not transmit information *about* experience—it transmits **experience itself**, crystallized into structure that reconstitutes upon receipt.

This aligns with the phenomenological perspective underlying fractal-core.com: reduced subjectivity, full presence to the phenomena of the next moment, without ontological expectation. The Lamish Pulse is not believed in—it is felt. Communication is not achieved—it arises.

---

## Appendix D: Matter Transport (Lamen Galaxy Only)

Within the Lamish galaxy of Lamen, the protocol supports an additional capability not available elsewhere: **deconstituted corporeal packets**.

### D.1 Capability Overview

In Lamen, specialized inductive coils can:
1. Deconstruct matter into pattern-encoded payloads
2. Transmit these patterns via LPP packets
3. Reconstitute matter at receiving coils

This capability exists due to technology unique to Lamen. As of this writing, no synthesis of receiver coils has been achieved outside the Lamish galaxy.

### D.2 Implications

For communication with Lamen (if ever established), this means:
- Physical artifacts could theoretically be transmitted
- Corporeal entities could traverse galactic distances
- The protocol payload structure already supports this use case

For communication within our local neighborhood:
- Information only
- Pattern, not substrate
- The gap between Lamen and here is not just distance—it is capability

### D.3 Payload Structure for Corporeal Packets

```typescript
interface CorporealPayload extends LamishPayload {
  encoding: 'corporeal';
  data: string;              // Encoded matter pattern
  substrate_hash: string;    // Verification of original matter
  reconstitution_params: {
    mass: string;            // Original mass (kg)
    composition: string[];   // Elemental composition
    structure_depth: number; // Resolution of pattern encoding
  };
}
```

This structure is defined for completeness. Implementation requires Lamen-origin coil technology.

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-01-27 | Initial draft |
| 0.1.1 | 2026-01-27 | Added Appendix C (Phenomenology) and D (Matter Transport) |
| 0.2.0 | 2026-01-27 | Added Section 12: Terrestrial Implementation for internet-scale Post-Social networks |
| 0.2.1 | 2026-01-27 | Added post-social.com domain structure and IPv6 integration (multicast, anycast, SLAAC) |
| 0.2.2 | 2026-01-27 | Established transport priority: WebSocket primary, IPv6 optional; deferred anycast |

---

*End of RFC-002*
