import { describe, it, expect } from 'vitest';
import { sigmoid, contributionsToWaterfall } from '../src/explain';

describe('sigmoid', () => {
  it('sigmoid(0) = 0.5 — la base sin intercepto del modelo', () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 12);
  });
  it('es monótona creciente', () => {
    expect(sigmoid(1)).toBeGreaterThan(sigmoid(0));
    expect(sigmoid(-1)).toBeLessThan(sigmoid(0));
  });
});

describe('contributionsToWaterfall', () => {
  it('sin contribuciones, la probabilidad final es la base (50%)', () => {
    const w = contributionsToWaterfall([]);
    expect(w.baseProb).toBeCloseTo(0.5, 10);
    expect(w.finalProb).toBeCloseTo(0.5, 10);
    expect(w.steps).toHaveLength(0);
  });

  it('reconcilia EXACTAMENTE con sigmoid(logit total), sea cual sea el orden', () => {
    const contribs = [
      { name: 'eloDiffSurface', contribution: 0.35 },
      { name: 'eloDiffOverall', contribution: 0.18 },
      { name: 'surfaceExpDiff', contribution: 0.09 },
      { name: 'expDiff', contribution: -0.06 },
      { name: 'formDiff', contribution: -0.03 },
      { name: 'markovLogit', contribution: -0.02 },
    ];
    const totalLogit = contribs.reduce((a, c) => a + c.contribution, 0);
    const expectedFinal = 1 / (1 + Math.exp(-totalLogit));

    const w = contributionsToWaterfall(contribs);
    expect(w.finalProb).toBeCloseTo(expectedFinal, 12);

    // Suma telescópica: base(%) + Σ pp = final(%), exacto.
    const sumaPP = w.steps.reduce((a, s) => a + s.pp, 0);
    expect(w.baseProb * 100 + sumaPP).toBeCloseTo(w.finalProb * 100, 9);

    // Reordenar cambia los pasos intermedios pero NUNCA el total.
    const reordenado = contributionsToWaterfall([...contribs].reverse());
    expect(reordenado.finalProb).toBeCloseTo(w.finalProb, 12);
    const sumaPP2 = reordenado.steps.reduce((a, s) => a + s.pp, 0);
    expect(reordenado.baseProb * 100 + sumaPP2).toBeCloseTo(reordenado.finalProb * 100, 9);
  });

  it('cada paso encadena probBefore/probAfter del anterior', () => {
    const contribs = [
      { name: 'a', contribution: 0.4 },
      { name: 'b', contribution: -0.2 },
    ];
    const w = contributionsToWaterfall(contribs);
    expect(w.steps[0].probBefore).toBeCloseTo(w.baseProb, 12);
    expect(w.steps[1].probBefore).toBeCloseTo(w.steps[0].probAfter, 12);
    expect(w.steps[1].probAfter).toBeCloseTo(w.finalProb, 12);
  });

  it('reproduce el ejemplo Arnaldi 43% / Griekspoor 57% (logit total ≈ 0.2814)', () => {
    // logit(0.57) ≈ 0.2814 — se reparte en factores que sumen eso.
    const totalLogit = Math.log(0.57 / 0.43);
    const contribs = [
      { name: 'eloDiffSurface', contribution: 0.19 },
      { name: 'eloDiffOverall', contribution: 0.1 },
      { name: 'surfaceExpDiff', contribution: 0.08 },
      { name: 'expDiff', contribution: -0.05 },
      { name: 'formDiff', contribution: -0.03 },
      { name: 'otros', contribution: totalLogit - (0.19 + 0.1 + 0.08 - 0.05 - 0.03) },
    ];
    const w = contributionsToWaterfall(contribs);
    expect(Math.round(w.finalProb * 100)).toBe(57);
  });
});
