/**
 * SVG Fractal Generator
 *
 * Creates unique vector fractal art from prime terrain data.
 * Each visualization mode interprets d2 and ratio sequences differently.
 */

export interface SvgGenOptions {
  width?: number;
  height?: number;
  mode?: 'tree' | 'spiral' | 'mandala' | 'walk' | 'burst' | 'wave';
  colorScheme?: 'prime' | 'fire' | 'ice' | 'mono' | 'rainbow';
  strokeWidth?: number;
  background?: string;
  iterations?: number;
}

export interface SvgInput {
  primes: bigint[];
  d2: bigint[];
  ratios: { num: bigint; den: bigint }[];
  centerIndex: number;
  centerPrime: bigint;
}

interface Point {
  x: number;
  y: number;
}

// Color schemes
const COLOR_SCHEMES: Record<string, (t: number, seed: number) => string> = {
  prime: (t, seed) => {
    const h = (seed % 360 + t * 60) % 360;
    const s = 70 + Math.sin(t * Math.PI) * 20;
    const l = 45 + Math.cos(t * Math.PI * 2) * 15;
    return `hsl(${h}, ${s}%, ${l}%)`;
  },
  fire: (t) => {
    const h = 0 + t * 60; // red to yellow
    const s = 100;
    const l = 40 + t * 20;
    return `hsl(${h}, ${s}%, ${l}%)`;
  },
  ice: (t) => {
    const h = 180 + t * 60; // cyan to blue
    const s = 80;
    const l = 50 + t * 20;
    return `hsl(${h}, ${s}%, ${l}%)`;
  },
  mono: (t) => {
    const l = 20 + t * 60;
    return `hsl(220, 10%, ${l}%)`;
  },
  rainbow: (t) => {
    const h = t * 360;
    return `hsl(${h}, 80%, 50%)`;
  },
};

function ratioToFloat(r: { num: bigint; den: bigint }): number {
  if (r.den === 0n) return 0;
  return Number(r.num) / Number(r.den);
}

function normalizeD2(d2: bigint[], maxAngle: number = Math.PI / 4): number[] {
  const values = d2.map(Number);
  const maxAbs = Math.max(...values.map(Math.abs), 1);
  return values.map(v => (v / maxAbs) * maxAngle);
}

/**
 * Generate recursive tree fractal
 */
function generateTree(input: SvgInput, options: SvgGenOptions): string {
  const { width = 800, height = 800, colorScheme = 'prime', strokeWidth = 1.5 } = options;
  const colorFn = COLOR_SCHEMES[colorScheme];
  const seed = Number(input.centerPrime % 360n);

  const paths: string[] = [];
  const angles = normalizeD2(input.d2, Math.PI / 3);
  const lengths = input.ratios.map(r => 0.6 + Math.abs(ratioToFloat(r)) * 0.3);

  const maxDepth = Math.min(input.d2.length, 10);

  function branch(x: number, y: number, angle: number, length: number, depth: number): void {
    if (depth >= maxDepth || length < 2) return;

    const endX = x + Math.cos(angle) * length;
    const endY = y + Math.sin(angle) * length;

    const t = depth / maxDepth;
    const color = colorFn(t, seed);
    const sw = strokeWidth * (1 - t * 0.7);

    paths.push(`<line x1="${x.toFixed(2)}" y1="${y.toFixed(2)}" x2="${endX.toFixed(2)}" y2="${endY.toFixed(2)}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`);

    const idx = depth % angles.length;
    const angleOffset = angles[idx];
    const lengthMult = lengths[idx % lengths.length];
    const newLength = length * lengthMult;

    // Branch left and right
    branch(endX, endY, angle - Math.abs(angleOffset) - 0.3, newLength, depth + 1);
    branch(endX, endY, angle + Math.abs(angleOffset) + 0.3, newLength, depth + 1);

    // Sometimes add a middle branch based on d2 sign
    if (Number(input.d2[idx]) > 0 && depth < maxDepth - 2) {
      branch(endX, endY, angle, newLength * 0.8, depth + 1);
    }
  }

  // Start from bottom center, growing upward
  const startLength = height * 0.25;
  branch(width / 2, height * 0.85, -Math.PI / 2, startLength, 0);

  return paths.join('\n');
}

/**
 * Generate spiral rose fractal
 */
