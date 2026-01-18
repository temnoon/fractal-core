/**
 * Multi-format sequence export
 *
 * Supports various output formats for mathematical software and data interchange:
 * - CSV/TSV: Universal tabular format
 * - PARI/GP: Number theory CAS
 * - Mathematica: Wolfram Language
 * - SageMath: Python-based math
 * - LaTeX: Typesetting
 * - JSON-LD: Linked data with schema.org
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { sieveEngine } from '../services/engines/sieve.js';
import { computeNeighborhood, parseComputeOptions } from '../services/neighborhood.js';
import type { CanonicalRequest } from '../types/api.js';
import type { Rational } from '../types/neighborhood.js';

export const formatsRoute = new Hono();

// Supported export formats
type ExportFormat =
  | 'csv' | 'tsv'
  | 'pari' | 'mathematica' | 'sage' | 'maple'
  | 'latex' | 'latex-table' | 'latex-array'
  | 'json-ld'
  | 'numpy' | 'r' | 'julia';

const FormatQuerySchema = z.object({
  n: z.string().optional().default('0'),
  count: z.string().optional().default('100'),
  sequence: z.enum(['primes', 'gaps', 'd2', 'ratios', 'all']).optional().default('primes'),
  format: z.string().optional().default('csv'),
  // CSV options
  delimiter: z.enum([',', '\t', ';', '|']).optional().default(','),
  header: z.enum(['true', 'false']).optional().default('true'),
  // LaTeX options
  columns: z.string().optional().default('10'),  // items per row
  // Variable name for CAS formats
  varname: z.string().optional().default('seq'),
});

interface SequenceData {
  name: string;
  description: string;
  values: (bigint | Rational)[];
  indices: number[];
  startIndex: number;
}

/**
 * Compute sequence data
 */
function getSequenceData(
  sequence: string,
  startIdx: number,
  count: number
): SequenceData[] {
  const results: SequenceData[] = [];
  const n = Math.min(count, 10000);

  if (sequence === 'primes' || sequence === 'all') {
    const values: bigint[] = [];
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      values.push(sieveEngine.primeAtIndex(startIdx + i));
      indices.push(startIdx + i);
    }
    results.push({
      name: 'primes',
      description: 'Prime numbers (A000040)',
      values,
      indices,
      startIndex: startIdx,
    });
  }

  if (sequence === 'gaps' || sequence === 'all') {
    const values: bigint[] = [];
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      const p1 = sieveEngine.primeAtIndex(startIdx + i);
      const p2 = sieveEngine.primeAtIndex(startIdx + i + 1);
      values.push(p2 - p1);
      indices.push(startIdx + i);
    }
    results.push({
      name: 'gaps',
      description: 'Prime gaps (A001223)',
      values,
      indices,
      startIndex: startIdx,
    });
  }

  if (sequence === 'd2' || sequence === 'all') {
    const values: bigint[] = [];
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      const p0 = sieveEngine.primeAtIndex(startIdx + i);
      const p1 = sieveEngine.primeAtIndex(startIdx + i + 1);
      const p2 = sieveEngine.primeAtIndex(startIdx + i + 2);
      values.push((p2 - p1) - (p1 - p0));
      indices.push(startIdx + i);
    }
    results.push({
      name: 'd2',
      description: 'Second differences of primes (A036263)',
      values,
      indices,
      startIndex: startIdx,
    });
  }

  if (sequence === 'ratios' || sequence === 'all') {
    const values: Rational[] = [];
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      const p0 = sieveEngine.primeAtIndex(startIdx + i);
      const p1 = sieveEngine.primeAtIndex(startIdx + i + 1);
      const p2 = sieveEngine.primeAtIndex(startIdx + i + 2);
      const d2 = (p2 - p1) - (p1 - p0);
      const span = p2 - p0;
      const g = gcd(d2 < 0n ? -d2 : d2, span);
      values.push({ num: (d2 / g).toString(), den: (span / g).toString() });
      indices.push(startIdx + i);
    }
    results.push({
      name: 'ratios',
      description: 'Second ratio r = d2/span, always in [-1,1]',
      values,
      indices,
      startIndex: startIdx,
    });
  }

  return results;
}

// ============ Format Converters ============

