/**
 * Flame Fractal Genome Generator
 *
 * Converts prime terrain data (second differences and second ratios)
 * into flam3 XML genome files compatible with Apophysis, Fractorium, and flam3.
 *
 * Mapping strategy:
 * - d2 values → variation weights, affine coefficients, rotation
 * - ratio values ([-1,1]) → color positions, symmetry, blend weights
 * - Sequence patterns → xform structure and relationships
 */

// Available variations in flam3 (subset of most visually interesting)
const VARIATIONS = [
  'linear', 'sinusoidal', 'spherical', 'swirl', 'horseshoe',
  'polar', 'handkerchief', 'heart', 'disc', 'spiral',
  'hyperbolic', 'diamond', 'ex', 'julia', 'bent',
  'waves', 'fisheye', 'popcorn', 'exponential', 'power',
  'cosine', 'rings', 'fan', 'blob', 'pdj',
  'fan2', 'rings2', 'eyefish', 'bubble', 'cylinder',
  'perspective', 'noise', 'julian', 'juliascope', 'blur',
  'gaussian_blur', 'radial_blur', 'pie', 'ngon', 'curl',
  'rectangles', 'arch', 'tangent', 'square', 'rays',
  'blade', 'secant2', 'twintrian', 'cross', 'disc2',
  'supershape', 'flower', 'conic', 'parabola', 'bent2',
  'bipolar', 'boarders', 'butterfly', 'cell', 'cpow',
  'edisc', 'elliptic', 'escher', 'foci', 'lazysusan',
  'loonie', 'modulus', 'oscope', 'popcorn2', 'scry',
  'separation', 'split', 'splits', 'stripes', 'wedge',
  'wedge_julia', 'wedge_sph', 'whorl', 'waves2', 'exp',
  'log', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'sinh', 'cosh', 'tanh', 'sech', 'csch', 'coth',
  'auger', 'flux', 'mobius'
];

// Parametric variations that need additional attributes
const PARAMETRIC_VARS: Record<string, string[]> = {
  'blob': ['blob_low', 'blob_high', 'blob_waves'],
  'pdj': ['pdj_a', 'pdj_b', 'pdj_c', 'pdj_d'],
  'fan2': ['fan2_x', 'fan2_y'],
  'rings2': ['rings2_val'],
  'perspective': ['perspective_angle', 'perspective_dist'],
  'julian': ['julian_power', 'julian_dist'],
  'juliascope': ['juliascope_power', 'juliascope_dist'],
  'radial_blur': ['radial_blur_angle'],
  'pie': ['pie_slices', 'pie_rotation', 'pie_thickness'],
  'ngon': ['ngon_sides', 'ngon_power', 'ngon_circle', 'ngon_corners'],
  'curl': ['curl_c1', 'curl_c2'],
  'rectangles': ['rectangles_x', 'rectangles_y'],
  'supershape': ['supershape_rnd', 'supershape_m', 'supershape_n1', 'supershape_n2', 'supershape_n3', 'supershape_holes'],
  'flower': ['flower_petals', 'flower_holes'],
  'conic': ['conic_eccentricity', 'conic_holes'],
  'parabola': ['parabola_height', 'parabola_width'],
  'bent2': ['bent2_x', 'bent2_y'],
  'cpow': ['cpow_r', 'cpow_i', 'cpow_power'],
  'escher': ['escher_beta'],
  'modulus': ['modulus_x', 'modulus_y'],
  'oscope': ['oscope_separation', 'oscope_frequency', 'oscope_amplitude', 'oscope_damping'],
  'popcorn2': ['popcorn2_x', 'popcorn2_y', 'popcorn2_c'],
  'separation': ['separation_x', 'separation_y', 'separation_xinside', 'separation_yinside'],
  'splits': ['splits_x', 'splits_y'],
  'stripes': ['stripes_space', 'stripes_warp'],
  'wedge': ['wedge_angle', 'wedge_hole', 'wedge_count', 'wedge_swirl'],
  'wedge_julia': ['wedge_julia_angle', 'wedge_julia_count', 'wedge_julia_power', 'wedge_julia_dist'],
  'wedge_sph': ['wedge_sph_angle', 'wedge_sph_count', 'wedge_sph_hole', 'wedge_sph_swirl'],
  'whorl': ['whorl_inside', 'whorl_outside'],
  'waves2': ['waves2_freqx', 'waves2_scalex', 'waves2_freqy', 'waves2_scaley'],
  'auger': ['auger_sym', 'auger_weight', 'auger_freq', 'auger_scale'],
  'flux': ['flux_spread'],
  'mobius': ['mobius_re_a', 'mobius_im_a', 'mobius_re_b', 'mobius_im_b', 'mobius_re_c', 'mobius_im_c', 'mobius_re_d', 'mobius_im_d'],
};

