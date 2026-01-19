# Prime Terrain - Handoff Document

## Project Summary

Prime Terrain is a prime neighborhood explorer with a REST API, minimal GUI, and data visualizations. It computes and serves prime sequences with cryptographic signing, multiple export formats, and OEIS compatibility.

## Live URLs

| Service | URL |
|---------|-----|
| **API** | https://prime-terrain-api.tem-527.workers.dev |
| **GUI** (Pages) | https://fractal-core-c96.pages.dev |
| **Custom Domain** | https://fractal-core.com (pending DNS setup) |

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

## Known Limitations

1. **Sieve limit**: The sieve engine only supports primes up to ~10 million. Values beyond this return 503 errors.
2. **CORS**: Configured to allow all origins (`*`)
3. **No persistent keys**: Ed25519 keys regenerated on cold start

## Recent Changes

- Fixed `n_type=value` to use **next prime ≥ value** (not closest)
- Added frequency statistics to OEIS headers (top 10 d2/ratio values)
- Added starting prime to all OEIS format headers
- Fixed CSS overflow for long data sequences
- Added explicit CORS configuration
- Deployed GUI to Cloudflare Pages

## Pending Tasks

- [ ] Configure custom domain `fractal-core.com` (requires DNS setup in Cloudflare dashboard)
- [ ] Add more primality engines (Miller-Rabin, BPSW) for large values
- [ ] Persistent key storage (Workers KV or D1)
- [ ] Rate limiting
- [ ] Complete 3D terrain visualization testing

## Related OEIS Sequences

- **A000040**: Prime numbers
- **A001223**: Prime gaps
- **A036263**: Second differences of primes

## Notes

- This is a **side project**, separate from main fractal-core work
- The "second ratio" r(n) is a novel sequence not in OEIS
- GUI designed to match OEIS's intentionally minimal aesthetic
