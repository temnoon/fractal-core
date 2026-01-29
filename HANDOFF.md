# Prime Terrain - Handoff Document

## Project Summary

Prime Terrain is a prime neighborhood explorer with a REST API, minimal GUI, and data visualizations. It computes and serves prime sequences with cryptographic signing, multiple export formats, and OEIS compatibility.

## Live URLs

| Service | URL |
|---------|-----|
| **API** | https://api.fractal-core.com |
| **API** (workers.dev) | https://prime-terrain-api.tem-527.workers.dev |
| **GUI** | https://fractal-core.com |
| **GUI** (www) | https://www.fractal-core.com |
| **GUI** (pages.dev) | https://fractal-core-c96.pages.dev |

## Repository Structure

```
fractal-core/
├── api/                    # Backend API (Cloudflare Workers)
│   ├── src/
│   │   ├── index.ts        # Node.js entry point
│   │   ├── worker.ts       # Cloudflare Workers entry point
│   │   ├── app.ts          # Hono app factory (CORS config here)
│   │   ├── routes/         # API endpoints (11 route files)
│   │   ├── services/       # Business logic
│   │   ├── crypto/         # Signing & hashing
│   │   ├── encoding/       # Varint, zigzag, binary format
│   │   ├── types/          # TypeScript types
│   │   └── schemas/        # Zod validation
│   ├── tests/              # 99 tests (unit + integration)
│   ├── wrangler.toml       # Cloudflare config
│   └── package.json
├── public/                 # Static site for Cloudflare Pages
│   ├── index.html          # GUI (OEIS Explorer) - homepage
│   ├── flames.html         # Flame fractal genome generator
│   ├── player.html         # WebGL flame player (browser-based renderer)
│   ├── svg.html            # SVG fractal gallery (6 visualization modes)
│   ├── simulation.html     # Physics-based visualization
│   └── visualizations.html # 2D/3D data visualizations
├── gui.html                # Source GUI file
├── index.html              # Source physics visualization
├── visualizations.html     # Source data visualizations
├── HANDOFF.md              # This file
└── CLAUDE.md               # Project instructions
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `/api/v1/status` | Health check |
| `/api/v1/capabilities` | Features, limits, signing keys |
| `/api/v1/neighborhood` | Full neighborhood data (main endpoint) |
| `/api/v1/gaps` | Prime gaps only |
| `/api/v1/second-differences` | d2 values only |
| `/api/v1/second-ratios` | Ratios only |
| `/api/v1/fingerprint` | Hashes without payload |
| `/api/v1/verify` | Verify signatures (POST) |
| `/api/v1/jobs` | Async job queue |
| `/api/v1/oeis/*` | OEIS-compatible output (b-file, list, JSON) |
| `/api/v1/formats` | Multi-format export (13 formats) |
| `/api/v1/flame` | Flame fractal genome generator (flam3 XML) |
| `/api/v1/flame/info` | Flame generator documentation |
| `/api/v1/flame/preview` | Preview flame data without download |
| `/api/v1/svg` | SVG vector fractal generator (6 modes) |
| `/api/v1/svg/info` | SVG generator documentation |
| `/api/v1/svg/gallery` | Gallery of all modes for a prime |

## Key Parameters (neighborhood endpoint)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `n` | required | Prime index or value (bigint string) |
| `n_type` | `index` | `index` (p(n)) or `value` (next prime ≥ n) |
| `k` | 10 | Neighbors each side |
| `include` | all | `primes,gaps,d2,ratio,indices` |
| `proof` | `none` | `none`, `receipt`, `signed` |

## Export Formats (13 total)

CSV, TSV, PARI/GP, Mathematica, SageMath, Maple, LaTeX (3 variants), NumPy, R, Julia, JSON-LD

## Mathematical Model

```
Gap:           g(n) = p(n+1) - p(n)
Second diff:   d2(n) = g(n+1) - g(n)
Second ratio:  r(n) = d2(n) / (p(n+2) - p(n))   ∈ [-1, 1]
```

## Tech Stack

- **API Runtime**: Cloudflare Workers
- **API Framework**: Hono 4.x
- **Crypto**: @noble/ed25519, @noble/hashes
- **Validation**: Zod
- **Testing**: Vitest (99 tests)
- **Static Site**: Cloudflare Pages
- **Visualizations**: Plotly.js

## Commands

```bash
# API
cd api
npm install
npm run dev          # Local dev server
npm test             # Run 99 tests
npm run deploy       # Deploy to Cloudflare Workers

# Static Site
npx wrangler pages deploy public --project-name=fractal-core
```

## Primality Engines

| Engine | Range | Method |
|--------|-------|--------|
| Sieve | Up to 10 million | Sieve of Eratosthenes (O(1) lookup) |
| Miller-Rabin | Up to ~10^24 | Deterministic with known witnesses |
| BPSW | Arbitrarily large | Baillie-PSW (no known counterexamples) |

The unified `primeEngine` automatically selects the best engine based on input size.

## Known Limitations

1. **Large indices**: For indices > 500,000, use async jobs endpoint for chunked processing
2. **CORS**: Configured to allow all origins (`*`)
3. **Rate limits**: 100 req/min general, 20 req/min for computation-heavy endpoints

## Recent Changes (2026-01-29: LPP Session)

### Lamish Pulse Protocol (LPP) — Full Implementation

**RFC**: `RFC-002-Lamish-Pulse-Protocol.md` — complete protocol specification
**Source conversation**: `/Users/tem/Downloads/Lamish Pulse Protocols/conversation.json`

#### New Files Created
| File | Purpose |
|------|---------|
| `api/src/types/lpp.ts` | All LPP type definitions (PulseEvent, LPPAddress, LamishPacket, PostSocialNode, etc.) |
| `api/src/services/lpp-pulse.ts` | Pulse epoch management, fingerprint generation, KV-backed |
| `api/src/services/lpp-sync.ts` | Δ² sequence matching (bidirectional: sequence→prime and prime→sequence) |
| `api/src/services/lpp-nodes.ts` | Node/repeater CRUD, routing, topology (all async/KV-backed) |
| `api/src/services/lpp-storage.ts` | KV persistence layer with in-memory fallback |
| `api/src/routes/lpp.ts` | All LPP endpoints + WebSocket pulse stream |

#### Modified Files
| File | Change |
|------|--------|
| `api/src/types/env.ts` | Added `LPP_KV` binding |
| `api/src/app.ts` | Imported and mounted `/lpp` route at `/api/v1/lpp` |
| `api/wrangler.toml` | Added `LPP_KV` namespace (needs real ID) |

#### LPP Endpoints (all under `/api/v1/lpp`)
| Endpoint | Description |
|----------|-------------|
| `GET /lpp/pulse` | Current pulse state |
| `GET /lpp/pulse/:index` | Pulse at specific index |
| `GET /lpp/epoch` | Epoch info |
| `WSS /lpp/stream` | Live WebSocket pulse stream (1s interval) |
| `GET /lpp/stream/status` | Connected client count |
| `GET /lpp/sync?sequence=...` | Match Δ² sequence to prime position |
| `GET /lpp/fingerprint?prime_index=...` | Get fingerprint at index |
| `GET /lpp/address?prime_index=...` | Generate LPP address |
| `POST /lpp/repeaters` | Register repeater |
| `GET /lpp/repeaters` | List repeaters |
| `POST /lpp/nodes` | Register Post-Social node |
| `GET /lpp/nodes` | List nodes (filterable) |
| `GET /lpp/route?from=...&to=...` | Compute route between nodes |
| `GET /lpp/topology` | Network summary |
| `GET /lpp/storage` | KV stats (debug) |

#### Key Design Decisions
- **Pulse interval**: 1 second
- **Transport**: WebSocket primary, IPv6 optional enhancement
- **Domain structure**: `*.post-social.com` subdomains as repeaters, LPP addresses anchor to `fractal-core.com`
- **256-bit prime neighborhood**: Cosmic scale reference (13B years at Planck time)
- **KV storage**: Cloudflare KV with in-memory fallback

#### Architecture
```
fractal-core.com (pulse origin, 1s heartbeat)
├── /api/v1/lpp/stream         ← WebSocket pulse
├── science.post-social.com    (repeater)
│   └── arxiv_1706.03762       (Attention Is All You Need curator)
├── literature.post-social.com (repeater)
│   └── gutenberg nodes        (books)
└── philosophy.post-social.com (repeater)
```

#### What Remains
- [ ] `wrangler kv:namespace create LPP_KV` → update ID in wrangler.toml
- [ ] Deploy and test endpoints
- [ ] Add auth requirement to POST endpoints (registration)
- [ ] Add LPP to capabilities response
- [ ] Test WebSocket in production
- [ ] Build client that syncs to pulse stream
- [ ] Register first repeater and first Post-Social node
- [ ] Curator agent implementation (comment→canon flow)
- [ ] Post-Social web UI
- [ ] Seed 100 Gutenberg/ArXiv nodes

#### TypeScript compiles clean (`npx tsc --noEmit` passes)

---

## Previous Changes (Miller-Rabin/BPSW Session)

- **Miller-Rabin & BPSW Engines**: Added probabilistic primality testing for large primes
  - Miller-Rabin with deterministic witnesses up to ~10^24
  - BPSW (Baillie-PSW) for arbitrarily large numbers
  - Unified `primeEngine` auto-selects best method
- **Persistent Key Storage**: Ed25519 signing keys now persist in Workers KV
  - Keys survive cold starts and deployments
  - Key info exposed in `/api/v1/capabilities` response
- **Rate Limiting**: IP-based rate limiting with configurable limits
  - 100 req/min general limit
  - 20 req/min for computation-heavy endpoints (neighborhood, oeis, formats, flame, svg)
  - Headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
- **Enhanced 3D Visualization**: Improved terrain surface plot
  - Proper surface rendering with contours
  - Binned averaging for smoother terrain
  - Scatter overlay for actual data points
- **Chunked Sieve**: Large calculation support via async jobs
  - Indices > 500,000 processed in chunks
  - State persistence with KV for multi-request processing
  - BPSW used for finding large primes

## Previous Changes

- **Flame Fractal Generator**: `/api/v1/flame` generates flam3 XML genomes
- **WebGL Flame Player**: Browser-based renderer at `/player`
- **SVG Fractal Generator**: 6 visualization modes at `/api/v1/svg`
- Custom domains: fractal-core.com, www.fractal-core.com, api.fractal-core.com
- Fixed `n_type=value` to use next prime ≥ value
- OEIS frequency statistics and starting prime headers

## Completed Tasks

- [x] Configure custom domains
- [x] Add Miller-Rabin and BPSW primality engines
- [x] Persistent key storage (Workers KV)
- [x] Rate limiting
- [x] Complete 3D terrain visualization
- [x] Large calculation handoff (chunked sieve)

## Related OEIS Sequences

- **A000040**: Prime numbers
- **A001223**: Prime gaps
- **A036263**: Second differences of primes

## Notes

- This is a **side project**, separate from main fractal-core work
- The "second ratio" r(n) is a novel sequence not in OEIS
- GUI designed to match OEIS's intentionally minimal aesthetic