function generateSpiral(input: SvgInput, options: SvgGenOptions): string {
  const { width = 800, height = 800, colorScheme = 'prime', strokeWidth = 1.5 } = options;
  const colorFn = COLOR_SCHEMES[colorScheme];
  const seed = Number(input.centerPrime % 360n);

  const paths: string[] = [];
  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.min(width, height) * 0.4;

  // Use d2 to modulate the spiral
  const d2Values = input.d2.map(Number);
  const ratioValues = input.ratios.map(ratioToFloat);

  // Create multiple spiral arms
  const numArms = 3 + Math.abs(d2Values[0] || 0) % 5;

  for (let arm = 0; arm < numArms; arm++) {
    const armOffset = (arm / numArms) * Math.PI * 2;
    const points: Point[] = [];

    const steps = 200;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const baseAngle = t * Math.PI * 8 + armOffset;

      // Modulate angle with d2 values
      const d2Idx = Math.floor(t * d2Values.length);
      const d2Mod = (d2Values[d2Idx] || 0) / 20;

      // Modulate radius with ratio values
      const ratioIdx = Math.floor(t * ratioValues.length);
      const ratioMod = 1 + (ratioValues[ratioIdx] || 0) * 0.3;

      const angle = baseAngle + d2Mod;
      const radius = t * maxRadius * ratioMod;

      points.push({
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      });
    }

    // Draw as path
    const pathData = points.map((p, i) =>
      (i === 0 ? 'M' : 'L') + `${p.x.toFixed(2)},${p.y.toFixed(2)}`
    ).join(' ');

    const color = colorFn(arm / numArms, seed);
    paths.push(`<path d="${pathData}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`);
  }

  return paths.join('\n');
}

/**
 * Generate mandala fractal
 */
function generateMandala(input: SvgInput, options: SvgGenOptions): string {
  const { width = 800, height = 800, colorScheme = 'prime', strokeWidth = 1 } = options;
  const colorFn = COLOR_SCHEMES[colorScheme];
  const seed = Number(input.centerPrime % 360n);

  const paths: string[] = [];
  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.min(width, height) * 0.45;

  const d2Values = input.d2.map(Number);
  const ratioValues = input.ratios.map(ratioToFloat);

  // Determine symmetry from first d2 value
  const symmetry = 6 + Math.abs(d2Values[0] || 0) % 12;
  const angleStep = (Math.PI * 2) / symmetry;

  // Create concentric rings
  const numRings = Math.min(d2Values.length, 15);

  for (let ring = 0; ring < numRings; ring++) {
    const t = (ring + 1) / numRings;
    const baseRadius = t * maxRadius;
    const d2Val = d2Values[ring] || 0;
    const ratioVal = ratioValues[ring] || 0;

    // Modulate radius based on ratio
    const radiusMod = 1 + ratioVal * 0.2;
    const radius = baseRadius * radiusMod;

    const color = colorFn(t, seed);

    // Draw petals/shapes at each symmetry point
    for (let s = 0; s < symmetry; s++) {
      const angle = s * angleStep + (ring * 0.1); // Slight rotation per ring

      // Petal size based on d2 magnitude
      const petalSize = 10 + Math.abs(d2Val) * 2;
      const petalStretch = 1 + Math.abs(ratioVal);

      const px = cx + Math.cos(angle) * radius;
      const py = cy + Math.sin(angle) * radius;

      // Draw petal as ellipse
      const rotation = angle * 180 / Math.PI;
      paths.push(`<ellipse cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" rx="${(petalSize * petalStretch).toFixed(2)}" ry="${petalSize.toFixed(2)}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" transform="rotate(${rotation.toFixed(2)} ${px.toFixed(2)} ${py.toFixed(2)})"/>`);

      // Add connecting lines based on d2 sign
      if (d2Val > 0) {
        const nextAngle = (s + 1) * angleStep + (ring * 0.1);
        const nx = cx + Math.cos(nextAngle) * radius;
        const ny = cy + Math.sin(nextAngle) * radius;
        paths.push(`<line x1="${px.toFixed(2)}" y1="${py.toFixed(2)}" x2="${nx.toFixed(2)}" y2="${ny.toFixed(2)}" stroke="${color}" stroke-width="${strokeWidth * 0.5}" opacity="0.5"/>`);
      }
    }

    // Add ring circle
    paths.push(`<circle cx="${cx}" cy="${cy}" r="${radius.toFixed(2)}" fill="none" stroke="${color}" stroke-width="${strokeWidth * 0.3}" opacity="0.3"/>`);
  }

  return paths.join('\n');
}

/**
 * Generate turtle walk fractal
 */
