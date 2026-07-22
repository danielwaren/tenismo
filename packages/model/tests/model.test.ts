import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ELO,
  expectedWinProb,
  kFactor,
  surfaceWeight,
  effectiveElo,
  confidence,
  predictMatch,
  updateRatings,
  tournamentWeight,
  brierScore,
  logLoss,
  brierSkillScore,
  reliabilityBins,
  devigTwoWay,
  slugFromShortName,
  slugFromFullName,
  normalizeName,
  isRealPlayer,
} from '../src/index';

describe('elo binario', () => {
  it('ratings iguales dan 50%', () => {
    expect(expectedWinProb(1500, 1500)).toBeCloseTo(0.5, 10);
  });

  it('400 puntos de ventaja dan 10/11 (~90.9%)', () => {
    expect(expectedWinProb(1900, 1500)).toBeCloseTo(10 / 11, 6);
  });

  it('las dos probabilidades suman 1 (no hay empate)', () => {
    const p = expectedWinProb(1720, 1540);
    expect(p + expectedWinProb(1540, 1720)).toBeCloseTo(1, 10);
  });

  it('el K decrece con la experiencia', () => {
    expect(kFactor(0)).toBeGreaterThan(kFactor(50));
    expect(kFactor(50)).toBeGreaterThan(kFactor(500));
    // Parametrización 538: 250/(0+5)^0.4 ≈ 131
    expect(kFactor(0)).toBeCloseTo(250 / Math.pow(5, 0.4), 6);
  });
});

describe('mezcla por superficie', () => {
  it('sin partidos en la superficie, el peso es 0 (solo cuenta el global)', () => {
    expect(surfaceWeight(0)).toBe(0);
    expect(effectiveElo({ elo: 1600, matches: 80 }, { elo: 1900, matches: 0 })).toBe(1600);
  });

  it('el peso crece con la muestra pero nunca supera el tope', () => {
    expect(surfaceWeight(20)).toBeCloseTo(0.5, 6);
    expect(surfaceWeight(100000)).toBe(DEFAULT_ELO.maxSurfaceWeight);
  });

  it('un especialista desplaza el rating efectivo hacia su superficie', () => {
    const eff = effectiveElo({ elo: 1600, matches: 200 }, { elo: 1900, matches: 60 });
    expect(eff).toBeGreaterThan(1600);
    expect(eff).toBeLessThan(1900);
  });
});

