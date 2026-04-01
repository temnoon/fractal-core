/**
 * Flame Fractal Genome Route
 *
 * Generates flam3 XML genome files from prime terrain data.
 * Compatible with Apophysis, Fractorium, and flam3 renderer.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { primeEngine } from '../services/engines/index.js';
import {
  generateFlameGenome,
  generateFlameAnimation,
  FlameInput,
  FlameGenOptions,
  Rational,
} from '../services/flame-generator.js';

export const flameRoute = new Hono();

const flameQuerySchema = z.object({
  n: z.string().transform((val) => BigInt(val)),
  n_type: z.enum(['index', 'value']).default('index'),
  k: z.coerce.number().int().min(5).max(100).default(20),
  name: z.string().optional(),
  width: z.coerce.number().int().min(100).max(8192).default(1920),
  height: z.coerce.number().int().min(100).max(8192).default(1080),
  quality: z.coerce.number().int().min(10).max(10000).default(500),
  supersample: z.coerce.number().int().min(1).max(4).default(2),
  variations: z.enum(['classic', 'modern', 'all', 'minimal']).default('classic'),
  symmetry: z.coerce.number().int().min(0).max(12).default(0),
  color_mode: z.enum(['sequence', 'gradient', 'monochrome']).default('sequence'),
  animate: z.coerce.boolean().default(false),
  frames: z.coerce.number().int().min(1).max(1000).default(30),
});

// Info endpoint
flameRoute.get('/info', (c) => {
  return c.json({
    name: 'Prime Terrain Flame Generator',
    version: '1.0.0',
    description: 'Generates flam3 XML genome files from prime neighborhood second differences and ratios',
    compatible_with: ['Apophysis 7X', 'Fractorium', 'flam3', 'Chaotica'],
    parameters: {
      n: { type: 'bigint', required: true, description: 'Prime index or value' },
      n_type: { type: 'string', default: 'index', options: ['index', 'value'] },
      k: { type: 'integer', default: 20, min: 5, max: 100, description: 'Number of neighbors each side' },
      name: { type: 'string', description: 'Flame name (defaults to prime-based name)' },
      width: { type: 'integer', default: 1920, description: 'Output image width' },
      height: { type: 'integer', default: 1080, description: 'Output image height' },
      quality: { type: 'integer', default: 500, description: 'Render quality (iterations per pixel)' },
      supersample: { type: 'integer', default: 2, min: 1, max: 4, description: 'Anti-aliasing level' },
      variations: { type: 'string', default: 'classic', options: ['classic', 'modern', 'all', 'minimal'] },
      color_mode: { type: 'string', default: 'sequence', options: ['sequence', 'gradient', 'monochrome'] },
      animate: { type: 'boolean', default: false, description: 'Generate animation sequence' },
      frames: { type: 'integer', default: 30, description: 'Number of animation frames' },
    },
    mapping: {
      d2_to_variations: 'Second differences determine variation weights, rotation, and scale',
      ratio_to_color: 'Second ratios ([-1,1]) map to color positions and blend weights',
      sequence_to_xforms: 'Each d2/ratio pair generates one xform transform',
    },
    examples: [
      '/api/v1/flame?n=1000&k=20',
      '/api/v1/flame?n=10000&variations=modern&color_mode=gradient',
      '/api/v1/flame?n=100&animate=true&frames=60',
    ],
  });
});

// Main flame generation endpoint
flameRoute.get('/', async (c) => {
  const rawQuery = {
    n: c.req.query('n'),
    n_type: c.req.query('n_type'),
    k: c.req.query('k'),
    name: c.req.query('name'),
    width: c.req.query('width'),
    height: c.req.query('height'),
    quality: c.req.query('quality'),
    supersample: c.req.query('supersample'),
    variations: c.req.query('variations'),
    symmetry: c.req.query('symmetry'),
    color_mode: c.req.query('color_mode'),
    animate: c.req.query('animate'),
    frames: c.req.query('frames'),
  };

  // Remove undefined values
  const cleanQuery = Object.fromEntries(
    Object.entries(rawQuery).filter(([_, v]) => v !== undefined)
  );

  const parseResult = flameQuerySchema.safeParse(cleanQuery);

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
      const result = primeEngine.primeAtIndex(Number(params.n));
      centerIndex = Number(params.n);
      centerPrime = result;
    } else {
      const result = primeEngine.nextPrime(params.n);
      centerIndex = result.index ?? 0;
      centerPrime = result.prime;
    }

    // Get neighborhood primes using primesAroundIndex
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

    // Calculate ratios: r(n) = d2(n) / (p(n+2) - p(n))
    const ratios: Rational[] = [];
    for (let i = 0; i < d2.length && i + 2 < primes.length; i++) {
      const span = primes[i + 2] - primes[i];
      ratios.push({ num: d2[i], den: span });
    }

    const flameInput: FlameInput = {
      primes,
      gaps,
      d2,
      ratios,
      centerIndex,
      centerPrime,
    };

    const flameOptions: FlameGenOptions = {
      n: params.n,
      count: params.k * 2,
      name: params.name || `prime_terrain_p${centerIndex}_${centerPrime}`,
      width: params.width,
      height: params.height,
      quality: params.quality,
      supersample: params.supersample,
      variationSet: params.variations,
      symmetry: params.symmetry,
      colorMode: params.color_mode,
      animate: params.animate,
      frames: params.frames,
    };

    // Generate flame XML
    let xml: string;
    if (params.animate) {
      xml = generateFlameAnimation(flameInput, flameOptions);
    } else {
      xml = generateFlameGenome(flameInput, flameOptions);
    }

    // Return as XML with appropriate headers
    const filename = params.animate
      ? `prime_terrain_animation_${centerPrime}.flame`
      : `prime_terrain_${centerPrime}.flame`;

    c.header('Content-Type', 'application/xml');
    c.header('Content-Disposition', `attachment; filename="${filename}"`);
    c.header('X-Prime-Index', centerIndex.toString());
    c.header('X-Center-Prime', centerPrime.toString());
    c.header('X-D2-Count', d2.length.toString());
    c.header('X-Ratio-Count', ratios.length.toString());

    return c.body(xml);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: 'Generation failed', message }, 500);
  }
});

// Preview endpoint (returns JSON metadata instead of XML)
flameRoute.get('/preview', async (c) => {
  const n = c.req.query('n');
  const nType = c.req.query('n_type') || 'index';
  const k = parseInt(c.req.query('k') || '10', 10);

  if (!n) {
    return c.json({ error: 'Missing required parameter: n' }, 400);
  }

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

    const neighborhood = primeEngine.primesAroundIndex(centerIndex, k);
    const primes = neighborhood.primes;

    const gaps: bigint[] = [];
    for (let i = 1; i < primes.length; i++) {
      gaps.push(primes[i] - primes[i - 1]);
    }

    const d2: bigint[] = [];
    for (let i = 1; i < gaps.length; i++) {
      d2.push(gaps[i] - gaps[i - 1]);
    }

    const ratios: { num: string; den: string; decimal: number }[] = [];
    for (let i = 0; i < d2.length && i + 2 < primes.length; i++) {
      const span = primes[i + 2] - primes[i];
      const decimal = span === 0n ? 0 : Number(d2[i]) / Number(span);
      ratios.push({
        num: d2[i].toString(),
        den: span.toString(),
        decimal: Math.round(decimal * 1000) / 1000,
      });
    }

    return c.json({
      preview: true,
      center_index: centerIndex,
      center_prime: centerPrime.toString(),
      k,
      data: {
        primes_count: primes.length,
        first_prime: primes[0]?.toString(),
        last_prime: primes[primes.length - 1]?.toString(),
        d2_count: d2.length,
        d2_sample: d2.slice(0, 10).map(String),
        d2_range: {
          min: Math.min(...d2.map(Number)).toString(),
          max: Math.max(...d2.map(Number)).toString(),
        },
        ratios_count: ratios.length,
        ratios_sample: ratios.slice(0, 10),
      },
      download_url: `/api/v1/flame?n=${centerIndex}&n_type=index&k=${k}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: 'Preview failed', message }, 500);
  }
});
