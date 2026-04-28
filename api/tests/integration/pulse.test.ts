import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetKeys } from '../../src/config/keys.js';

const app = createApp();

beforeEach(() => {
  resetKeys();
});

async function get(path: string) {
  return app.fetch(new Request(`http://test.local${path}`));
}

async function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.fetch(
    new Request(`http://test.local${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  );
}

describe('GET /api/v1/pulse', () => {
  it('lists all four canonical systems', async () => {
    const res = await get('/api/v1/pulse');
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.service).toBe('fractal-core/pulse');
    const ids = data.systems.map((s: any) => s.id).sort();
    expect(ids).toEqual(['cosmic', 'milli', 'tonga', 'yad']);
  });
});

describe('GET /api/v1/pulse/:system_id/parameters', () => {
  it('returns the time-system descriptor + signing keys', async () => {
    const res = await get('/api/v1/pulse/cosmic/parameters');
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.time_system.id).toBe('cosmic');
    expect(data.time_system.tick_unit_label).toBe('Planck time');
    expect(data.time_system.disclosure).toContain('language models');
    expect(data.signing_keys.length).toBeGreaterThan(0);
  });

  it('404s for unknown system', async () => {
    const res = await get('/api/v1/pulse/bogus/parameters');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/pulse/:system_id/now', () => {
  it('returns a signed pulse for cosmic', async () => {
    const res = await get('/api/v1/pulse/cosmic/now');
    expect(res.status).toBe(200);
    const signed: any = await res.json();
    expect(signed.pulse.system_id).toBe('cosmic');
    expect(signed.pulse.prime).toMatch(/^[0-9]+$/);
    expect(signed.pulse.prime_bits).toBeGreaterThanOrEqual(256);
    expect(signed.signature.alg).toBe('ed25519');
    // /now does not include a request
    expect(signed.request).toBeUndefined();
  });

  it('returns hierarchical display for Yad', async () => {
    const res = await get('/api/v1/pulse/yad/now');
    const signed: any = await res.json();
    expect(signed.pulse.display).toBeDefined();
    expect(signed.pulse.display.yad_in_year).toBeTypeOf('number');
  });

  it('respects ?bit_target', async () => {
    const res = await get('/api/v1/pulse/milli/now?bit_target=128');
    const signed: any = await res.json();
    expect(signed.pulse.bit_target).toBe(128);
    expect(signed.pulse.prime_bits).toBeGreaterThanOrEqual(128);
    expect(signed.pulse.prime_bits).toBeLessThan(132);
  });

  it('?verbose=true includes audit', async () => {
    const res = await get('/api/v1/pulse/milli/now?verbose=true');
    const signed: any = await res.json();
    expect(signed.audit).toBeDefined();
    expect(signed.audit.candidates_tried.length).toBeGreaterThan(0);
  });
});

describe('POST /api/v1/pulse/:system_id/mint', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await postJson('/api/v1/pulse/cosmic/mint', {
      target_domain: 'post-social.com',
      nonce: '0123456789abcdef0123456789abcdef',
    });
    expect(res.status).toBe(401);
  });

  it('accepts admin API key + binds requester + target_domain', async () => {
    const ADMIN = 'test-admin-key';
    const env = { ADMIN_API_KEY: ADMIN } as any;
    const res = await app.fetch(
      new Request('http://test.local/api/v1/pulse/cosmic/mint', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${ADMIN}`,
        },
        body: JSON.stringify({
          target_domain: 'post-social.com',
          nonce: '0123456789abcdef0123456789abcdef',
          purpose: 'test',
        }),
      }),
      env
    );
    expect(res.status).toBe(200);
    const signed: any = await res.json();
    expect(signed.request.target_domain).toBe('post-social.com');
    expect(signed.request.requester_key_id).toBe('admin');
    expect(signed.request.nonce).toBe('0123456789abcdef0123456789abcdef');
    expect(signed.receipt.request_hash).not.toBe('');
    expect(signed.receipt.bundle_hash).not.toBe('');
    expect(signed.signature.alg).toBe('ed25519');
  });

  it('rejects invalid nonce', async () => {
    const ADMIN = 'test-admin-key';
    const env = { ADMIN_API_KEY: ADMIN } as any;
    const res = await app.fetch(
      new Request('http://test.local/api/v1/pulse/milli/mint', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${ADMIN}`,
        },
        body: JSON.stringify({
          target_domain: 'post-social.com',
          nonce: 'too-short',
        }),
      }),
      env
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/pulse/:system_id/verify', () => {
  it('verifies a freshly-minted pulse from /now', async () => {
    const nowRes = await get('/api/v1/pulse/milli/now');
    const signed: any = await nowRes.json();
    const verifyRes = await postJson('/api/v1/pulse/milli/verify', { signed });
    expect(verifyRes.status).toBe(200);
    const result: any = await verifyRes.json();
    expect(result.valid).toBe(true);
    expect(result.checks.signature).toBe(true);
    expect(result.checks.pulse_hash).toBe(true);
    expect(result.checks.prime_is_prime).toBe(true);
  });

  it('verifies a freshly-minted pulse from /mint (admin)', async () => {
    const ADMIN = 'test-admin-key';
    const env = { ADMIN_API_KEY: ADMIN } as any;
    const mintRes = await app.fetch(
      new Request('http://test.local/api/v1/pulse/milli/mint', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${ADMIN}`,
        },
        body: JSON.stringify({
          target_domain: 'post-social.com',
          nonce: '0123456789abcdef0123456789abcdef',
        }),
      }),
      env
    );
    const signed: any = await mintRes.json();
    const verifyRes = await postJson('/api/v1/pulse/milli/verify', { signed });
    const result: any = await verifyRes.json();
    expect(result.valid).toBe(true);
    expect(result.checks.signature).toBe(true);
    expect(result.checks.request_hash).toBe(true);
    expect(result.checks.bundle_hash).toBe(true);
  });

  it('rejects a tampered prime', async () => {
    const nowRes = await get('/api/v1/pulse/milli/now');
    const signed: any = await nowRes.json();
    signed.pulse.prime = '4'; // not prime, also breaks pulse_hash
    const verifyRes = await postJson('/api/v1/pulse/milli/verify', { signed });
    const result: any = await verifyRes.json();
    expect(result.valid).toBe(false);
  });
});
