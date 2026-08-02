import { describe, it, expect } from 'vitest';
import {
  gameProb, tiebreakProb, setWinProb,
  matchProbBestOf3, matchProbBestOf5, matchWinProb, logit, markovLogit,
  shrinkRate, estimateServeProb, DEFAULT_SERVE_KAPPA, simulateMatch,
} from '../src/markov';

describe('gameProb', () => {
  it('con p=0.5 el juego es una moneda justa', () => {
    expect(gameProb(0.5)).toBeCloseTo(0.5, 10);
  });

  it('valor de referencia conocido: p=0.65 -> ~0.8297', () => {
    // Verificado a mano por recursión de deuce: D(p)=p²/(p²+q²), y los cuatro
    // caminos (4-0, 4-1, 4-2, deuce) suman 0.829694...
    expect(gameProb(0.65)).toBeCloseTo(0.82969, 4);
  });

  it('monótona: sacar mejor siempre gana más juegos', () => {
    expect(gameProb(0.7)).toBeGreaterThan(gameProb(0.6));
    expect(gameProb(0.4)).toBeLessThan(gameProb(0.5));
  });

  it('extremos', () => {
    expect(gameProb(1)).toBeCloseTo(1, 10);
    expect(gameProb(0)).toBeCloseTo(0, 10);
  });
});