export interface FlameGenOptions {
  n: bigint;
  count: number;
  name?: string;
  width?: number;
  height?: number;
  quality?: number;
  supersample?: number;
  variationSet?: 'classic' | 'modern' | 'all' | 'minimal';
  symmetry?: number;
  colorMode?: 'sequence' | 'gradient' | 'monochrome';
  animate?: boolean;
  frames?: number;
}

export interface Rational {
  num: bigint;
  den: bigint;
}

export interface FlameInput {
  primes: bigint[];
  gaps: bigint[];
  d2: bigint[];
  ratios: Rational[];
  centerIndex: number;
  centerPrime: bigint;
}

/**
 * Generate a deterministic pseudo-random number from a seed
 */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * Map a value from one range to another
 */
function mapRange(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return outMin + (outMax - outMin) * ((value - inMin) / (inMax - inMin));
}

/**
 * Clamp a value to a range
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Convert ratio to float
 */
function ratioToFloat(r: Rational): number {
  if (r.den === 0n) return 0;
  return Number(r.num) / Number(r.den);
}

/**
 * Generate HSV to RGB color
 */
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  let r: number, g: number, b: number;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
    default: r = v; g = t; b = p;
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * Generate a color palette based on prime terrain data
 */
function generatePalette(input: FlameInput, mode: string, seed: number): string {
  const rand = seededRandom(seed);
  const colors: string[] = [];

  // Base hue derived from center prime
  const baseHue = (Number(input.centerPrime % 360n)) / 360;

  for (let i = 0; i < 256; i++) {
    let r: number, g: number, b: number;
    const t = i / 255;

    if (mode === 'sequence') {
      // Map position in palette to d2/ratio values
      const idx = Math.floor(t * (input.ratios.length - 1));
      const ratio = ratioToFloat(input.ratios[idx] || { num: 0n, den: 1n });
      const d2Val = input.d2[idx] || 0n;

      // Hue from ratio, saturation from d2 magnitude
      const hue = (baseHue + (ratio + 1) / 2 * 0.5) % 1;
      const sat = 0.6 + 0.4 * Math.abs(Number(d2Val)) / 20;
      const val = 0.7 + 0.3 * t;

      [r, g, b] = hsvToRgb(hue, clamp(sat, 0, 1), val);
    } else if (mode === 'gradient') {
      // Smooth gradient based on center prime
      const hue = (baseHue + t * 0.7) % 1;
      const sat = 0.8 - 0.3 * Math.sin(t * Math.PI);
      const val = 0.5 + 0.5 * Math.cos(t * Math.PI * 2);

      [r, g, b] = hsvToRgb(hue, sat, clamp(val, 0.3, 1));
    } else {
      // Monochrome with blue tint
      const v = 0.2 + 0.8 * t;
      r = Math.round(v * 180);
      g = Math.round(v * 200);
      b = Math.round(v * 255);
    }

    colors.push(
      r.toString(16).padStart(2, '0') +
      g.toString(16).padStart(2, '0') +
      b.toString(16).padStart(2, '0')
    );
  }

  // Format as flam3 palette (8 colors per line)
  const lines: string[] = [];
  for (let i = 0; i < 256; i += 8) {
    lines.push('      ' + colors.slice(i, i + 8).join(''));
  }

  return lines.join('\n');
}

/**
 * Select variations based on d2 pattern
 */
