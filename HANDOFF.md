# Prime Terrain - Handoff Document

## Project Summary

Prime Terrain is a prime neighborhood explorer with a REST API and minimal GUI. It computes and serves prime sequences with cryptographic signing, multiple export formats, and OEIS compatibility.

**Live API**: https://prime-terrain-api.tem-527.workers.dev

## Repository Structure

```
fractal-core/
├── api/                    # Backend API (Cloudflare Workers)
│   ├── src/
│   │   ├── index.ts        # Node.js entry point
│   │   ├── worker.ts       # Cloudflare Workers entry point
│   │   ├── app.ts          # Hono app factory
│   │   ├── routes/         # API endpoints
│   │   ├── services/       # Business logic
│   │   ├── crypto/         # Signing & hashing
│   │   ├── encoding/       # Varint, zigzag, binary format
│   │   ├── types/          # TypeScript types
│   │   └── schemas/        # Zod validation
│   ├── tests/              # 95 tests (unit + integration)
│   ├── wrangler.toml       # Cloudflare config
│   └── package.json
├── gui.html                # Minimal OEIS-style web interface
├── index.html              # Physics-based visualization (existing)
└── CLAUDE.md               # Project instructions
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `/api/v1/status` | Health check |
| `/api/v1/capabilities` | Features & limits |
| `/api/v1/neighborhood` | Full neighborhood data |
| `/api/v1/gaps` | Prime gaps only |
| `/api/v1/second-differences` | Δ² values only |
| `/api/v1/second-ratios` | Normalized ratios only |
| `/api/v1/fingerprint` | Hashes without payload |
| `/api/v1/verify` | Verify signatures |
| `/api/v1/jobs` | Async job queue |
| `/api/v1/oeis/*` | OEIS-compatible output |
| `/api/v1/formats` | Multi-format export |

## Export Formats (13 total)

- **Tabular**: CSV, TSV
- **CAS**: PARI/GP, Mathematica, SageMath, Maple
- **LaTeX**: inline, table, array
- **Programming**: NumPy, R, Julia
- **Semantic**: JSON-LD
- **OEIS**: b-file, list, internal

## Mathematical Model

```
Gap:        g(n) = p(n+1) - p(n)
Second diff: d2(n) = g(n+1) - g(n)
Second ratio: r(n) = d2(n) / (p(n+2) - p(n))   # always in [-1, 1]
```

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono 4.x
- **Crypto**: @noble/ed25519, @noble/hashes
- **Validation**: Zod
- **Testing**: Vitest
- **Deployment**: Wrangler 4.x

## Commands

```bash
cd api
npm install          # Install dependencies
npm run dev          # Local dev server (Node.js)
npm run dev:worker   # Local Workers dev
npm test             # Run 95 tests
npm run deploy       # Deploy to Cloudflare
```

## Key Implementation Details

1. **Lazy key initialization** - Keys generated on first access, not module load (Workers requirement)
2. **Web Crypto API** - Uses `crypto.getRandomValues()` instead of Node.js `randomBytes`
3. **btoa/atob for base64** - No Node.js `Buffer` (Workers compatibility)
4. **No compress middleware** - Cloudflare handles compression at edge

## Potential Enhancements

- [ ] Add more primality engines (Miller-Rabin, BPSW)
- [ ] Persistent key storage (Workers KV or D1)
- [ ] Rate limiting
- [ ] Caching layer
- [ ] Binary format response option
- [ ] WebSocket for streaming large results
- [ ] More sequence types (twin primes, Sophie Germain, etc.)
- [ ] GUI improvements (graphs, search history)
- [ ] Custom domain setup

## Related OEIS Sequences

- **A000040**: Prime numbers
- **A001223**: Prime gaps
- **A036263**: Second differences of primes

## Notes

- This is a **side project**, separate from main fractal-core work
- The "second ratio" r(n) is a novel sequence not in OEIS
- GUI designed to match OEIS's intentionally minimal aesthetic
