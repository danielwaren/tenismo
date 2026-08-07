import { describe, it, expect } from 'vitest';
import { evaluateMarket, DEFAULT_VALUE_TIER_THRESHOLDS } from '../src/market';
import { fairOdds } from '../src/betting';

describe('fairOdds — caso del enunciado', () => {
  it('57% -> cuota justa ≈ 1.754', () => {
    expect(fairOdds(0.57)).toBeCloseTo(1.754, 3);
  });
});

describe('evaluateMarket', () => {
  it('sin cuota disponible -> SIN_CUOTA, pero fairOddsModel se sigue mostrando', () => {
    const r = evaluateMarket({ modelProb: 0.57, oddsDecimal: null, noVigProb: null });
    expect(r.tier).toBe('SIN_CUOTA');
    expect(r.fairOddsModel).toBeCloseTo(1.754, 3);
    expect(r.ev).toBeNull();
    expect(r.edgePp).toBeNull();
  });

  it('cuota inválida (<=1) -> NO_EVALUABLE', () => {
    const r = evaluateMarket({ modelProb: 0.57, oddsDecimal: 1, noVigProb: 0.5 });
    expect(r.tier).toBe('SIN_CUOTA'); // oddsDecimal=1 se trata como "sin cuota utilizable"
  });

  it('mercado a un solo lado (sin devig): usa la implícita cruda como referencia', () => {
    const r = evaluateMarket({ modelProb: 0.6, oddsDecimal: 1.9, noVigProb: null });
    expect(r.impliedProbRaw).toBeCloseTo(1 / 1.9, 6);
    expect(r.edgePp).toBeCloseTo((0.6 - 1 / 1.9) * 100, 6);
  });

  it('mercado a dos lados (con devig): la referencia es noVigProb, no la implícita cruda', () => {
    const r = evaluateMarket({ modelProb: 0.6, oddsDecimal: 1.9, noVigProb: 0.55 });
    expect(r.edgePp).toBeCloseTo((0.6 - 0.55) * 100, 6);
  });

  it('EV negativo -> SIN_VALUE, nunca se declara value sin cuota real', () => {
    const r = evaluateMarket({ modelProb: 0.4, oddsDecimal: 2.0, noVigProb: 0.5 });
    expect(r.ev).toBeLessThan(0);
    expect(r.tier).toBe('SIN_VALUE');
  });

  it('umbrales por defecto: EV justo debajo/encima de cada frontera', () => {
    const thr = DEFAULT_VALUE_TIER_THRESHOLDS;
    // odds tal que EV cae exactamente donde queremos: EV = p*odds - 1 -> odds = (1+EV)/p
    const p = 0.5;
    const oddsWeak = (1 + thr.weak + 0.001) / p;
    const oddsNormal = (1 + thr.normal + 0.001) / p;
    const oddsStrong = (1 + thr.strong + 0.001) / p;
    expect(evaluateMarket({ modelProb: p, oddsDecimal: oddsWeak, noVigProb: null }).tier).toBe('VALUE_DEBIL');
    expect(evaluateMarket({ modelProb: p, oddsDecimal: oddsNormal, noVigProb: null }).tier).toBe('VALUE');
    expect(evaluateMarket({ modelProb: p, oddsDecimal: oddsStrong, noVigProb: null }).tier).toBe('VALUE_FUERTE');
  });

  it('EV justo debajo del umbral débil -> SIN_VALUE', () => {
    const p = 0.5;
    const odds = (1 + DEFAULT_VALUE_TIER_THRESHOLDS.weak - 0.01) / p;
    expect(evaluateMarket({ modelProb: p, oddsDecimal: odds, noVigProb: null }).tier).toBe('SIN_VALUE');
  });
});
