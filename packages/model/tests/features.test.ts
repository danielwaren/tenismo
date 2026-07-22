import { describe, it, expect } from 'vitest';
import {
  shrunkH2H, rankLogDiff, pointsLogDiff, loadDiff, intensityDiff, restDiff, formDiff,
  expDiff, bestOf5EloDiff, loadInWindow,
  gamesInWindow, daysSinceLast, recentForm, daysBetween, toArray, FEATURE_NAMES, UNRANKED,
  fitLogistic, predictProb, meanLogLoss, roundWeight, matchWeight,
  type RecentMatch, type FeatureVector,
} from '../src/index';

describe('features', () => {
  it('el head-to-head se encoge con poca muestra', () => {
    expect(shrunkH2H(0, 0)).toBe(0);
    expect(shrunkH2H(1, 0)).toBeCloseTo(1 / 3, 6);
    expect(shrunkH2H(8, 0)).toBeCloseTo(0.8, 6);
    // 8-0 debe pesar bastante más que 1-0
    expect(shrunkH2H(8, 0)).toBeGreaterThan(2 * shrunkH2H(1, 0));
    // antisimétrico
    expect(shrunkH2H(3, 5)).toBeCloseTo(-shrunkH2H(5, 3), 10);
  });

  it('el ranking es logarítmico y trata los ausentes como fuera del top', () => {
    expect(rankLogDiff(1, 100)).toBeGreaterThan(0); // p1 mejor
    expect(rankLogDiff(100, 1)).toBeCloseTo(-rankLogDiff(1, 100), 10);
    // 10 puestos abajo importa menos cuanto peor es el ranking
    expect(rankLogDiff(1, 11)).toBeGreaterThan(rankLogDiff(200, 210));
    expect(rankLogDiff(null, 50)).toBeCloseTo(Math.log(50) - Math.log(UNRANKED), 10);
    expect(rankLogDiff(0, 50)).toBe(rankLogDiff(null, 50)); // 0 = sin ranking
  });

  it('los puntos de ranking no explotan con ceros', () => {
    expect(pointsLogDiff(0, 0)).toBe(0);
    expect(Number.isFinite(pointsLogDiff(0, 9000))).toBe(true);
    expect(pointsLogDiff(9000, 0)).toBeGreaterThan(0);
  });

  it('la carga favorece a quien ha jugado menos partidos', () => {
    expect(loadDiff(1, 5)).toBeGreaterThan(0); // p1 ha jugado menos
    expect(loadDiff(5, 1)).toBeCloseTo(-loadDiff(1, 5), 10);
    expect(loadDiff(3, 3)).toBe(0);
  });

  it('la intensidad separa el desgaste del simple avance en el cuadro', () => {
    // Mismos 3 partidos, pero p1 los ganó cómodo y p2 a tres sets largos.
    const comodo = intensityDiff(3 * 15, 3, 3 * 33, 3);
    expect(comodo).toBeGreaterThan(0); // p1 llega menos desgastado
    // Misma intensidad por partido => 0, aunque el total de juegos difiera.
    expect(intensityDiff(60, 3, 40, 2)).toBeCloseTo(0, 10);
    // Sin partidos en la ventana, ambos neutros => 0.
    expect(intensityDiff(0, 0, 0, 0)).toBe(0);
  });

  it('la interacción con el mejor de 5 solo actúa en ese formato', () => {
    expect(bestOf5EloDiff(0.5, 5)).toBe(0.5);
    expect(bestOf5EloDiff(0.5, 3)).toBe(0);
    expect(bestOf5EloDiff(0.5, null)).toBe(0);
    // Sigue siendo antisimétrica.
    expect(bestOf5EloDiff(-0.5, 5)).toBeCloseTo(-bestOf5EloDiff(0.5, 5), 10);
  });

  it('el descanso tiene tope', () => {
    expect(restDiff(2, 2)).toBe(0);
    expect(restDiff(60, 2)).toBe(restDiff(21, 2)); // más de 21 días no suma
    expect(restDiff(null, 1)).toBeGreaterThan(0);  // sin partidos previos = descansado
  });

  it('forma y experiencia son diferencias antisimétricas', () => {
    expect(formDiff(0.1, -0.1)).toBeCloseTo(0.2, 10);
    expect(expDiff(100, 100)).toBe(0);
    expect(expDiff(200, 10)).toBeGreaterThan(0);
  });

  it('toArray respeta el orden canónico', () => {
    const f = Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, i])) as FeatureVector;
    expect(toArray(f)).toEqual(FEATURE_NAMES.map((_, i) => i));
  });
});

