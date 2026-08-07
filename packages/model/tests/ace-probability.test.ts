import { describe, it, expect } from 'vitest';
import { poissonPmf, poissonAtLeast, poissonOver, acesAtLeastBreakdown, totalAcesOverUnder } from '../src/ace-probability';

describe('poissonPmf', () => {
  it('lambda=0 concentra toda la probabilidad en k=0', () => {
    expect(poissonPmf(0, 0)).toBe(1);
    expect(poissonPmf(0, 1)).toBe(0);
  });
  it('las pmf de k=0..30 suman ~1', () => {
    let s = 0;
    for (let k = 0; k <= 30; k++) s += poissonPmf(8.6, k);
    expect(s).toBeCloseTo(1, 6);
  });
  it('k negativo o no entero da 0', () => {
    expect(poissonPmf(5, -1)).toBe(0);
    expect(poissonPmf(5, 2.5)).toBe(0);
  });
});

describe('poissonAtLeast', () => {
  it('P(X>=0) siempre es 1', () => {
    expect(poissonAtLeast(5, 0)).toBe(1);
    expect(poissonAtLeast(0, 0)).toBe(1);
  });
  it('lambda=0 hace P(X>=1) = 0', () => {
    expect(poissonAtLeast(0, 1)).toBe(0);
  });
  it('decrece con k', () => {
    const p3 = poissonAtLeast(8.6, 3);
    const p5 = poissonAtLeast(8.6, 5);
    const p7 = poissonAtLeast(8.6, 7);
    expect(p3).toBeGreaterThan(p5);
    expect(p5).toBeGreaterThan(p7);
  });
  it('media alta (8.6) da P(>=3) muy alta y P(>=20) casi nula', () => {
    expect(poissonAtLeast(8.6, 3)).toBeGreaterThan(0.9);
    expect(poissonAtLeast(8.6, 20)).toBeLessThan(0.01);
  });
});

describe('poissonOver — líneas X.5', () => {
  it('over de línea 2.5 exige X>=3', () => {
    expect(poissonOver(8.6, 2.5)).toBeCloseTo(poissonAtLeast(8.6, 3), 12);
  });
  it('over + under de la misma línea suman 1', () => {
    const over = poissonOver(8.6, 8.5);
    const under = 1 - over;
    expect(over + under).toBeCloseTo(1, 12);
  });
});

describe('acesAtLeastBreakdown', () => {
  it('devuelve los tres umbrales estándar, cada uno menor que el anterior', () => {
    const b = acesAtLeastBreakdown(9.2);
    expect(b.atLeast3).toBeGreaterThan(b.atLeast5);
    expect(b.atLeast5).toBeGreaterThan(b.atLeast7);
  });
  it('media 0 (sin datos utilizables) da todo 0, no NaN', () => {
    const b = acesAtLeastBreakdown(0);
    expect(b.atLeast3).toBe(0);
    expect(b.atLeast5).toBe(0);
    expect(b.atLeast7).toBe(0);
  });
});

describe('totalAcesOverUnder', () => {
  it('cada línea trae over+under=1 y respeta el orden de las líneas pedidas', () => {
    const rows = totalAcesOverUnder(18.4, [15.5, 17.5, 19.5, 21.5]);
    expect(rows.map((r) => r.line)).toEqual([15.5, 17.5, 19.5, 21.5]);
    for (const r of rows) expect(r.over + r.under).toBeCloseTo(1, 12);
    // Línea más baja -> más probable superarla.
    expect(rows[0].over).toBeGreaterThan(rows[3].over);
  });
});
