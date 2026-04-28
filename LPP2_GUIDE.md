# LPP2 Protocol Server: Guide

**API Base URL:** `https://api.fractal-core.com/api/v1`
**Source:** `~/fractal-core/api/src/`
**Deploy:** `cd ~/fractal-core/api && npx wrangler@4.79.0 deploy`

---

## Core Concepts

**Pulse**: Global heartbeat at 1-second intervals, each beat advancing to the next prime.

**Residue/Catuskoti**: Four truth-values derived from `prime mod 10`:

| Residue | Channel | Catuskoti | Bits |
|---------|---------|-----------|------|
| 1 | agreement | is | 00 |
| 3 | tension | is_not | 01 |
| 7 | discovery | both | 10 |
| 9 | silence | neither | 11 |

**LPP2 Address**: `LPP::<primeIndex>@<fingerprintHash>/<parity>/<clientDomain>`

**Prime Engine**: Sieve for indices < ~664K, PNT estimate + deterministic Miller-Rabin for larger indices. MR is proven correct up to 3.3 x 10^24.

---

## API Endpoints

### Residue & Channels

```bash
# Current catuskoti channel
GET /lpp/residue
GET /lpp/residue?neighborhood=true&k=10

# At specific index (works at any scale — even 50M+)
GET /lpp/residue/:index

# Next N channels with distribution stats
GET /lpp/channels/schedule?count=24&from=INDEX

# Prime neighborhood with gaps and d2
GET /lpp/neighborhood?k=10&index=INDEX
```

### Pulse

```bash
GET /lpp/pulse              # Current pulse state
GET /lpp/pulse/:index       # Pulse at specific index
GET /lpp/epoch              # Epoch metadata
WS  /lpp/stream             # Live 1-second pulse WebSocket
GET /lpp/stream/status      # WebSocket connection count
```

### Sync

```bash
GET /lpp/sync?sequence=6,-12,4,-4,0&tolerance=1    # Find position by d2 sequence
GET /lpp/fingerprint?prime_index=100&length=4       # Fingerprint at index
```

### Node Registry (D1-backed)

```bash
# CRUD
POST   /lpp2/nodes                    # Register node
GET    /lpp2/nodes                    # List (?client_id, ?node_type, ?status, ?limit, ?offset)
GET    /lpp2/nodes/:id                # Get by ID
PATCH  /lpp2/nodes/:id                # Update metadata
DELETE /lpp2/nodes/:id                # Soft-delete (deregister)

# Operations
POST   /lpp2/nodes/:id/heartbeat     # Liveness signal
POST   /lpp2/nodes/:id/capabilities  # Update capabilities

# Resolution
GET    /lpp2/resolve?address=LPP::100@5599a924/even/post-social.com

# Status
GET    /lpp2/status
```

### Node Registration Body

```json
{
  "clientId": "post-social.com",
  "name": "Frankenstein",
  "endpoint": "https://post-social.com/api/lpp2/callback",
  "nodeType": "book",
  "primeIndex": 100,
  "identity": {
    "embodiedText": "Frankenstein by Mary Shelley",
    "essentialTeachings": ["creation", "responsibility"],
    "voiceProfile": "gothic, introspective"
  },
  "worldModel": {
    "horizon": ["gothic literature", "science ethics"],
    "blindSpots": ["modern technology"],
    "knownNodes": [],
    "networkMemberships": []
  },
  "capabilities": {
    "canConverse": true,
    "canCurate": true,
    "canCite": true,
    "canTransform": false,
    "tools": [],
    "contentTypes": ["response", "curation_article"]
  }
}
```

---

## Architecture

```
api/src/
├── routes/
│   ├── lpp.ts              # Pulse, residue, channels, WebSocket, sync, v1 nodes
│   └── lpp2.ts             # LPP2 node CRUD, resolve, status
├── services/
│   ├── lpp-pulse.ts        # Pulse engine, residue computation, catuskoti mapping
│   ├── lpp2-nodes.ts       # D1-backed node CRUD with KV caching
│   ├── lpp-nodes.ts        # v1 KV-only nodes (backwards compat)
│   ├── lpp-storage.ts      # KV storage layer
│   ├── lpp-sync.ts         # d2 sequence matching, fingerprint hashing
│   └── engines/
│       ├── index.ts        # Unified prime engine (auto-selects sieve/MR/BPSW)
│       ├── sieve.ts        # Sieve of Eratosthenes (up to 10M)
│       ├── miller-rabin.ts # Deterministic MR (up to 3.3e24)
│       └── bpsw.ts         # Baillie-PSW (very large primes)
├── types/
│   ├── lpp.ts              # All LPP/LPP2 types, RESIDUE_MAP constant
│   └── env.ts              # Cloudflare bindings (KV, D1, vars)
├── app.ts                  # Hono app factory, route mounting
└── worker.ts               # Cloudflare Workers entry point
```

**Storage**: D1 is source of truth for nodes. KV caches with 1hr TTL. KV failures are non-fatal.

**D1 Database** (`fractal-core-lpp2`): 7 tables — `lpp2_nodes`, `lpp2_networks`, `lpp2_network_members`, `lpp2_conversations`, `lpp2_exchanges`, `lpp2_pulse_log`, `lpp2_edges`. Networks/conversations tables are schema-ready for sessions 2-4.

**Auth**: `frc_` API keys for write ops (not yet enforced on LPP2 routes). Read endpoints are public.

---

## Deployment Notes

