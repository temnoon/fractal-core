import { describe, it, expect } from 'vitest';
import { createApp } from '../../src/app.js';

describe('Multi-format export API', () => {
  const app = createApp();

  async function request(path: string) {
    const url = new URL(path, 'http://localhost');
    return app.request(url.toString());
  }

  describe('GET /api/v1/formats/info', () => {
    it('lists available formats', async () => {
      const res = await request('/api/v1/formats/info');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.formats.tabular).toBeDefined();
      expect(body.formats.cas).toBeDefined();
      expect(body.formats.latex).toBeDefined();
      expect(body.formats.programming).toBeDefined();
      expect(body.formats.semantic).toBeDefined();
    });
  });

  describe('CSV format', () => {
    it('returns primes as CSV', async () => {
      const res = await request('/api/v1/formats?sequence=primes&count=5&format=csv');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('index,primes');
      expect(text).toContain('0,2');
      expect(text).toContain('1,3');
      expect(text).toContain('2,5');
    });

    it('returns TSV format', async () => {
      const res = await request('/api/v1/formats?sequence=primes&count=3&format=tsv');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('index\tprimes');
      expect(text).toContain('0\t2');
    });

    it('returns all sequences as CSV', async () => {
      const res = await request('/api/v1/formats?sequence=all&count=3&format=csv');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('index,primes,gaps,d2,ratios');
    });
  });

  describe('PARI/GP format', () => {
    it('returns primes as PARI vector', async () => {
      const res = await request('/api/v1/formats?sequence=primes&count=5&format=pari&varname=p');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('p_primes = [2, 3, 5, 7, 11];');
    });

    it('returns gaps as PARI vector', async () => {
      const res = await request('/api/v1/formats?sequence=gaps&count=4&format=pari');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('seq_gaps = [1, 2, 2, 4];');
    });
  });

  describe('Mathematica format', () => {
    it('returns primes as Mathematica list', async () => {
      const res = await request('/api/v1/formats?sequence=primes&count=5&format=mathematica&varname=prime');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('primePrimes = {2, 3, 5, 7, 11};');
    });
  });

  describe('SageMath format', () => {
    it('returns primes as Sage list', async () => {
      const res = await request('/api/v1/formats?sequence=primes&count=5&format=sage');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('seq_primes = [2, 3, 5, 7, 11]');
    });

    it('returns ratios with Rational constructor', async () => {
      const res = await request('/api/v1/formats?sequence=ratios&count=3&format=sage');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('Rational(');
    });
  });

  describe('Maple format', () => {
    it('returns primes as Maple list', async () => {
      const res = await request('/api/v1/formats?sequence=primes&count=5&format=maple');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('seq_primes := [2, 3, 5, 7, 11]:');
    });
  });

  describe('LaTeX formats', () => {
    it('returns inline LaTeX', async () => {
      const res = await request('/api/v1/formats?sequence=primes&count=5&format=latex');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('$primes = 2, 3, 5, 7, 11');
    });

    it('returns LaTeX table', async () => {
      const res = await request('/api/v1/formats?sequence=primes&count=5&format=latex-table&columns=5');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('\\begin{table}');
      expect(text).toContain('\\begin{tabular}');
      expect(text).toContain('$2$ & $3$ & $5$ & $7$ & $11$');
    });

    it('returns LaTeX array', async () => {
      const res = await request('/api/v1/formats?sequence=gaps&count=4&format=latex-array&columns=4');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('\\begin{array}');
      expect(text).toContain('1 & 2 & 2 & 4');
    });

    it('formats ratios with \\frac', async () => {
      const res = await request('/api/v1/formats?sequence=ratios&count=1&format=latex-table&columns=1');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('\\frac{');
    });
  });

  describe('JSON-LD format', () => {
    it('returns JSON-LD with schema.org context', async () => {
      const res = await request('/api/v1/formats?sequence=primes&count=5&format=json-ld');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body['@context']).toBeDefined();
      expect(body['@context']['@vocab']).toBe('https://schema.org/');
      expect(body['@type']).toBe('Dataset');
      expect(body.hasPart).toBeInstanceOf(Array);
      expect(body.hasPart[0].data).toBeInstanceOf(Array);
    });
  });

  describe('NumPy format', () => {
    it('returns NumPy array code', async () => {
      const res = await request('/api/v1/formats?sequence=primes&count=5&format=numpy');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('import numpy as np');
      expect(text).toContain('np.array([2, 3, 5, 7, 11]');
      expect(text).toContain('dtype=np.int64');
    });
  });

  describe('R format', () => {
    it('returns R vector code', async () => {
      const res = await request('/api/v1/formats?sequence=primes&count=5&format=r');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('seq_primes <- c(2, 3, 5, 7, 11)');
    });
  });

  describe('Julia format', () => {
    it('returns Julia BigInt array', async () => {
      const res = await request('/api/v1/formats?sequence=primes&count=5&format=julia');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('BigInt[big"2", big"3", big"5", big"7", big"11"]');
    });

    it('returns ratios as Rational array', async () => {
      const res = await request('/api/v1/formats?sequence=ratios&count=3&format=julia');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('Rational{BigInt}[');
      expect(text).toContain('//');  // Julia rational notation
    });
  });
});
