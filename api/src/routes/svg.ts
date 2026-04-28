/**
 * SVG Fractal Route
 *
 * Generates vector fractal art from prime terrain data.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { primeEngine } from '../services/engines/index.js';
import { generateSvg, SvgInput, SvgGenOptions } from '../services/svg-generator.js';

export const svgRoute = new Hono();

const svgQuerySchema = z.object({
  n: z.string().transform((val) => BigInt(val)),
  n_type: z.enum(['index', 'value']).default('index'),
  // k is half-window. 500 → 1001 primes, matches the cosmic-pulse renderer's
  // density (which accepts up to 1200 primes via /lpp/cosmic/render).
  k: z.coerce.number().int().min(5).max(500).default(20),
  mode: z.enum(['tree', 'spiral', 'mandala', 'walk', 'burst', 'wave']).default('mandala'),
  width: z.coerce.number().int().min(100).max(4096).default(800),
  height: z.coerce.number().int().min(100).max(4096).default(800),
  color: z.enum(['prime', 'fire', 'ice', 'mono', 'rainbow']).default('prime'),
  stroke: z.coerce.number().min(0.5).max(10).default(1.5),
  background: z.string().default('#0a0e14'),
});

// Info endpoint
svgRoute.get('/info', (c) => {
  return c.json({
    name: 'Prime Terrain SVG Generator',
    version: '1.0.0',
    description: 'Generates vector fractal art from prime neighborhood second differences and ratios',
    modes: {
      tree: 'Recursive branching tree - d2 drives angles, ratios drive lengths',
      spiral: 'Multi-arm spiral - d2 modulates angle, ratios modulate radius',
      mandala: 'Symmetric circular pattern - d2 drives symmetry and petal size',
      walk: 'Turtle graphics walk - d2 is turn angle, ratio is step length',
      burst: 'Radial ray burst - d2 drives ray length, ratios drive decorations',
      wave: 'Wave interference pattern - d2/ratios define wave sources',
    },
    parameters: {
      n: { type: 'bigint', required: true, description: 'Prime index or value' },
      n_type: { type: 'string', default: 'index', options: ['index', 'value'] },
      k: { type: 'integer', default: 20, min: 5, max: 500, description: 'Neighborhood size (primes each side; total = 2k+1)' },
      mode: { type: 'string', default: 'mandala', options: ['tree', 'spiral', 'mandala', 'walk', 'burst', 'wave'] },
      width: { type: 'integer', default: 800, description: 'SVG width' },
      height: { type: 'integer', default: 800, description: 'SVG height' },
      color: { type: 'string', default: 'prime', options: ['prime', 'fire', 'ice', 'mono', 'rainbow'] },
      stroke: { type: 'number', default: 1.5, description: 'Base stroke width' },
      background: { type: 'string', default: '#0a0e14', description: 'Background color' },
    },
    examples: [
      '/api/v1/svg?n=1000&mode=mandala',
      '/api/v1/svg?n=500&mode=tree&color=fire',
      '/api/v1/svg?n=10000&mode=spiral&color=rainbow',
      '/api/v1/svg?n=100&mode=burst&color=ice',
    ],
  });
});

// Main SVG generation endpoint
svgRoute.get('/', async (c) => {
  const rawQuery = {
    n: c.req.query('n'),
    n_type: c.req.query('n_type'),
    k: c.req.query('k'),
    mode: c.req.query('mode'),
    width: c.req.query('width'),
    height: c.req.query('height'),
    color: c.req.query('color'),
    stroke: c.req.query('stroke'),
    background: c.req.query('background'),
  };

  // Remove undefined values
  const cleanQuery = Object.fromEntries(
    Object.entries(rawQuery).filter(([_, v]) => v !== undefined)
  );

  const parseResult = svgQuerySchema.safeParse(cleanQuery);

  if (!parseResult.success) {
    return c.json(
      {
        error: 'Invalid parameters',
        details: parseResult.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
      400
    );
  }

  const params = parseResult.data;

  try {
    // Get prime neighborhood data
    let centerIndex: number;
    let centerPrime: bigint;

    if (params.n_type === 'index') {
      centerPrime = primeEngine.primeAtIndex(Number(params.n));
      centerIndex = Number(params.n);
    } else {
      const result = primeEngine.nextPrime(params.n);
      centerIndex = result.index ?? 0;
      centerPrime = result.prime;
    }

    // Get neighborhood primes
    const neighborhood = primeEngine.primesAroundIndex(centerIndex, params.k);
    const primes = neighborhood.primes;

    // Calculate gaps
    const gaps: bigint[] = [];
    for (let i = 1; i < primes.length; i++) {
      gaps.push(primes[i] - primes[i - 1]);
    }

    // Calculate second differences
    const d2: bigint[] = [];
    for (let i = 1; i < gaps.length; i++) {
      d2.push(gaps[i] - gaps[i - 1]);
    }

    // Calculate ratios
    const ratios: { num: bigint; den: bigint }[] = [];
    for (let i = 0; i < d2.length && i + 2 < primes.length; i++) {
      const span = primes[i + 2] - primes[i];
      ratios.push({ num: d2[i], den: span });
    }

    const svgInput: SvgInput = {
      primes,
      d2,
      ratios,
      centerIndex,
      centerPrime,
    };

    const svgOptions: SvgGenOptions = {
      width: params.width,
      height: params.height,
      mode: params.mode,
      colorScheme: params.color,
      strokeWidth: params.stroke,
      background: params.background,
    };

    // Generate SVG
    const svg = generateSvg(svgInput, svgOptions);

    // Return as SVG
    const filename = `prime_terrain_${centerPrime}_${params.mode}.svg`;

    c.header('Content-Type', 'image/svg+xml');
    c.header('Content-Disposition', `inline; filename="${filename}"`);
    c.header('X-Prime-Index', centerIndex.toString());
    c.header('X-Center-Prime', centerPrime.toString());
    c.header('X-Mode', params.mode);

    return c.body(svg);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: 'Generation failed', message }, 500);
  }
});

// Gallery endpoint - returns multiple modes for comparison
svgRoute.get('/gallery', async (c) => {
  const n = c.req.query('n') || '1000';
  const nType = c.req.query('n_type') || 'index';
  const k = parseInt(c.req.query('k') || '20', 10);

  try {
    const nBigInt = BigInt(n);
    let centerIndex: number;
    let centerPrime: bigint;

    if (nType === 'index') {
      centerPrime = primeEngine.primeAtIndex(Number(nBigInt));
      centerIndex = Number(nBigInt);
    } else {
      const result = primeEngine.nextPrime(nBigInt);
      centerIndex = result.index ?? 0;
      centerPrime = result.prime;
    }

    const modes = ['tree', 'spiral', 'mandala', 'walk', 'burst', 'wave'];

    const gallery = modes.map((mode) => ({
      mode,
      url: `/api/v1/svg?n=${centerIndex}&n_type=index&k=${k}&mode=${mode}`,
      description: getDescription(mode),
    }));

    return c.json({
      center_index: centerIndex,
      center_prime: centerPrime.toString(),
      k,
      gallery,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: 'Gallery generation failed', message }, 500);
  }
});

function getDescription(mode: string): string {
  const descriptions: Record<string, string> = {
    tree: 'Recursive branching tree',
    spiral: 'Multi-arm spiral pattern',
    mandala: 'Symmetric circular mandala',
    walk: 'Turtle graphics random walk',
    burst: 'Radial ray burst',
    wave: 'Wave interference pattern',
  };
  return descriptions[mode] || mode;
}
