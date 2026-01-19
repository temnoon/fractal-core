import { describe, it, expect } from 'vitest';
import { createApp } from '../../src/app.js';

describe('OEIS-compatible API', () => {
  const app = createApp();

  async function request(path: string) {
    const url = new URL(path, 'http://localhost');
    return app.request(url.toString());
  }

  describe('GET /api/v1/oeis', () => {
    it('lists available sequences', async () => {
      const res = await request('/api/v1/oeis');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.sequences).toBeInstanceOf(Array);
      expect(body.sequences.length).toBeGreaterThan(0);
      expect(body.formats).toContain('json');
      expect(body.formats).toContain('bfile');
    });
  });

  describe('GET /api/v1/oeis/primes', () => {
    it('returns primes in JSON format', async () => {
      const res = await request('/api/v1/oeis/primes?start=0&count=10');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.results).toBeInstanceOf(Array);
      expect(body.results[0].id).toBe('primes');
      expect(body.results[0].related).toContain('A000040');
      expect(body.results[0].data).toContain('2');
      expect(body.results[0].data).toContain('3');
      expect(body.results[0].data).toContain('5');
    });

    it('returns primes in b-file format', async () => {
      const res = await request('/api/v1/oeis/primes?start=0&count=5&format=bfile');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('0 2');
      expect(text).toContain('1 3');
      expect(text).toContain('2 5');
      expect(text).toContain('3 7');
      expect(text).toContain('4 11');
    });

    it('returns primes in list format', async () => {
      const res = await request('/api/v1/oeis/primes?start=0&count=5&format=list');
      expect(res.status).toBe(200);

      const text = await res.text();
      // Filter out header comment lines
      const lines = text.trim().split('\n').filter(line => !line.startsWith('#'));
      expect(lines).toEqual(['2', '3', '5', '7', '11']);
      // Also verify header includes starting prime
      expect(text).toContain('# Starting prime: p(0) = 2');
    });
  });

  describe('GET /api/v1/oeis/gaps', () => {
    it('returns prime gaps', async () => {
      const res = await request('/api/v1/oeis/gaps?start=0&count=10');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.results[0].id).toBe('gaps');
      expect(body.results[0].related).toContain('A001223');
      // First gaps: 3-2=1, 5-3=2, 7-5=2, 11-7=4
      expect(body.results[0].data).toMatch(/^1,2,2,4/);
    });

    it('returns gaps in b-file format', async () => {
      const res = await request('/api/v1/oeis/gaps?start=0&count=4&format=bfile');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('0 1');  // 3-2
      expect(text).toContain('1 2');  // 5-3
      expect(text).toContain('2 2');  // 7-5
      expect(text).toContain('3 4');  // 11-7
    });
  });

  describe('GET /api/v1/oeis/d2', () => {
    it('returns second differences', async () => {
      const res = await request('/api/v1/oeis/d2?start=0&count=10');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.results[0].id).toBe('d2');
      expect(body.results[0].related).toContain('A036263');
      // First d2: g1-g0 = 2-1=1, g2-g1 = 2-2=0, g3-g2 = 4-2=2
      expect(body.results[0].data).toMatch(/^1,0,2/);
    });
  });

  describe('GET /api/v1/oeis/ratios', () => {
    it('returns second ratios', async () => {
      const res = await request('/api/v1/oeis/ratios?start=0&count=10');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.results[0].id).toBe('ratios');
      expect(body.results[0].numerators).toBeInstanceOf(Array);
      expect(body.results[0].denominators).toBeInstanceOf(Array);
      // First ratio: d2=1, span=5-2=3, ratio=1/3
      expect(body.results[0].numerators[0]).toBe('1');
      expect(body.results[0].denominators[0]).toBe('3');
    });

    it('returns ratios in list format', async () => {
      const res = await request('/api/v1/oeis/ratios?start=0&count=3&format=list');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('1/3');  // First ratio
    });
  });

  describe('GET /api/v1/oeis/neighborhood', () => {
    it('returns full neighborhood data', async () => {
      const res = await request('/api/v1/oeis/neighborhood?n=10&k=3');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.center).toBeDefined();
      expect(body.center.index).toBe(10);
      expect(body.sequences).toBeDefined();
      expect(body.sequences.primes).toBeDefined();
      expect(body.sequences.gaps).toBeDefined();
      expect(body.sequences.d2).toBeDefined();
      expect(body.sequences.ratios).toBeDefined();
    });

    it('returns neighborhood in bfile format', async () => {
      const res = await request('/api/v1/oeis/neighborhood?n=10&k=2&format=bfile');
      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('# Prime Neighborhood Data');
      expect(text).toContain('# Primes:');
      expect(text).toContain('# Gaps:');
      expect(text).toContain('# Second differences:');
      expect(text).toContain('# Second ratios:');
    });
  });
});
