# Fractal-Core Project Memory

## Repository Structure
- `api/` - Prime Terrain API (Hono + TypeScript ESM + zod, runs on Cloudflare Workers or Node)
- `noema-rho-api/` - Noema-Rho API (Hono + TypeScript ESM + zod + pg, Node server)
- `index.html` - Prime Neighborhood Navigator visualization
- `public/` - Static pages (flames, player, svg, visualizations)

## Noema-Rho API
- **Purpose**: Event-sourced Noema graph + Rho sentencing engine based on Husserl's phenomenology
- **DB**: Local Postgres `noema_rho` on port 5432, user `tem`
- **Run**: `DATABASE_URL="postgresql://tem@localhost:5432/noema_rho" npm run dev` (port 3001)
- **Base URL**: `http://localhost:3001/v1`
- **Key endpoints**: `/health`, `/capabilities`, `/lenses`, `/noema/*`, `/docs/*`, `/rho/sentence_step`, `/rho/timeline/object/:id`, `/rho/snapshot`, `/rho/drift/top`
- **Current state**: v1 stub - sentence_step creates provisional Concept objects; real NER/object resolution + act detection + rho update rules still TODO
- **Designed from**: ChatGPT conversation "Noema Model Functional Spec" (GPT-5-2-thinking)
- **Next steps**: Real sentence_step() logic (object resolution, relation extraction, salience decay), SIC packs, branching

## Patterns
- Both APIs use `createApp()` factory pattern with Hono
- ESM modules (`"type": "module"`, `.js` extensions in imports)
- `@hono/node-server` for local dev, can port to Workers later
