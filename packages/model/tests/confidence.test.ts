import { describe, it, expect } from 'vitest';
import { computeConfidence, type ConfidenceInputs } from '../src/confidence';

const base: ConfidenceInputs = {
  matchesP1: 400, matchesP2: 420,
  surfaceMatchesP1: 80, surfaceMatchesP2: 90,
  serveStatsReliable: true,
  modelProbP1: 0.57,
  markovProbP1: 0.55,
};

describe('computeConfidence', () => {
  it('muestra amplia + señales de acuerdo → banda ALTA', () => {
    const r = computeConfidence(base);
    expect(r.band).toBe('ALTA');
    expect(r.score).toBeGreaterThanOrEqual(70);
  });

  it('jugador sin historial (debut) → score bajo, banda BAJA', () => {
    const r = computeConfidence({
      ...base, matchesP1: 0, matchesP2: 420, surfaceMatchesP1: 0, surfaceMatchesP2: 90,
      serveStatsReliable: false,
    });
    expect(r.band).toBe('BAJA');
    expect(r.score).toBeLessThan(45);
  });

  it('sin estadísticas de saque reduce el score frente al mismo caso con cobertura', () => {
    const con = computeConfidence(base);
    const sin = computeConfidence({ ...base, serveStatsReliable: false });
    expect(sin.score).toBeLessThan(con.score);
  });

  it('desacuerdo grande entre señales reduce el score frente a acuerdo total', () => {
    const acuerdo = computeConfidence({ ...base, markovProbP1: 0.57 });
    const desacuerdo = computeConfidence({ ...base, markovProbP1: 0.3 });
    expect(desacuerdo.score).toBeLessThan(acuerdo.score);
  });

  it('sin segunda señal (markovProbP1 ausente) no penaliza como si hubiera desacuerdo total', () => {
    const { markovProbP1, ...sinMarkov } = base;
    const r = computeConfidence(sinMarkov as ConfidenceInputs);
    const desacuerdoTotal = computeConfidence({ ...base, markovProbP1: 1 - base.modelProbP1 });
    expect(r.score).toBeGreaterThan(desacuerdoTotal.score);
  });

  it('score siempre entre 0 y 100, breakdown pesa 1 en total', () => {
    const r = computeConfidence(base);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    const pesoTotal = r.breakdown.reduce((a, b) => a + b.weight, 0);
    expect(pesoTotal).toBeCloseTo(1, 9);
  });

  it('la explicación menciona el mínimo de partidos usado', () => {
    const r = computeConfidence(base);
    expect(r.explanation).toContain('400');
  });
});
