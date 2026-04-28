import { describe, it, expect } from 'vitest';
import {
  computeCurrentTick,
  pntEstimate,
  mintPulse,
  secureRandomBigInt,
  _internal,
} from '../../src/services/pulse-mint.js';
import { getTimeSystem, listTimeSystems, formatTickDisplay } from '../../src/services/time-systems.js';
import { primeEngine } from '../../src/services/engines/index.js';

describe('pulse-mint internals', () => {
  describe('lnBigInt', () => {
    it('matches Math.log on small numbers', () => {
      expect(_internal.lnBigInt(1n)).toBeCloseTo(0, 10);
      expect(_internal.lnBigInt(2n)).toBeCloseTo(Math.LN2, 10);
      expect(_internal.lnBigInt(1000n)).toBeCloseTo(Math.log(1000), 10);
    });

    it('agrees with closed form for huge BigInts', () => {
      // ln(10^60) = 60 * ln(10)
      const huge = 10n ** 60n;
      expect(_internal.lnBigInt(huge)).toBeCloseTo(60 * Math.LN10, 5);
    });

    it('throws on non-positive', () => {
      expect(() => _internal.lnBigInt(0n)).toThrow();
      expect(() => _internal.lnBigInt(-5n)).toThrow();
    });
  });

  describe('mulBigIntByNumber', () => {
    it('multiplies by integer factors exactly', () => {
      expect(_internal.mulBigIntByNumber(7n, 3)).toBe(21n);
      expect(_internal.mulBigIntByNumber(100n, 0.5)).toBe(50n);
    });

    it('handles huge multipliers (Planck inverse)', () => {
      // 1 second × (1/Planck) ≈ 1.85e+43 — must produce a BigInt with ~44 digits
      const result = _internal.mulBigIntByNumber(1n, 1.854927544e43);
      const digits = result.toString().length;
      expect(digits).toBeGreaterThanOrEqual(43);
      expect(digits).toBeLessThanOrEqual(44);
    });

    it('throws on non-finite', () => {
      expect(() => _internal.mulBigIntByNumber(1n, Infinity)).toThrow();
      expect(() => _internal.mulBigIntByNumber(1n, NaN)).toThrow();
    });
  });

  describe('secondsToTicks', () => {
    it('handles Earth-time scales precisely', () => {
      // 86400 seconds at tick=1s should give 86400 ticks
      expect(_internal.secondsToTicks(86400, 1)).toBe(86400n);
      expect(_internal.secondsToTicks(1, 0.001)).toBe(1000n);
    });

    it('routes huge tick rates through BigInt path', () => {
      // 1 second at Planck-time should give ~1.85e+43 ticks
      const ticks = _internal.secondsToTicks(1, 5.391247e-44);
      const digits = ticks.toString().length;
      expect(digits).toBeGreaterThanOrEqual(43);
    });
  });
});

describe('computeCurrentTick', () => {
  it('produces monotonically increasing ticks', async () => {
    const sys = getTimeSystem('milli')!;
    const t1 = computeCurrentTick(sys).tick;
    await new Promise((r) => setTimeout(r, 5));
    const t2 = computeCurrentTick(sys).tick;
    expect(t2).toBeGreaterThan(t1);
  });

  it('cosmic T is in the 200-bit class today', () => {
    const sys = getTimeSystem('cosmic')!;
    const { tick } = computeCurrentTick(sys);
    const bits = tick.toString(2).length;
    expect(bits).toBeGreaterThan(190);
    expect(bits).toBeLessThan(220);
  });

  it('tonga T is ~27M today (~25 bits)', () => {
    const sys = getTimeSystem('tonga')!;
    const { tick } = computeCurrentTick(sys);
    const days = Number(tick);
    // 74 ky × 365.25 ≈ 27,028,500 days
    expect(days).toBeGreaterThan(26_000_000);
    expect(days).toBeLessThan(28_000_000);
  });

  it('milli T is in the right ballpark (>1 month past 2026-01-01)', () => {
    const sys = getTimeSystem('milli')!;
    const { tick } = computeCurrentTick(sys);
    // Anything > 1 month of milliseconds (~2.6e9) is fine
    expect(Number(tick)).toBeGreaterThan(2_592_000_000);
  });
});

