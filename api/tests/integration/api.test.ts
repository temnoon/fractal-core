import { describe, it, expect, beforeAll } from 'vitest';
import { createApp } from '../../src/app.js';
import type { SignedResponse, VerifyResponse, FingerprintResponse } from '../../src/types/api.js';

describe('API integration tests', () => {
  const app = createApp();

  async function request(path: string, options?: RequestInit) {
    const url = new URL(path, 'http://localhost');
    return app.request(url.toString(), options);
  }

  describe('GET /api/v1/status', () => {
    it('returns status ok', async () => {
      const res = await request('/api/v1/status');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.version).toBe('1.0.0');
      expect(typeof body.uptime_seconds).toBe('number');
    });
  });

  describe('GET /api/v1/capabilities', () => {
    it('returns capabilities', async () => {
      const res = await request('/api/v1/capabilities');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.version).toBe('1.0.0');
      expect(body.engines).toContain('sieve');
      expect(body.formats).toContain('json');
      expect(body.signing_keys).toBeInstanceOf(Array);
      expect(body.signing_keys.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/v1/neighborhood', () => {
    it('returns neighborhood for index', async () => {
      const res = await request('/api/v1/neighborhood?n=100&k=5&include=primes,gaps,d2,ratio');
      expect(res.status).toBe(200);

      const body: SignedResponse = await res.json();
      expect(body.request.n).toBe('100');
      expect(body.request.n_type).toBe('index');
      expect(body.result.primes).toBeDefined();
      expect(body.result.primes!.length).toBe(11); // 5 + 1 + 5
      expect(body.result.gaps).toBeDefined();
      expect(body.result.d2).toBeDefined();
      expect(body.result.ratio).toBeDefined();
    });

    it('returns neighborhood for value', async () => {
      const res = await request('/api/v1/neighborhood?n=100&n_type=value&k=3');
      expect(res.status).toBe(200);

      const body: SignedResponse = await res.json();
      expect(body.request.n_type).toBe('value');
      expect(body.result.center_prime).toBeDefined();
    });

    it('returns receipt when requested', async () => {
      const res = await request('/api/v1/neighborhood?n=50&k=3&proof=receipt');
      expect(res.status).toBe(200);

      const body: SignedResponse = await res.json();
      expect(body.receipt).toBeDefined();
      expect(body.receipt!.request_hash).toBeDefined();
      expect(body.receipt!.result_hash).toBeDefined();
      expect(body.signature).toBeUndefined();
    });

    it('returns signature when requested', async () => {
      const res = await request('/api/v1/neighborhood?n=50&k=3&proof=signed');
      expect(res.status).toBe(200);

      const body: SignedResponse = await res.json();
      expect(body.receipt).toBeDefined();
      expect(body.signature).toBeDefined();
      expect(body.signature!.alg).toBe('ed25519');
      expect(body.signature!.sig_b64).toBeDefined();
    });

    it('rejects invalid parameters', async () => {
      const res = await request('/api/v1/neighborhood?n=invalid');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/gaps', () => {
    it('returns only gaps', async () => {
      const res = await request('/api/v1/gaps?n=100&k=5');
      expect(res.status).toBe(200);

      const body: SignedResponse = await res.json();
      expect(body.result.gaps).toBeDefined();
      expect(body.result.primes).toBeUndefined();
      expect(body.result.d2).toBeUndefined();
      expect(body.result.ratio).toBeUndefined();
    });
  });

  describe('GET /api/v1/second-differences', () => {
    it('returns only d2', async () => {
      const res = await request('/api/v1/second-differences?n=100&k=5');
      expect(res.status).toBe(200);

      const body: SignedResponse = await res.json();
      expect(body.result.d2).toBeDefined();
      expect(body.result.primes).toBeUndefined();
      expect(body.result.gaps).toBeUndefined();
      expect(body.result.ratio).toBeUndefined();
    });
  });

  describe('GET /api/v1/second-ratios', () => {
    it('returns only ratios', async () => {
      const res = await request('/api/v1/second-ratios?n=100&k=5');
      expect(res.status).toBe(200);

      const body: SignedResponse = await res.json();
      expect(body.result.ratio).toBeDefined();
      expect(body.result.primes).toBeUndefined();
      expect(body.result.gaps).toBeUndefined();
      expect(body.result.d2).toBeUndefined();
    });
  });

  describe('GET /api/v1/fingerprint', () => {
    it('returns hashes without payload', async () => {
      const res = await request('/api/v1/fingerprint?n=100&k=5');
      expect(res.status).toBe(200);

      const body: FingerprintResponse = await res.json();
      expect(body.request_hash).toBeDefined();
      expect(body.result_hash).toBeDefined();
      expect(body.engines).toBeDefined();
      expect(body.generated_at).toBeDefined();
    });
  });

  describe('POST /api/v1/verify', () => {
    it('verifies valid signed response', async () => {
      // First get a signed response
      const signedRes = await request('/api/v1/neighborhood?n=50&k=3&proof=signed');
      const signedBody: SignedResponse = await signedRes.json();

      // Verify it
      const verifyRes = await request('/api/v1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signedBody),
      });
      expect(verifyRes.status).toBe(200);

      const verifyBody: VerifyResponse = await verifyRes.json();
      expect(verifyBody.valid).toBe(true);
      expect(verifyBody.checks.request_hash.match).toBe(true);
      expect(verifyBody.checks.result_hash.match).toBe(true);
      expect(verifyBody.checks.signature?.valid).toBe(true);
    });

    it('detects tampered response', async () => {
      // Get a signed response
      const signedRes = await request('/api/v1/neighborhood?n=50&k=3&proof=signed');
      const signedBody: SignedResponse = await signedRes.json();

      // Tamper with result
      signedBody.result.center_prime = '999999';

      // Verify it
      const verifyRes = await request('/api/v1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signedBody),
      });
      expect(verifyRes.status).toBe(200);

      const verifyBody: VerifyResponse = await verifyRes.json();
      expect(verifyBody.valid).toBe(false);
    });
  });

  describe('Jobs API', () => {
    it('creates and retrieves job', async () => {
      // Create job
      const createRes = await request('/api/v1/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          n: '100',
          k: 5,
          proof: 'signed',
        }),
      });
      expect(createRes.status).toBe(202);

      const createBody = await createRes.json();
      expect(createBody.job_id).toBeDefined();
      // Status could be 'pending' or 'running' due to async processing
      expect(['pending', 'running', 'completed']).toContain(createBody.status);

      // Wait for job to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Get job status
      const statusRes = await request(`/api/v1/jobs/${createBody.job_id}`);
      expect(statusRes.status).toBe(200);

      const statusBody = await statusRes.json();
      expect(statusBody.status).toBe('completed');

      // Get result
      const resultRes = await request(`/api/v1/jobs/${createBody.job_id}/result`);
      expect(resultRes.status).toBe(200);

      const resultBody: SignedResponse = await resultRes.json();
      expect(resultBody.result.primes).toBeDefined();
      expect(resultBody.signature).toBeDefined();
    });

    it('returns 404 for unknown job', async () => {
      const res = await request('/api/v1/jobs/nonexistent');
      expect(res.status).toBe(404);
    });
  });
});