describe('ventana de partidos recientes', () => {
  const hist: RecentMatch[] = [
    { date: '2026-06-01', games: 30, surprise: 0.4 },
    { date: '2026-06-20', games: 22, surprise: -0.1 },
    { date: '2026-06-24', games: 38, surprise: 0.2 },
  ];

  it('cuenta días entre fechas', () => {
    expect(daysBetween('2026-06-01', '2026-06-24')).toBe(23);
    expect(daysBetween('2026-06-24', '2026-06-24')).toBe(0);
  });

  it('la carga solo suma los partidos dentro de la ventana', () => {
    // El del 1 de junio queda a 25 días: fuera de la ventana de 14.
    expect(gamesInWindow(hist, '2026-06-26', 14)).toBe(60);
    expect(gamesInWindow(hist, '2026-07-30', 14)).toBe(0);
    expect(gamesInWindow([], '2026-06-26', 14)).toBe(0);
    expect(loadInWindow(hist, '2026-06-26', 14)).toEqual({ games: 60, matches: 2 });
    expect(loadInWindow(hist, '2026-06-26', 60)).toEqual({ games: 90, matches: 3 });
  });

  it('el descanso mide desde el último partido', () => {
    expect(daysSinceLast(hist, '2026-06-26')).toBe(2);
    expect(daysSinceLast([], '2026-06-26')).toBeNull();
  });

  it('la forma promedia la sorpresa reciente', () => {
    expect(recentForm(hist, 10)).toBeCloseTo((0.4 - 0.1 + 0.2) / 3, 10);
    expect(recentForm(hist, 1)).toBeCloseTo(0.2, 10);
    expect(recentForm([], 10)).toBe(0);
  });
});

describe('pesos por ronda', () => {
  it('una final pesa más que una primera ronda', () => {
    expect(roundWeight('The Final')).toBeGreaterThan(roundWeight('1st Round'));
    expect(roundWeight('ronda inventada')).toBe(1);
    expect(roundWeight(null)).toBe(1);
  });

  it('el peso total combina categoría y ronda', () => {
    expect(matchWeight('Grand Slam', 'The Final')).toBeCloseTo(1.2 * 1.15, 10);
    // La nomenclatura WTA antigua también está contemplada.
    expect(matchWeight('Premier', '1st Round')).toBeGreaterThan(0);
    expect(matchWeight('International', '1st Round')).toBeLessThan(matchWeight('Premier', '1st Round'));
  });
});

describe('regresión logística', () => {
  // Datos sintéticos: y depende de la primera feature, la segunda es ruido puro.
  const X: number[][] = [];
  const y: number[] = [];
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 2000; i++) {
    const signal = rnd() * 4 - 2;
    const noise = rnd() * 4 - 2;
    const p = 1 / (1 + Math.exp(-1.5 * signal));
    X.push([signal, noise]);
    y.push(rnd() < p ? 1 : 0);
  }

  it('recupera el peso de la señal e ignora el ruido', () => {
    const model = fitLogistic(X, y, ['signal', 'noise'], { l2: 1 });
    expect(model.converged).toBe(true);
    expect(model.weights[0]).toBeGreaterThan(1.0);
    expect(Math.abs(model.weights[1])).toBeLessThan(0.3);
  });

  it('es antisimétrico: sin término independiente, invertir el signo da 1-p', () => {
    const model = fitLogistic(X, y, ['signal', 'noise'], { l2: 1 });
    const x = [0.8, -0.3];
    const flipped = x.map((v) => -v);
    expect(predictProb(x, model) + predictProb(flipped, model)).toBeCloseTo(1, 10);
    // Un partido entre iguales es exactamente 50%.
    expect(predictProb([0, 0], model)).toBeCloseTo(0.5, 10);
  });

  it('una penalización enorme aplasta los pesos hacia cero', () => {
    const suave = fitLogistic(X, y, ['signal', 'noise'], { l2: 1 });
    const dura = fitLogistic(X, y, ['signal', 'noise'], { l2: 1e6 });
    expect(Math.abs(dura.weights[0])).toBeLessThan(Math.abs(suave.weights[0]));
    expect(meanLogLoss(X, y, dura)).toBeGreaterThan(meanLogLoss(X, y, suave));
  });

  it('sin datos, falla explícitamente', () => {
    expect(() => fitLogistic([], [], ['a'])).toThrow(/sin datos/);
  });
});