function generateWalk(input: SvgInput, options: SvgGenOptions): string {
  const { width = 800, height = 800, colorScheme = 'prime', strokeWidth = 2 } = options;
  const colorFn = COLOR_SCHEMES[colorScheme];
  const seed = Number(input.centerPrime % 360n);

  const paths: string[] = [];
  const d2Values = input.d2.map(Number);
  const ratioValues = input.ratios.map(ratioToFloat);

  // Start from center
  let x = width / 2;
  let y = height / 2;
  let angle = -Math.PI / 2; // Start pointing up

  const baseStep = Math.min(width, height) / 30;
  const points: Point[] = [{ x, y }];

  // Walk based on sequences
  const steps = Math.min(d2Values.length * 3, 100);

  for (let i = 0; i < steps; i++) {
    const idx = i % d2Values.length;
    const d2Val = d2Values[idx];
    const ratioVal = ratioValues[idx % ratioValues.length];

    // Turn angle based on d2
    const turnAngle = (d2Val / 10) * Math.PI / 4;
    angle += turnAngle;

    // Step length based on ratio
    const stepLength = baseStep * (0.5 + Math.abs(ratioVal) + 0.5);

    // Move forward
    x += Math.cos(angle) * stepLength;
    y += Math.sin(angle) * stepLength;

    // Wrap around if out of bounds
    if (x < 50) x = width - 50;
    if (x > width - 50) x = 50;
    if (y < 50) y = height - 50;
    if (y > height - 50) y = 50;

    points.push({ x, y });
  }

  // Draw path with gradient color
  for (let i = 1; i < points.length; i++) {
    const t = i / points.length;
    const color = colorFn(t, seed);
    const sw = strokeWidth * (1 - t * 0.5);

    paths.push(`<line x1="${points[i-1].x.toFixed(2)}" y1="${points[i-1].y.toFixed(2)}" x2="${points[i].x.toFixed(2)}" y2="${points[i].y.toFixed(2)}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`);
  }

  // Add dots at key points
  for (let i = 0; i < points.length; i += 5) {
    const t = i / points.length;
    const color = colorFn(t, seed);
    paths.push(`<circle cx="${points[i].x.toFixed(2)}" cy="${points[i].y.toFixed(2)}" r="${3}" fill="${color}"/>`);
  }

  return paths.join('\n');
}

/**
 * Generate radial burst fractal
 */
function generateBurst(input: SvgInput, options: SvgGenOptions): string {
  const { width = 800, height = 800, colorScheme = 'prime', strokeWidth = 1.5 } = options;
  const colorFn = COLOR_SCHEMES[colorScheme];
  const seed = Number(input.centerPrime % 360n);

  const paths: string[] = [];
  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.min(width, height) * 0.45;

  const d2Values = input.d2.map(Number);
  const ratioValues = input.ratios.map(ratioToFloat);

  // Number of rays based on d2 count
  const numRays = Math.max(d2Values.length, 12);
  const angleStep = (Math.PI * 2) / numRays;

  for (let i = 0; i < numRays; i++) {
    const d2Val = d2Values[i % d2Values.length];
    const ratioVal = ratioValues[i % ratioValues.length];

    const angle = i * angleStep;
    const t = i / numRays;
    const color = colorFn(t, seed);

    // Ray length based on d2 magnitude
    const rayLength = maxRadius * (0.3 + Math.abs(d2Val) / 20 * 0.7);

    // Ray width/style based on ratio
    const rayWidth = strokeWidth * (1 + Math.abs(ratioVal));

    const endX = cx + Math.cos(angle) * rayLength;
    const endY = cy + Math.sin(angle) * rayLength;

    // Main ray
    paths.push(`<line x1="${cx}" y1="${cy}" x2="${endX.toFixed(2)}" y2="${endY.toFixed(2)}" stroke="${color}" stroke-width="${rayWidth}" stroke-linecap="round"/>`);

    // Sub-rays for positive d2
    if (d2Val > 0) {
      const subLength = rayLength * 0.4;
      const subAngle1 = angle + 0.3;
      const subAngle2 = angle - 0.3;

      const midX = cx + Math.cos(angle) * rayLength * 0.6;
      const midY = cy + Math.sin(angle) * rayLength * 0.6;

      paths.push(`<line x1="${midX.toFixed(2)}" y1="${midY.toFixed(2)}" x2="${(midX + Math.cos(subAngle1) * subLength).toFixed(2)}" y2="${(midY + Math.sin(subAngle1) * subLength).toFixed(2)}" stroke="${color}" stroke-width="${rayWidth * 0.5}" stroke-linecap="round" opacity="0.7"/>`);
      paths.push(`<line x1="${midX.toFixed(2)}" y1="${midY.toFixed(2)}" x2="${(midX + Math.cos(subAngle2) * subLength).toFixed(2)}" y2="${(midY + Math.sin(subAngle2) * subLength).toFixed(2)}" stroke="${color}" stroke-width="${rayWidth * 0.5}" stroke-linecap="round" opacity="0.7"/>`);
    }

    // Endpoint decoration based on ratio sign
    const dotRadius = 3 + Math.abs(ratioVal) * 3;
    if (ratioVal > 0) {
      paths.push(`<circle cx="${endX.toFixed(2)}" cy="${endY.toFixed(2)}" r="${dotRadius}" fill="${color}"/>`);
    } else {
      paths.push(`<circle cx="${endX.toFixed(2)}" cy="${endY.toFixed(2)}" r="${dotRadius}" fill="none" stroke="${color}" stroke-width="1.5"/>`);
    }
  }

  // Center decoration
  paths.push(`<circle cx="${cx}" cy="${cy}" r="8" fill="${colorFn(0.5, seed)}"/>`);
  paths.push(`<circle cx="${cx}" cy="${cy}" r="12" fill="none" stroke="${colorFn(0.5, seed)}" stroke-width="2"/>`);

  return paths.join('\n');
}