function selectVariations(
  d2Values: bigint[],
  ratios: Rational[],
  varSet: string,
  seed: number
): string[] {
  const rand = seededRandom(seed);

  let availableVars: string[];
  switch (varSet) {
    case 'minimal':
      availableVars = ['linear', 'sinusoidal', 'spherical', 'swirl', 'julia', 'blur'];
      break;
    case 'classic':
      availableVars = VARIATIONS.slice(0, 35);
      break;
    case 'modern':
      availableVars = VARIATIONS.slice(35);
      break;
    default:
      availableVars = [...VARIATIONS];
  }

  // Use d2 pattern to select variations
  const selected: string[] = [];
  const d2Sum = d2Values.reduce((acc, v) => acc + Math.abs(Number(v)), 0);
  const numVars = Math.min(6, Math.max(2, Math.floor(d2Sum / 10) % 5 + 2));

  for (let i = 0; i < numVars; i++) {
    const d2Idx = i % d2Values.length;
    const d2Val = Math.abs(Number(d2Values[d2Idx]));
    const ratioVal = ratioToFloat(ratios[d2Idx] || { num: 0n, den: 1n });

    // Combine d2 and ratio to select variation index
    const varIdx = Math.floor((d2Val * 7 + (ratioVal + 1) * 13 + rand() * 5)) % availableVars.length;
    const variation = availableVars[varIdx];

    if (!selected.includes(variation)) {
      selected.push(variation);
    }
  }

  // Ensure at least 2 variations
  while (selected.length < 2) {
    const variation = availableVars[Math.floor(rand() * availableVars.length)];
    if (!selected.includes(variation)) {
      selected.push(variation);
    }
  }

  return selected;
}

/**
 * Generate affine coefficients from d2/ratio values
 * coefs = "a b c d e f" where the transform is:
 * x' = a*x + b*y + e
 * y' = c*x + d*y + f
 */
function generateCoefs(
  d2: bigint,
  ratio: Rational,
  idx: number,
  total: number,
  seed: number
): string {
  const rand = seededRandom(seed + idx);
  const r = ratioToFloat(ratio);
  const d = Number(d2);

  // Base rotation from position in sequence
  const baseAngle = (idx / total) * Math.PI * 2;

  // Modify angle based on ratio
  const angle = baseAngle + r * Math.PI / 4;

  // Scale based on d2 magnitude
  const scale = 0.5 + 0.5 / (1 + Math.abs(d) / 10);

  // Rotation matrix with scale
  const cos = Math.cos(angle) * scale;
  const sin = Math.sin(angle) * scale;

  // Add some variation based on d2 sign
  const skew = d > 0 ? 0.1 * r : -0.1 * r;

  const a = cos + skew;
  const b = -sin;
  const c = sin;
  const dd = cos - skew;

  // Translation based on ratio
  const e = r * 0.5 + rand() * 0.3 - 0.15;
  const f = (1 - Math.abs(r)) * 0.3 * (d > 0 ? 1 : -1);

  return [a, b, c, dd, e, f].map(v => v.toFixed(6)).join(' ');
}

/**
 * Generate xform XML element
 */
function generateXform(
  d2: bigint,
  ratio: Rational,
  idx: number,
  total: number,
  variations: string[],
  seed: number
): string {
  const rand = seededRandom(seed + idx * 17);
  const r = ratioToFloat(ratio);
  const d = Number(d2);

  // Weight based on d2 magnitude (more extreme = lower weight to balance)
  const weight = 1 / (1 + Math.abs(d) / 20);

  // Color position from ratio (mapped to 0-1)
  const color = (r + 1) / 2;

  // Symmetry from d2 sign
  const symmetry = d >= 0 ? 0 : -0.5;

  // Generate coefficients
  const coefs = generateCoefs(d2, ratio, idx, total, seed);

  // Build variation attributes
  const varAttrs: string[] = [];
  const numVarsToUse = Math.min(variations.length, 3);

  for (let i = 0; i < numVarsToUse; i++) {
    const variation = variations[(idx + i) % variations.length];
    // Weight derived from d2 and ratio
    const varWeight = 0.3 + 0.7 * Math.abs(r) / (i + 1);
    varAttrs.push(`${variation}="${varWeight.toFixed(6)}"`);

    // Add parametric variation attributes if needed
    if (PARAMETRIC_VARS[variation]) {
      for (const param of PARAMETRIC_VARS[variation]) {
        const paramVal = (rand() * 2 - 1) * (1 + Math.abs(d) / 10);
        varAttrs.push(`${param}="${paramVal.toFixed(6)}"`);
      }
    }
  }

  return `   <xform weight="${weight.toFixed(6)}" color="${color.toFixed(6)}" symmetry="${symmetry.toFixed(6)}" ` +
    `coefs="${coefs}" ${varAttrs.join(' ')} />`;
}