describe('predictMatch', () => {
  const especialistaArcilla = {
    overall: { elo: 1650, matches: 300 },
    surface: { elo: 1950, matches: 150 },
    name: 'Especialista',
  };
  const generalista = {
    overall: { elo: 1750, matches: 300 },
    surface: { elo: 1700, matches: 150 },
    name: 'Generalista',
  };

  it('la superficie puede invertir el favorito respecto al rating global', () => {
    const global = expectedWinProb(1650, 1750);
    const enArcilla = predictMatch({ surface: 'clay', p1: especialistaArcilla, p2: generalista });
    expect(global).toBeLessThan(0.5); // por Elo global es underdog
    expect(enArcilla.probP1).toBeGreaterThan(0.5); // en arcilla, favorito
  });

  it('las probabilidades suman 1 y la explicación no va vacía', () => {
    const r = predictMatch({ surface: 'clay', p1: especialistaArcilla, p2: generalista });
    expect(r.probP1 + r.probP2).toBeCloseTo(1, 10);
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('marca confianza baja y avisa en cold start', () => {
    const novato = { overall: { elo: 1500, matches: 1 }, surface: { elo: 1500, matches: 0 } };
    const veterano = { overall: { elo: 1800, matches: 400 }, surface: { elo: 1820, matches: 200 } };
    const r = predictMatch({ surface: 'hard', p1: novato, p2: veterano });
    expect(r.confidence).toBeLessThan(0.5);
    expect(r.reasons.some((x) => x.includes('paper trading'))).toBe(true);
  });

  it('la confianza la fija el jugador con MENOS historial', () => {
    const novato = { elo: 1500, matches: 0 };
    const veterano = { elo: 1800, matches: 400 };
    expect(confidence(novato, novato, veterano, veterano)).toBe(0);
  });
});

describe('updateRatings', () => {
  const base = {
    p1Overall: { elo: 1500, matches: 100 },
    p1Surface: { elo: 1500, matches: 40 },
    p2Overall: { elo: 1500, matches: 100 },
    p2Surface: { elo: 1500, matches: 40 },
  };

  it('el ganador sube y el perdedor baja lo mismo entre iguales', () => {
    const r = updateRatings({ ...base, p1Won: true });
    expect(r.p1Overall.elo).toBeGreaterThan(1500);
    expect(r.p2Overall.elo).toBeLessThan(1500);
    expect(r.p1Overall.elo - 1500).toBeCloseTo(1500 - r.p2Overall.elo, 10);
  });

  it('ganar como favorísimo mueve menos que ganar como underdog', () => {
    const favorito = updateRatings({
      p1Overall: { elo: 2000, matches: 100 },
      p1Surface: { elo: 2000, matches: 40 },
      p2Overall: { elo: 1400, matches: 100 },
      p2Surface: { elo: 1400, matches: 40 },
      p1Won: true,
    });
    const sorpresa = updateRatings({
      p1Overall: { elo: 1400, matches: 100 },
      p1Surface: { elo: 1400, matches: 40 },
      p2Overall: { elo: 2000, matches: 100 },
      p2Surface: { elo: 2000, matches: 40 },
      p1Won: true,
    });
    expect(sorpresa.p1Overall.elo - 1400).toBeGreaterThan(favorito.p1Overall.elo - 2000);
  });

  it('cuenta el partido en los cuatro ámbitos', () => {
    const r = updateRatings({ ...base, p1Won: false });
    expect(r.p1Overall.matches).toBe(101);
    expect(r.p1Surface.matches).toBe(41);
    expect(r.p2Overall.matches).toBe(101);
    expect(r.p2Surface.matches).toBe(41);
  });

  it('un Grand Slam mueve más el rating que un ATP250', () => {
    const slam = updateRatings({ ...base, p1Won: true, series: 'Grand Slam' });
    const peq = updateRatings({ ...base, p1Won: true, series: 'ATP250' });
    expect(slam.p1Overall.elo).toBeGreaterThan(peq.p1Overall.elo);
    expect(tournamentWeight('serie inventada')).toBe(1);
  });
});

describe('calibración', () => {
  const perfectos = [
    { prob: 1, actual: 1 as const },
    { prob: 0, actual: 0 as const },
  ];

  it('Brier 0 en el caso perfecto y 0.25 tirando una moneda', () => {
    expect(brierScore(perfectos)).toBe(0);
    expect(
      brierScore([
        { prob: 0.5, actual: 1 },
        { prob: 0.5, actual: 0 },
      ]),
    ).toBeCloseTo(0.25, 10);
  });

  it('log-loss no explota con probabilidad 0 en el evento ocurrido', () => {
    const ll = logLoss([{ prob: 0, actual: 1 }]);
    expect(isFinite(ll)).toBe(true);
    expect(ll).toBeGreaterThan(10);
  });

  it('el skill score es 0 cuando el modelo iguala la tasa base', () => {
    const rows = [
      { prob: 0.5, actual: 1 as const },
      { prob: 0.5, actual: 0 as const },
    ];
    expect(brierSkillScore(rows)).toBeCloseTo(0, 10);
  });

  it('los bins de fiabilidad reparten y promedian bien', () => {
    const bins = reliabilityBins(
      [
        { prob: 0.05, actual: 0 },
        { prob: 0.95, actual: 1 },
        { prob: 0.92, actual: 1 },
      ],
      10,
    );
    expect(bins[0].count).toBe(1);
    expect(bins[9].count).toBe(2);
    expect(bins[9].observed).toBe(1);
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(3);
  });

  it('devig reparte el margen y suma 1', () => {
    const d = devigTwoWay(1.8, 2.1)!;
    expect(d.p1 + d.p2).toBeCloseTo(1, 10);
    expect(d.p1).toBeGreaterThan(d.p2);
    // la implícita devigada es MENOR que la cruda (se quita el overround)
    expect(d.p1).toBeLessThan(1 / 1.8);
    expect(devigTwoWay(1, 2)).toBeNull();
  });
});

describe('nombres', () => {
  it('normaliza acentos y puntuación', () => {
    expect(normalizeName('Ruud C.')).toBe('ruud c');
    expect(normalizeName('Muñoz-Ávila J.')).toBe('munoz avila j');
  });

  it('slug de nombre abreviado separa apellido e inicial', () => {
    expect(slugFromShortName('Vukic A.')).toBe('vukic-a');
    expect(slugFromShortName('Auger-Aliassime F.')).toBe('auger aliassime-f');
    expect(slugFromShortName('O Connell C.')).toBe('o connell-c');
  });

  it('nombre completo y abreviado del mismo jugador dan el mismo slug', () => {
    expect(slugFromFullName('Alex Vukic')).toBe(slugFromShortName('Vukic A.'));
    expect(slugFromFullName('Felix Auger-Aliassime')).toBe(slugFromShortName('Auger-Aliassime F.'));
  });

  it('descarta huecos de cuadro', () => {
    expect(isRealPlayer('Bye')).toBe(false);
    expect(isRealPlayer('')).toBe(false);
    expect(isRealPlayer('Sinner J.')).toBe(true);
  });
});