describe('pntEstimate', () => {
  it('returns roughly p_n × ln(n) for moderate n', () => {
    // p_1000 = 7919; PNT estimate at T=1000 should be in same magnitude
    const est = pntEstimate(1000n);
    expect(Number(est)).toBeGreaterThan(5000);
    expect(Number(est)).toBeLessThan(15000);
  });

  it('estimate of cosmic T has ~210 bits today', () => {
    const sys = getTimeSystem('cosmic')!;
    const { tick } = computeCurrentTick(sys);
    const est = pntEstimate(tick);
    const bits = est.toString(2).length;
    expect(bits).toBeGreaterThan(200);
    expect(bits).toBeLessThan(225);
  });
});

describe('secureRandomBigInt', () => {
  it('stays within range', () => {
    for (let i = 0; i < 50; i++) {
      const { value } = secureRandomBigInt(100n, 200n);
      expect(value).toBeGreaterThanOrEqual(100n);
      expect(value).toBeLessThan(200n);
    }
  });

  it('produces variety (not always the same value)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const { value } = secureRandomBigInt(0n, 1n << 64n);
      seen.add(value.toString());
    }
    expect(seen.size).toBeGreaterThan(40); // overwhelmingly likely to be 50
  });

  it('throws on empty range', () => {
    expect(() => secureRandomBigInt(5n, 5n)).toThrow();
    expect(() => secureRandomBigInt(10n, 5n)).toThrow();
  });
});

describe('mintPulse', () => {
  it('produces a prime at the requested bit-target (cosmic)', () => {
    const sys = getTimeSystem('cosmic')!;
    const { tick, audit } = computeCurrentTick(sys);
    const out = mintPulse({ system: sys, bit_target: 256, tick, tickAudit: audit });
    expect(out.pulse.prime_bits).toBeGreaterThanOrEqual(256);
    expect(out.pulse.prime_bits).toBeLessThanOrEqual(258);
    expect(primeEngine.isPrime(BigInt(out.pulse.prime))).toBe(true);
  });

  it('produces a prime at the default bit-target for tonga', () => {
    const sys = getTimeSystem('tonga')!;
    const { tick, audit } = computeCurrentTick(sys);
    const out = mintPulse({ system: sys, bit_target: sys.bit_target_default, tick, tickAudit: audit });
    expect(primeEngine.isPrime(BigInt(out.pulse.prime))).toBe(true);
  });

  it('audit log records every candidate tried', () => {
    const sys = getTimeSystem('milli')!;
    const { tick, audit } = computeCurrentTick(sys);
    const out = mintPulse({ system: sys, bit_target: 128, tick, tickAudit: audit });
    expect(out.audit.attempt_count).toBeGreaterThan(0);
    expect(out.audit.candidates_tried.length).toBe(out.audit.attempt_count);
    const last = out.audit.candidates_tried[out.audit.candidates_tried.length - 1];
    expect(last.result).toBe('probable_prime');
    expect(last.candidate).toBe(out.pulse.prime);
  });

  it('two consecutive mints almost certainly produce different primes', () => {
    const sys = getTimeSystem('cosmic')!;
    const { tick, audit } = computeCurrentTick(sys);
    const a = mintPulse({ system: sys, bit_target: 256, tick, tickAudit: audit });
    const b = mintPulse({ system: sys, bit_target: 256, tick, tickAudit: audit });
    expect(a.pulse.prime).not.toBe(b.pulse.prime);
  });
});

describe('time-system registry', () => {
  it('lists exactly four canonical systems', () => {
    const ids = listTimeSystems().map((s) => s.id).sort();
    expect(ids).toEqual(['cosmic', 'milli', 'tonga', 'yad']);
  });

  it('each system declares mint_cadence and signing parameters', () => {
    for (const s of listTimeSystems()) {
      expect(['fresh-per-mint', 'one-per-tick']).toContain(s.mint_cadence);
      expect(s.bit_target_default).toBeGreaterThanOrEqual(64);
      expect(s.window_bits).toBeGreaterThan(0);
      expect(s.disclosure).toContain('language models');
    }
  });

  it('formatTickDisplay produces hierarchical display for Yad', () => {
    const yad = getTimeSystem('yad')!;
    // 1 sidereal year ≈ 31_558_144 yad-seconds (512 × 61637)
    const display = formatTickDisplay(yad, 31558144n)!;
    expect(display.year_since_anchor).toBe('1');
    expect(display.yad_in_year).toBe(0);
    expect(display.yad_second_in_yad).toBe(0);
  });

  it('formatTickDisplay returns undefined for cosmic and milli', () => {
    expect(formatTickDisplay(getTimeSystem('cosmic')!, 100n)).toBeUndefined();
    expect(formatTickDisplay(getTimeSystem('milli')!, 100n)).toBeUndefined();
  });
});