/**
 * Generate a complete flame genome XML
 */
export function generateFlameGenome(
  input: FlameInput,
  options: FlameGenOptions
): string {
  const {
    name = `prime_terrain_${input.centerPrime}`,
    width = 1920,
    height = 1080,
    quality = 500,
    supersample = 2,
    variationSet = 'classic',
    symmetry = 0,
    colorMode = 'sequence',
  } = options;

  // Seed from center prime for reproducibility
  const seed = Number(input.centerPrime % BigInt(0x7fffffff));

  // Select variations based on data
  const variations = selectVariations(input.d2, input.ratios, variationSet, seed);

  // Generate xforms - one per d2/ratio pair (up to a reasonable limit)
  const maxXforms = Math.min(input.d2.length, 12);
  const xforms: string[] = [];

  for (let i = 0; i < maxXforms; i++) {
    const d2 = input.d2[i] || 0n;
    const ratio = input.ratios[i] || { num: 0n, den: 1n };
    xforms.push(generateXform(d2, ratio, i, maxXforms, variations, seed));
  }

  // Add final xform for color mapping
  const finalCoefs = '1 0 0 1 0 0';
  xforms.push(`   <finalxform color="0" symmetry="1" coefs="${finalCoefs}" linear="1" />`);

  // Generate palette
  const palette = generatePalette(input, colorMode, seed);

  // Calculate flame-level parameters from data
  const avgRatio = input.ratios.reduce((acc, r) => acc + ratioToFloat(r), 0) / input.ratios.length;
  const d2Variance = input.d2.reduce((acc, d) => acc + Math.abs(Number(d)), 0) / input.d2.length;

  const rotate = avgRatio * 45; // Rotation from average ratio
  const scale = 200 + d2Variance * 10; // Scale from d2 variance
  const brightness = 4 + avgRatio;
  const gamma = 4 - avgRatio * 0.5;

  // Build the flame XML
  const flameXml = `<flames>
<flame name="${escapeXml(name)}" version="Prime Terrain 1.0" size="${width} ${height}" center="0 0" scale="${scale.toFixed(2)}"
       rotate="${rotate.toFixed(2)}" supersample="${supersample}" filter="0.4" quality="${quality}"
       background="0 0 0" brightness="${brightness.toFixed(2)}" gamma="${gamma.toFixed(2)}" gamma_threshold="0.01"
       highlight_power="-1" vibrancy="1" estimator_radius="9" estimator_minimum="0" estimator_curve="0.4"
       palette_mode="linear" interpolation="linear" interpolation_type="log">
   <!-- Generated from prime neighborhood around p(${input.centerIndex}) = ${input.centerPrime} -->
   <!-- d2 sequence: ${input.d2.slice(0, 10).join(', ')}${input.d2.length > 10 ? '...' : ''} -->
   <!-- Variations: ${variations.join(', ')} -->
${xforms.join('\n')}
   <palette count="256" format="RGB">
${palette}
   </palette>
</flame>
</flames>`;

  return flameXml;
}

/**
 * Generate multiple flame genomes for animation
 */
export function generateFlameAnimation(
  input: FlameInput,
  options: FlameGenOptions
): string {
  const frames = options.frames || 30;
  const flames: string[] = [];

  for (let frame = 0; frame < frames; frame++) {
    // Shift the d2/ratio window for each frame
    const offset = frame % input.d2.length;
    const shiftedD2 = [...input.d2.slice(offset), ...input.d2.slice(0, offset)];
    const shiftedRatios = [...input.ratios.slice(offset), ...input.ratios.slice(0, offset)];

    const frameInput: FlameInput = {
      ...input,
      d2: shiftedD2,
      ratios: shiftedRatios,
    };

    const frameOptions = {
      ...options,
      name: `${options.name || 'prime_terrain'}_frame_${frame.toString().padStart(4, '0')}`,
    };

    // Generate single flame (extract inner content)
    const xml = generateFlameGenome(frameInput, frameOptions);
    const flameContent = xml.replace('<flames>\n', '').replace('\n</flames>', '');
    flames.push(flameContent);
  }

  return `<flames>\n${flames.join('\n')}\n</flames>`;
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
