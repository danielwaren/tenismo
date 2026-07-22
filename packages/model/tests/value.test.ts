import { describe, it, expect } from 'vitest';
import {
  edge, kellyFraction, decideBet, clv, settleProfit, devigTwoWay,
  DEFAULT_STAKE_RULES,
} from '../src/index';

describe('ventaja sobre el mercado', () => {
  it('se mide contra la implícita DEVIGADA, no contra la cruda', () => {
    // Mercado con margen: 1.90 / 1.90 implica 52,6% cada uno (suma 105%).
    const dev = devigTwoWay(1.9, 1.9)!;
    expect(dev.p1).toBeCloseTo(0.5, 10);
    // Un modelo que diga 52% NO tiene ventaja aunque supere la implícita cruda.
    expect(edge(0.52, dev.p1)).toBeCloseTo(0.02, 10);
    expect(edge(0.52, 1 / 1.9)).toBeLessThan(0); // contra la cruda parecería peor
  });
});

describe('Kelly', () => {
  it('es cero cuando el modelo coincide con la cuota', () => {
    expect(kellyFraction(0.5, 2)).toBeCloseTo(0, 10);
  });

  it('crece con la ventaja y es negativo si el modelo va en contra', () => {
    expect(kellyFraction(0.6, 2)).toBeCloseTo(0.2, 10);
    expect(kellyFraction(0.4, 2)).toBeLessThan(0);
  });

  it('no explota con cuotas inválidas', () => {
    expect(kellyFraction(0.6, 1)).toBe(0);
    expect(kellyFraction(0.6, 0)).toBe(0);
  });
});

describe('decideBet', () => {
  const buena = { modelProb: 0.62, odds: 2.0, devigedProb: 0.5, confidence: 0.9 };

  it('apuesta cuando hay ventaja, confianza y Kelly positivo', () => {
    const d = decideBet(buena);
    expect(d.place).toBe(true);
    expect(d.stakeFraction).toBeGreaterThan(0);
    expect(d.reason).toContain('ventaja');
  });

  it('respeta el tope duro por apuesta', () => {
    // Ventaja enorme: Kelly/4 se dispararía, pero el tope lo corta.
    const d = decideBet({ modelProb: 0.95, odds: 3.0, devigedProb: 0.4, confidence: 1 });
    expect(d.stakeFraction).toBe(DEFAULT_STAKE_RULES.maxStakePct);
  });

  it('rechaza los cold start por confianza y lo explica', () => {
    const d = decideBet({ ...buena, confidence: 0.2 });
    expect(d.place).toBe(false);
    expect(d.reason).toContain('historial insuficiente');
  });

  it('rechaza cuando la ventaja no llega al mínimo', () => {
    const d = decideBet({ ...buena, modelProb: 0.505 });
    expect(d.place).toBe(false);
    expect(d.reason).toContain('ventaja');
    expect(d.stakeFraction).toBe(0);
  });

  it('rechaza cuotas inválidas', () => {
    expect(decideBet({ ...buena, odds: 1 }).place).toBe(false);
    expect(decideBet({ ...buena, odds: 0.5 }).reason).toContain('cuota inválida');
  });

  it('nunca devuelve stake positivo si no apuesta', () => {
    for (const c of [
      { ...buena, confidence: 0 },
      { ...buena, modelProb: 0.4 },
      { ...buena, odds: 1 },
    ]) {
      const d = decideBet(c);
      expect(d.place).toBe(false);
      expect(d.stakeFraction).toBe(0);
    }
  });
});

describe('CLV', () => {
  it('es positivo cuando se tomó mejor precio que el de cierre', () => {
    expect(clv(2.1, 2.0)).toBeCloseTo(0.05, 10);
    expect(clv(1.9, 2.0)).toBeCloseTo(-0.05, 10);
    expect(clv(2.0, 2.0)).toBe(0);
  });

  it('devuelve null con cuotas inutilizables', () => {
    expect(clv(2, 1)).toBeNull();
    expect(clv(1, 2)).toBeNull();
  });
});

describe('liquidación', () => {
  it('gana la ganancia neta y pierde el stake', () => {
    expect(settleProfit(10, 2.5, true)).toBeCloseTo(15, 10);
    expect(settleProfit(10, 2.5, false)).toBeCloseTo(-10, 10);
  });
});