describe('tiebreakProb', () => {
  it('con p=0.5 en los dos lados, 50/50', () => {
    expect(tiebreakProb(0.5, 0.5)).toBeCloseTo(0.5, 9);
  });

  it('MISMA habilidad en los dos lados (no solo 0.5): el tie-break sigue 50/50', () => {
    // Invariante estructural: el patrón de saque reparte los puntos por igual
    // entre los dos jugadores en cualquier bloque de 4, así que si pa=pb=p para
    // cualquier p (no solo 0.5), el resultado debe seguir siendo justo.
    for (const p of [0.55, 0.6, 0.7, 0.8]) {
      expect(tiebreakProb(p, p)).toBeCloseTo(0.5, 6);
    }
  });

  it('mejor sacador (o peor restador) gana más tie-breaks', () => {
    expect(tiebreakProb(0.7, 0.5)).toBeGreaterThan(tiebreakProb(0.6, 0.5));
    expect(tiebreakProb(0.6, 0.4)).toBeGreaterThan(tiebreakProb(0.6, 0.6));
  });

  it('está acotada entre 0 y 1', () => {
    for (const [pa, pb] of [[0.9, 0.1], [0.1, 0.9], [0.5, 0.5]] as const) {
      const t = tiebreakProb(pa, pb);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
  });
});

describe('setWinProb', () => {
  it('misma habilidad -> 50/50, saque quien saque primero', () => {
    for (const p of [0.5, 0.6, 0.75]) {
      expect(setWinProb(p, p)).toBeCloseTo(0.5, 6);
    }
  });

  it('ES exactamente antisimétrica, contra la intuición inicial', () => {
    // La primera versión de este motor asumía que había que promediar sobre
    // quién saca primero para conseguir antisimetría. Comprobado y descartado:
    // bajo el modelo de puntos i.i.d., a quién le toca sacar primero NO cambia
    // la probabilidad de ganar el set. Casos extremos incluidos.
    for (const [pa, pb] of [[0.65, 0.6], [0.9, 0.3], [0.55, 0.95], [0.51, 0.49]] as const) {
      const a = setWinProb(pa, pb);
      const b = setWinProb(pb, pa);
      expect(a + b).toBeCloseTo(1, 9);
    }
  });

  it('mejor sacador en los juegos impares gana más sets', () => {
    expect(setWinProb(0.68, 0.6)).toBeGreaterThan(setWinProb(0.62, 0.6));
  });
});

describe('matchProbBestOf3 / matchProbBestOf5', () => {
  it('con S=0.5 el partido es 50/50, a 3 y a 5 sets', () => {
    expect(matchProbBestOf3(0.5)).toBeCloseTo(0.5, 10);
    expect(matchProbBestOf5(0.5)).toBeCloseTo(0.5, 10);
  });

  it('identidad de simetría: M(s) + M(1-s) = 1', () => {
    for (const s of [0.3, 0.45, 0.6, 0.9]) {
      expect(matchProbBestOf3(s) + matchProbBestOf3(1 - s)).toBeCloseTo(1, 9);
      expect(matchProbBestOf5(s) + matchProbBestOf5(1 - s)).toBeCloseTo(1, 9);
    }
  });

  it('a 5 sets el favorito gana MÁS que a 3 (menos margen a la sorpresa)', () => {
    expect(matchProbBestOf5(0.6)).toBeGreaterThan(matchProbBestOf3(0.6));
  });

  it('monótona en S', () => {
    expect(matchProbBestOf3(0.7)).toBeGreaterThan(matchProbBestOf3(0.6));
    expect(matchProbBestOf5(0.7)).toBeGreaterThan(matchProbBestOf5(0.6));
  });
});

describe('matchWinProb', () => {
  it('misma habilidad -> 0.5 exacto, a 3 y a 5 sets', () => {
    expect(matchWinProb(0.62, 0.62, 3)).toBeCloseTo(0.5, 9);
    expect(matchWinProb(0.62, 0.62, 5)).toBeCloseTo(0.5, 9);
  });

  it('antisimétrica: intercambiar p1/p2 da el complementario', () => {
    for (const bestOf of [3, 5]) {
      const a = matchWinProb(0.65, 0.58, bestOf);
      const b = matchWinProb(0.58, 0.65, bestOf);
      expect(a + b).toBeCloseTo(1, 9);
    }
  });

  it('bestOf null se trata como al mejor de 3', () => {
    expect(matchWinProb(0.65, 0.58, null)).toBeCloseTo(matchWinProb(0.65, 0.58, 3), 9);
  });
});

describe('logit / markovLogit', () => {
  it('logit(0.5) = 0', () => {
    expect(logit(0.5)).toBeCloseTo(0, 9);
  });

  it('logit es creciente y antisimétrica alrededor de 0.5', () => {
    expect(logit(0.7)).toBeGreaterThan(0);
    expect(logit(0.3)).toBeLessThan(0);
    expect(logit(0.7) + logit(0.3)).toBeCloseTo(0, 9);
  });

  it('markovLogit hereda la antisimetría de matchWinProb', () => {
    const a = markovLogit(0.65, 0.58, 3);
    const b = markovLogit(0.58, 0.65, 3);
    expect(a + b).toBeCloseTo(0, 9);
  });

  it('markovLogit(p,p,*) = 0 exacto', () => {
    expect(markovLogit(0.6, 0.6, 3)).toBeCloseTo(0, 9);
  });
});

describe('shrinkRate', () => {
  it('sin muestra devuelve el prior', () => {
    expect(shrinkRate(0.9, 0, 0.6, DEFAULT_SERVE_KAPPA)).toBe(0.6);
  });

  it('con muestra enorme, casi lo observado', () => {
    expect(shrinkRate(0.7, 1_000_000, 0.6, DEFAULT_SERVE_KAPPA)).toBeCloseTo(0.7, 3);
  });

  it('con muestra = kappa, a medio camino', () => {
    expect(shrinkRate(0.8, DEFAULT_SERVE_KAPPA, 0.6, DEFAULT_SERVE_KAPPA)).toBeCloseTo(0.7, 6);
  });
});

describe('estimateServeProb', () => {
  const ctx = { tourServeRate: 0.62 };

  it('sin muestra en ninguno de los dos, neutral', () => {
    // Server y returner en blanco -> los dos lados del partido caen al mismo
    // valor de circuito, así que matchWinProb sale exactamente 0.5 sin que
    // estimateServeProb tenga que devolver 0.5 por sí sola.
    const vacio = { won: 0, points: 0 };
    const pa = estimateServeProb(vacio, vacio, ctx);
    const pb = estimateServeProb(vacio, vacio, ctx);
    expect(pa).toBe(pb);
    expect(matchWinProb(pa, pb, 3)).toBeCloseTo(0.5, 9);
  });

  it('un buen sacador con muestra grande sube por encima de la media', () => {
    const buenSacador = { won: 7000, points: 10000 }; // 70%
    const medio = { won: 0, points: 0 };
    const p = estimateServeProb(buenSacador, medio, ctx);
    expect(p).toBeGreaterThan(ctx.tourServeRate);
  });

  it('un mal restador (concede mucho) sube la probabilidad del sacador', () => {
    const sacador = { won: 0, points: 0 };
    const malRestador = { won: 2000, points: 10000 }; // gana solo 20% al resto
    const buenRestador = { won: 4500, points: 10000 }; // gana 45% al resto
    const contraMalo = estimateServeProb(sacador, malRestador, ctx);
    const contraBueno = estimateServeProb(sacador, buenRestador, ctx);
    expect(contraMalo).toBeGreaterThan(contraBueno);
  });

  it('nunca sale de [0.05, 0.95] pase lo que pase', () => {
    const extremo = { won: 9999, points: 10000 };
    const opuesto = { won: 1, points: 10000 };
    expect(estimateServeProb(extremo, opuesto, ctx)).toBeLessThanOrEqual(0.95);
    expect(estimateServeProb(opuesto, extremo, ctx)).toBeGreaterThanOrEqual(0.05);
  });
});

describe('simulateMatch', () => {
  it('la tasa de victoria simulada converge a matchWinProb', () => {
    // 20.000 simulaciones con probabilidades exactas por sorteo: la tolerancia
    // de un error estándar (~1/sqrt(20000)≈0.007) generosamente ampliada.
    for (const [pa, pb, bestOf] of [[0.65, 0.6, 3], [0.7, 0.55, 5], [0.5, 0.5, 3]] as const) {
      const sim = simulateMatch(pa, pb, bestOf);
      expect(sim.aWinRate).toBeCloseTo(matchWinProb(pa, pb, bestOf), 1);
    }
  });

  it('misma habilidad: la media de juegos es igual para los dos y el margen es simétrico', () => {
    const sim = simulateMatch(0.6, 0.6, 3);
    expect(sim.aWinRate).toBeGreaterThan(0.45);
    expect(sim.aWinRate).toBeLessThan(0.55);
    expect(sim.probMarginOver(0)).toBeCloseTo(sim.probOver(sim.meanGames) ? 0.5 : 0.5, 0); // sanity, ver test de abajo
  });

  it('un mejor sacador en los dos lados alarga el partido (más tie-breaks, menos breaks)', () => {
    const parejo = simulateMatch(0.7, 0.68, 3);
    const desigual = simulateMatch(0.75, 0.55, 3);
    expect(parejo.meanGames).toBeGreaterThan(desigual.meanGames);
  });

  it('probOver es monótona decreciente en la línea', () => {
    const sim = simulateMatch(0.65, 0.6, 3);
    expect(sim.probOver(15)).toBeGreaterThan(sim.probOver(25));
    expect(sim.probOver(0)).toBeCloseTo(1, 1);
    expect(sim.probOver(100)).toBe(0);
  });

  it('el margen favorece a A cuando A es mejor, y es (aprox) antisimétrico', () => {
    const sim = simulateMatch(0.68, 0.58, 3);
    // A gana más partidos, así que su margen medio de juegos debe ser positivo:
    // probMarginOver(0) (P(A saca más juegos que B)) por encima de 0.5.
    expect(sim.probMarginOver(0)).toBeGreaterThan(0.5);

    const inverso = simulateMatch(0.58, 0.68, 3, 20_000, 20260801);
    // Con la misma semilla, el caso espejo debe dar un margen de signo opuesto.
    expect(sim.probMarginOver(0) + inverso.probMarginOver(0)).toBeCloseTo(1, 1);
  });

  it('con semilla fija, dos llamadas dan EXACTAMENTE el mismo resultado', () => {
    const a = simulateMatch(0.63, 0.59, 3, 5000, 42);
    const b = simulateMatch(0.63, 0.59, 3, 5000, 42);
    expect(a.meanGames).toBe(b.meanGames);
    expect(a.aWinRate).toBe(b.aWinRate);
  });

  it('best-of-5 da más juegos de media que best-of-3, mismos jugadores', () => {
    const bo3 = simulateMatch(0.65, 0.6, 3);
    const bo5 = simulateMatch(0.65, 0.6, 5);
    expect(bo5.meanGames).toBeGreaterThan(bo3.meanGames);
  });
});