function formatCSV(
  data: SequenceData[],
  delimiter: string,
  includeHeader: boolean
): string {
  const lines: string[] = [];

  if (data.length === 1) {
    // Single sequence: index, value
    const seq = data[0];
    if (includeHeader) {
      lines.push(`index${delimiter}${seq.name}`);
    }
    for (let i = 0; i < seq.values.length; i++) {
      const val = seq.values[i];
      const valStr = isRational(val) ? `${val.num}/${val.den}` : val.toString();
      lines.push(`${seq.indices[i]}${delimiter}${valStr}`);
    }
  } else {
    // Multiple sequences: index, seq1, seq2, ...
    if (includeHeader) {
      lines.push(['index', ...data.map((d) => d.name)].join(delimiter));
    }
    const len = Math.min(...data.map((d) => d.values.length));
    for (let i = 0; i < len; i++) {
      const vals = data.map((d) => {
        const val = d.values[i];
        return isRational(val) ? `${val.num}/${val.den}` : val.toString();
      });
      lines.push([data[0].indices[i], ...vals].join(delimiter));
    }
  }

  return lines.join('\n');
}

function formatPARI(data: SequenceData[], varname: string): string {
  const lines: string[] = [
    `\\\\ Prime Terrain API - PARI/GP format`,
    `\\\\ Generated: ${new Date().toISOString()}`,
    '',
  ];

  for (const seq of data) {
    const vals = seq.values.map((v) =>
      isRational(v) ? `${v.num}/${v.den}` : v.toString()
    );
    lines.push(`\\\\ ${seq.description}`);
    lines.push(`\\\\ Index range: ${seq.startIndex} to ${seq.startIndex + seq.values.length - 1}`);
    lines.push(`${varname}_${seq.name} = [${vals.join(', ')}];`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatMathematica(data: SequenceData[], varname: string): string {
  const lines: string[] = [
    `(* Prime Terrain API - Mathematica format *)`,
    `(* Generated: ${new Date().toISOString()} *)`,
    '',
  ];

  for (const seq of data) {
    const vals = seq.values.map((v) =>
      isRational(v) ? `${v.num}/${v.den}` : v.toString()
    );
    lines.push(`(* ${seq.description} *)`);
    lines.push(`(* Index range: ${seq.startIndex} to ${seq.startIndex + seq.values.length - 1} *)`);
    lines.push(`${varname}${capitalize(seq.name)} = {${vals.join(', ')}};`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatSage(data: SequenceData[], varname: string): string {
  const lines: string[] = [
    `# Prime Terrain API - SageMath format`,
    `# Generated: ${new Date().toISOString()}`,
    '',
  ];

  for (const seq of data) {
    const vals = seq.values.map((v) => {
      if (isRational(v)) {
        return `Rational('${v.num}/${v.den}')`;
      }
      return v.toString();
    });
    lines.push(`# ${seq.description}`);
    lines.push(`# Index range: ${seq.startIndex} to ${seq.startIndex + seq.values.length - 1}`);
    lines.push(`${varname}_${seq.name} = [${vals.join(', ')}]`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatMaple(data: SequenceData[], varname: string): string {
  const lines: string[] = [
    `# Prime Terrain API - Maple format`,
    `# Generated: ${new Date().toISOString()}`,
    '',
  ];

  for (const seq of data) {
    const vals = seq.values.map((v) =>
      isRational(v) ? `${v.num}/${v.den}` : v.toString()
    );
    lines.push(`# ${seq.description}`);
    lines.push(`# Index range: ${seq.startIndex} to ${seq.startIndex + seq.values.length - 1}`);
    lines.push(`${varname}_${seq.name} := [${vals.join(', ')}]:`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatLaTeX(data: SequenceData[], columns: number): string {
  const lines: string[] = [
    `% Prime Terrain API - LaTeX format`,
    `% Generated: ${new Date().toISOString()}`,
    '',
  ];

  for (const seq of data) {
    lines.push(`% ${seq.description}`);
    lines.push(`% Index range: ${seq.startIndex} to ${seq.startIndex + seq.values.length - 1}`);
    lines.push('');

    // Inline format
    const vals = seq.values.slice(0, 20).map((v) =>
      isRational(v) ? `\\frac{${v.num}}{${v.den}}` : v.toString()
    );
    const more = seq.values.length > 20 ? ', \\ldots' : '';
    lines.push(`% Inline format:`);
    lines.push(`% $${seq.name} = ${vals.join(', ')}${more}$`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatLaTeXTable(data: SequenceData[], columns: number): string {
  const lines: string[] = [
    `% Prime Terrain API - LaTeX table format`,
    `% Generated: ${new Date().toISOString()}`,
    '',
  ];

  for (const seq of data) {
    lines.push(`% ${seq.description}`);
    lines.push(`\\begin{table}[h]`);
    lines.push(`\\centering`);
    lines.push(`\\caption{${seq.description}}`);
    lines.push(`\\begin{tabular}{${'c'.repeat(columns)}}`);
    lines.push(`\\hline`);

    // Header row with indices
    const headerStart = seq.startIndex;
    const headerVals = Array.from({ length: columns }, (_, i) => `$n=${headerStart + i}$`);
    lines.push(headerVals.join(' & ') + ' \\\\');
    lines.push(`\\hline`);

    // Data rows
    const vals = seq.values.map((v) =>
      isRational(v) ? `$\\frac{${v.num}}{${v.den}}$` : `$${v}$`
    );

    for (let i = 0; i < vals.length; i += columns) {
      const row = vals.slice(i, i + columns);
      while (row.length < columns) row.push('');
      lines.push(row.join(' & ') + ' \\\\');
    }

    lines.push(`\\hline`);
    lines.push(`\\end{tabular}`);
    lines.push(`\\end{table}`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatLaTeXArray(data: SequenceData[], columns: number): string {
  const lines: string[] = [
    `% Prime Terrain API - LaTeX array format`,
    `% Generated: ${new Date().toISOString()}`,
    '',
  ];

  for (const seq of data) {
    lines.push(`% ${seq.description}`);
    lines.push(`\\[`);
    lines.push(`${seq.name} = \\left[`);
    lines.push(`\\begin{array}{${'c'.repeat(columns)}}`);

    const vals = seq.values.map((v) =>
      isRational(v) ? `\\frac{${v.num}}{${v.den}}` : v.toString()
    );

    for (let i = 0; i < vals.length; i += columns) {
      const row = vals.slice(i, i + columns);
      const isLast = i + columns >= vals.length;
      lines.push(row.join(' & ') + (isLast ? '' : ' \\\\'));
    }

    lines.push(`\\end{array}`);
    lines.push(`\\right]`);
    lines.push(`\\]`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatJSONLD(data: SequenceData[]): object {
  return {
    '@context': {
      '@vocab': 'https://schema.org/',
      'oeis': 'https://oeis.org/',
      'pt': 'https://fractal-core.com/api/v1/',
    },
    '@type': 'Dataset',
    name: 'Prime Terrain Sequence Data',
    description: 'Mathematical sequences related to prime numbers',
    creator: {
      '@type': 'Organization',
      name: 'Prime Terrain API',
      url: 'https://fractal-core.com',
    },
    dateCreated: new Date().toISOString(),
    distribution: data.map((seq) => ({
      '@type': 'DataDownload',
      name: seq.name,
      description: seq.description,
      encodingFormat: 'application/json',
      contentUrl: `https://fractal-core.com/api/v1/formats?sequence=${seq.name}`,
    })),
    hasPart: data.map((seq) => ({
      '@type': 'Dataset',
      '@id': `pt:${seq.name}`,
      name: seq.name,
      description: seq.description,
      variableMeasured: {
        '@type': 'PropertyValue',
        name: seq.name,
        minValue: seq.startIndex,
        maxValue: seq.startIndex + seq.values.length - 1,
      },
      data: seq.values.map((v, i) => ({
        '@type': 'Observation',
        position: seq.indices[i],
        value: isRational(v) ? { numerator: v.num, denominator: v.den } : v.toString(),
      })),
    })),
  };
}

function formatNumPy(data: SequenceData[], varname: string): string {
  const lines: string[] = [
    `# Prime Terrain API - NumPy format`,
    `# Generated: ${new Date().toISOString()}`,
    `import numpy as np`,
    `from fractions import Fraction`,
    '',
  ];

  for (const seq of data) {
    lines.push(`# ${seq.description}`);
    lines.push(`# Index range: ${seq.startIndex} to ${seq.startIndex + seq.values.length - 1}`);

    if (seq.name === 'ratios') {
      // Ratios as Fraction objects or float array
      const fracVals = (seq.values as Rational[]).map(
        (v) => `Fraction(${v.num}, ${v.den})`
      );
      lines.push(`${varname}_${seq.name}_frac = [${fracVals.join(', ')}]`);
      const floatVals = (seq.values as Rational[]).map(
        (v) => (Number(v.num) / Number(v.den)).toFixed(10)
      );
      lines.push(`${varname}_${seq.name} = np.array([${floatVals.join(', ')}])`);
    } else {
      const vals = (seq.values as bigint[]).map((v) => v.toString());
      lines.push(`${varname}_${seq.name} = np.array([${vals.join(', ')}], dtype=np.int64)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatR(data: SequenceData[], varname: string): string {
  const lines: string[] = [
    `# Prime Terrain API - R format`,
    `# Generated: ${new Date().toISOString()}`,
    '',
  ];

  for (const seq of data) {
    lines.push(`# ${seq.description}`);
    lines.push(`# Index range: ${seq.startIndex} to ${seq.startIndex + seq.values.length - 1}`);

    if (seq.name === 'ratios') {
      const vals = (seq.values as Rational[]).map(
        (v) => (Number(v.num) / Number(v.den)).toFixed(10)
      );
      lines.push(`${varname}_${seq.name} <- c(${vals.join(', ')})`);
    } else {
      const vals = (seq.values as bigint[]).map((v) => v.toString());
      lines.push(`${varname}_${seq.name} <- c(${vals.join(', ')})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatJulia(data: SequenceData[], varname: string): string {
  const lines: string[] = [
    `# Prime Terrain API - Julia format`,
    `# Generated: ${new Date().toISOString()}`,
    '',
  ];

  for (const seq of data) {
    lines.push(`# ${seq.description}`);
    lines.push(`# Index range: ${seq.startIndex} to ${seq.startIndex + seq.values.length - 1}`);

    if (seq.name === 'ratios') {
      const vals = (seq.values as Rational[]).map((v) => `${v.num}//${v.den}`);
      lines.push(`${varname}_${seq.name} = Rational{BigInt}[${vals.join(', ')}]`);
    } else {
      const vals = (seq.values as bigint[]).map((v) => `big"${v}"`);
      lines.push(`${varname}_${seq.name} = BigInt[${vals.join(', ')}]`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============ Route Handler ============

formatsRoute.get('/', (c) => {
  const queryResult = FormatQuerySchema.safeParse(c.req.query());
  if (!queryResult.success) {
    return c.json({ error: 'Invalid parameters', details: queryResult.error.issues }, 400);
  }

  const { n, count, sequence, format, delimiter, header, columns, varname } = queryResult.data;
  const startIdx = parseInt(n, 10);
  const numTerms = parseInt(count, 10);
  const numColumns = parseInt(columns, 10);
  const includeHeader = header === 'true';

  const data = getSequenceData(sequence, startIdx, numTerms);

  switch (format as ExportFormat) {
    case 'csv':
      return c.text(formatCSV(data, delimiter, includeHeader));
    case 'tsv':
      return c.text(formatCSV(data, '\t', includeHeader));
    case 'pari':
      return c.text(formatPARI(data, varname));
    case 'mathematica':
      return c.text(formatMathematica(data, varname));
    case 'sage':
      return c.text(formatSage(data, varname));
    case 'maple':
      return c.text(formatMaple(data, varname));
    case 'latex':
      return c.text(formatLaTeX(data, numColumns));
    case 'latex-table':
      return c.text(formatLaTeXTable(data, numColumns));
    case 'latex-array':
      return c.text(formatLaTeXArray(data, numColumns));
    case 'json-ld':
      return c.json(formatJSONLD(data));
    case 'numpy':
      return c.text(formatNumPy(data, varname));
    case 'r':
      return c.text(formatR(data, varname));
    case 'julia':
      return c.text(formatJulia(data, varname));
    default:
      return c.json({ error: `Unsupported format: ${format}` }, 400);
  }
});

/**
 * GET /formats/info - List supported formats
 */
formatsRoute.get('/info', (c) => {
  return c.json({
    description: 'Multi-format sequence export',
    sequences: ['primes', 'gaps', 'd2', 'ratios', 'all'],
    formats: {
      tabular: {
        csv: 'Comma-separated values',
        tsv: 'Tab-separated values',
      },
      cas: {
        pari: 'PARI/GP vector notation',
        mathematica: 'Wolfram Mathematica list',
        sage: 'SageMath Python syntax',
        maple: 'Maple list notation',
      },
      latex: {
        latex: 'LaTeX inline math',
        'latex-table': 'LaTeX tabular environment',
        'latex-array': 'LaTeX array environment',
      },
      programming: {
        numpy: 'Python NumPy array',
        r: 'R vector',
        julia: 'Julia array',
      },
      semantic: {
        'json-ld': 'JSON-LD with schema.org context',
      },
    },
    parameters: {
      n: 'Starting index (default: 0)',
      count: 'Number of terms (default: 100, max: 10000)',
      sequence: 'Sequence: primes, gaps, d2, ratios, all',
      format: 'Output format (see formats above)',
      delimiter: 'CSV delimiter: , ; | \\t (default: ,)',
      header: 'Include CSV header: true/false',
      columns: 'LaTeX columns per row (default: 10)',
      varname: 'Variable name for CAS formats (default: seq)',
    },
    examples: [
      '/formats?sequence=primes&count=50&format=csv',
      '/formats?sequence=gaps&format=pari&varname=g',
      '/formats?sequence=all&format=mathematica',
      '/formats?sequence=d2&format=latex-table&columns=8',
      '/formats?sequence=ratios&format=json-ld',
    ],
  });
});

// ============ Helpers ============

function isRational(v: bigint | Rational): v is Rational {
  return typeof v === 'object' && 'num' in v && 'den' in v;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a === 0n ? 1n : a;
}