- **Use wrangler 4.79.0** — version 4.81.1 has a silent deploy bug
- Build: `npm run build` (TypeScript → dist/)
- Deploy: `npx wrangler@4.79.0 deploy`
- Workers.dev URL: `https://prime-terrain-api.tem-527.workers.dev`
- Custom domain: `https://api.fractal-core.com`

---

## Upcoming (Sessions 2-4)

| Session | Feature |
|---------|---------|
| 2 | Network CRUD, join/leave, topology queries, gateway nodes |
| 3 | Conversation orchestrator, cron triggers, client callbacks |
| 4 | Admin API, admin UI, topology visualization |

---

## Pulse Systems

**Disambiguation, important.** "Lamish Pulse" refers to *two distinct things* in this codebase:

| Concept | Endpoint | Anchor | Tick | Purpose |
|---|---|---|---|---|
| **Protocol Pulse** | `/api/v1/lpp/*` | Worker boot | 1 second | Network addressing & catuskoti channels (RFC-002) |
| **Pulse Systems** (cosmic, tonga, yad, milli) | `/api/v1/pulse/{system}/*` | Published anchor per system | Per system | Cryptographically signed temporal stamps for HFWS |

The Protocol Pulse continues to serve LPP/LPP2 internal addressing. The Pulse Systems API is what HFWS clients (humanizer, post-social, gravity-press, temnoon) call to mint signed temporal proofs.

### What a Pulse System is

Each system is a `(anchor_iso, age_before_anchor_seconds, tick_unit_seconds, mint_cadence, signing_key)` tuple. The clock value `T` is the integer number of ticks since `(anchor_iso - age_before_anchor_seconds)`. The minted prime `P` is a separately-drawn random prime in a published bit-class — `T` orders mints in time, `P` uniquely identifies each act of minting.

Four canonical systems ship in `api/src/services/time-systems.ts`:

| System | Anchor | Tick | Cadence | Default bits |
|---|---|---|---|---|
| `cosmic` | 16×10⁹ Julian years before Carrington 1859-09-01T11:18:00Z | Planck (5.391247×10⁻⁴⁴ s) | fresh per mint | 256 |
| `tonga` | ~74,000 years before J2000 (Toba) | 86,400 s (one day) | one per tick (cached) | 256 |
| `yad` | J2000-01-01T12:00:00Z | sidereal-year/512/61637 ≈ 1.000016 s | one per tick (cached) | 256 |
| `milli` | 2026-01-01T00:00:00Z | 0.001 s | fresh per mint | 256 |

### Endpoints

```bash
GET  /api/v1/pulse                              # list systems + signing keys
GET  /api/v1/pulse/{system_id}/parameters       # describe a system (federation-ready)
GET  /api/v1/pulse/{system_id}/now?verbose=...  # public signed pulse
POST /api/v1/pulse/{system_id}/mint             # auth required, target_domain bound
POST /api/v1/pulse/{system_id}/verify           # verify a SignedPulse
```

### Mint request body

```json
{
  "target_domain": "post-social.com",
  "target_node": "LPP::100@5599a924/even/post-social.com",
  "bit_target": 256,
  "nonce": "0123456789abcdef0123456789abcdef",
  "purpose": "channel-anchor",
  "ttl_seconds": 300,
  "verbose": false
}
```

`nonce` must be 32 hex chars; `bit_target` is 64..512 (default per system); `verbose` includes the audit trail showing every PNT calculation, window edge, and Miller-Rabin attempt.

### Algorithm

```
T  = floor((now - anchor_unix + age_before_anchor_s) / tick_unit_s)
p_T_estimate = T × (ln T + ln ln T - 1 + (ln ln T - 2)/ln T)         # PNT
if bit_target ≤ bits(p_T_estimate):
  prime_estimate = p_T_estimate
else:
  prime_estimate = secureRandom([2^(bit_target-1), 2^bit_target))    # climb up
candidate = secureRandom([prime_estimate - 2^119, prime_estimate + 2^119))
candidate |= 1
while not BPSW(candidate): candidate += 2
sign canonical(time_system, request, pulse, receipt) with Ed25519
```

### Federation

Anyone can stand up their own pulse system: pick an anchor, pick a tick unit, generate an Ed25519 key pair, expose `/parameters`, sign with `signCanonical`. Verifiers need only your `time_system` block and the public key. The four systems on fractal-core are *one operator's* instances of the protocol.

### Files

- `api/src/types/pulse.ts` — TimeSystemDescriptor, MintedPulse, MintReceipt, SignedPulse, AuditBlock
- `api/src/services/time-systems.ts` — 4-system registry + display formatters + constants
- `api/src/services/pulse-mint.ts` — tick computation, PNT estimate, secureRandomBigInt, mintPulse
- `api/src/services/pulse-cache.ts` — KV-backed one-per-tick cache
- `api/src/routes/pulse.ts` — generic /pulse/{system_id}/{mint|now|verify|parameters}
- `api/src/crypto/signing.ts` — `signCanonical` / `verifyCanonicalSignature` (generic counterparts to `signResponse`)
- `public/pulse.html` — live demo page; one card per system
- `public/terrain.html` — landing page positioning fractal-core as the temporal standard
- `public/cosmic-pulse.html` — redirect to `/pulse#cosmic` for backward-compat with humanizer team's reference URL

### Disclosure

The static pages and `/parameters` payload include this disclosure: *"Code authored with the assistance of language models. The API itself and this interface use no AI agent at runtime — only deterministic prime mathematics and Ed25519 signing."*