/**
 * Generate wave interference pattern
 */
function generateWave(input: SvgInput, options: SvgGenOptions): string {
  const { width = 800, height = 800, colorScheme = 'prime', strokeWidth = 1 } = options;
  const colorFn = COLOR_SCHEMES[colorScheme];
  const seed = Number(input.centerPrime % 360n);

  const paths: string[] = [];
  const d2Values = input.d2.map(Number);
  const ratioValues = input.ratios.map(ratioToFloat);

  // Create wave sources from d2/ratio pairs
  const numWaves = Math.min(d2Values.length, 8);

  // Sample points grid
  const gridSize = 60;
  const cellW = width / gridSize;
  const cellH = height / gridSize;

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const px = (gx + 0.5) * cellW;
      const py = (gy + 0.5) * cellH;

      // Calculate interference at this point
      let totalWave = 0;

      for (let w = 0; w < numWaves; w++) {
        // Wave source position based on index
        const srcAngle = (w / numWaves) * Math.PI * 2;
        const srcRadius = Math.min(width, height) * 0.3;
        const srcX = width / 2 + Math.cos(srcAngle) * srcRadius;
        const srcY = height / 2 + Math.sin(srcAngle) * srcRadius;

        // Distance from source
        const dx = px - srcX;
        const dy = py - srcY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Frequency based on d2, phase based on ratio
        const freq = 0.02 + Math.abs(d2Values[w]) * 0.005;
        const phase = ratioValues[w % ratioValues.length] * Math.PI;

        totalWave += Math.sin(dist * freq + phase);
      }

      // Normalize
      totalWave = totalWave / numWaves;

      // Draw point with color based on wave value
      const t = (totalWave + 1) / 2; // 0 to 1
      const color = colorFn(t, seed);
      const radius = 2 + Math.abs(totalWave) * 3;

      if (Math.abs(totalWave) > 0.3) {
        paths.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${radius.toFixed(1)}" fill="${color}" opacity="${(0.3 + Math.abs(totalWave) * 0.7).toFixed(2)}"/>`);
      }
    }
  }

  return paths.join('\n');
}

/**
 * Generate complete SVG document
 */
export function generateSvg(input: SvgInput, options: SvgGenOptions = {}): string {
  const {
    width = 800,
    height = 800,
    mode = 'mandala',
    background = '#0a0e14',
  } = options;

  let content: string;

  switch (mode) {
    case 'tree':
      content = generateTree(input, options);
      break;
    case 'spiral':
      content = generateSpiral(input, options);
      break;
    case 'mandala':
      content = generateMandala(input, options);
      break;
    case 'walk':
      content = generateWalk(input, options);
      break;
    case 'burst':
      content = generateBurst(input, options);
      break;
    case 'wave':
      content = generateWave(input, options);
      break;
    default:
      content = generateMandala(input, options);
  }

  const title = `Prime Terrain - p(${input.centerIndex}) = ${input.centerPrime}`;
  const desc = `SVG fractal generated from prime neighborhood second differences and ratios. Mode: ${mode}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <title>${title}</title>
  <desc>${desc}</desc>
  <rect width="100%" height="100%" fill="${background}"/>
  <g id="fractal">
${content}
  </g>
</svg>`;
}
