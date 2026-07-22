import {
  DEFAULT_ELO,
  ROUND_WEIGHT,
  TOURNAMENT_WEIGHT,
  type EloParams,
  type MatchPrediction,
  type Rating,
  type RatingScope,
  type Surface,
} from './types';

/**
 * ELO POR SUPERFICIE — resultado BINARIO.
 *
 * Diferencia esencial con el modelo de fútbol de sports-trader-intelligence:
 * allí el reparto era 1X2 y hacía falta un término de empate (Bradley-Terry-
 * Davidson con `nu`) más una localía de +65. En tenis no hay empate y la sede
 * es neutra, así que la logística Elo clásica da directamente la probabilidad
 * final: P(gana A) = 1 / (1 + 10^((eloB - eloA)/400)).
 *
 * Lo que sí añade complejidad respecto al fútbol es la SUPERFICIE: un mismo
 * jugador puede ser top en arcilla y mediocre en hierba. Se mantiene un rating
 * global y uno por superficie, y se predice con una mezcla de los dos, pesada
 * por cuántos partidos tiene el jugador en esa superficie.
 */

/** Probabilidad logística de que A venza a B. Sin empate, sin localía. */
export function expectedWinProb(eloA: number, eloB: number): number {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

/**
 * K dinámico: alto en el debut (el rating inicial no informa nada) y decreciente
 * con la experiencia. Parametrización de FiveThirtyEight para tenis.
 */
export function kFactor(matches: number, params: EloParams = DEFAULT_ELO): number {
  return params.kNumerator / Math.pow(Math.max(0, matches) + params.kShift, params.kDecay);
}

/** Multiplicador de K según la categoría del torneo (normalizada a minúsculas). */
export function tournamentWeight(series?: string | null): number {
  if (!series) return TOURNAMENT_WEIGHT.default;
  return TOURNAMENT_WEIGHT[series.trim().toLowerCase()] ?? TOURNAMENT_WEIGHT.default;
}

/** Multiplicador de K según la ronda. */
export function roundWeight(round?: string | null): number {
  if (!round) return ROUND_WEIGHT.default;
  return ROUND_WEIGHT[round.trim().toLowerCase()] ?? ROUND_WEIGHT.default;
}

/** Peso total del partido: categoría × ronda. */
export function matchWeight(series?: string | null, round?: string | null): number {
  return tournamentWeight(series) * roundWeight(round);
}

/**
 * Peso que se le da al rating específico de superficie frente al global.
 * Con 0 partidos en la superficie el peso es 0 (se usa solo el global); crece
 * con la muestra hasta `maxSurfaceWeight`.
 */
export function surfaceWeight(matchesOnSurface: number, params: EloParams = DEFAULT_ELO): number {
  const raw = matchesOnSurface / (matchesOnSurface + params.surfaceShrinkage);
  return Math.min(raw, params.maxSurfaceWeight);
}

/**
 * Rating efectivo para predecir en una superficie: mezcla del global y el
 * específico. Encoger hacia el global evita que tres partidos afortunados en
 * hierba conviertan a alguien en especialista.
 */
export function effectiveElo(
  overall: Rating,
  onSurface: Rating,
  params: EloParams = DEFAULT_ELO,
): number {
  const w = surfaceWeight(onSurface.matches, params);
  return w * onSurface.elo + (1 - w) * overall.elo;
}

/**
 * Confianza 0..1 del pronóstico. Penaliza:
 *   · poco historial global del jugador con menos partidos (cold start),
 *   · poca muestra en la superficie concreta.
 * No mide "cuán seguro es el resultado" sino "cuánta información hay detrás".
 */
export function confidence(
  p1Overall: Rating,
  p1Surface: Rating,
  p2Overall: Rating,
  p2Surface: Rating,
  params: EloParams = DEFAULT_ELO,
): number {
  const hist = Math.min(p1Overall.matches, p2Overall.matches);
  const histScore = Math.min(1, hist / params.minMatchesConfident);
  const surf = Math.min(p1Surface.matches, p2Surface.matches);
  const surfScore = Math.min(1, surf / params.surfaceShrinkage);
  // El historial global pesa más: sin él no hay rating fiable de ningún tipo.
  return Math.round((0.65 * histScore + 0.35 * surfScore) * 100) / 100;
}

export interface PredictInput {
  surface: Surface;
  p1: { overall: Rating; surface: Rating; name?: string };
  p2: { overall: Rating; surface: Rating; name?: string };
}

const SURFACE_ES: Record<Surface, string> = {
  hard: 'pista dura',
  clay: 'arcilla',
  grass: 'hierba',
  carpet: 'moqueta',
};

/** Pronóstico completo, con la explicación en palabras que pide la ficha. */
export function predictMatch(input: PredictInput, params: EloParams = DEFAULT_ELO): MatchPrediction {
  const e1 = effectiveElo(input.p1.overall, input.p1.surface, params);
  const e2 = effectiveElo(input.p2.overall, input.p2.surface, params);
  const probP1 = expectedWinProb(e1, e2);

  const conf = confidence(
    input.p1.overall,
    input.p1.surface,
    input.p2.overall,
    input.p2.surface,
    params,
  );

  const n1 = input.p1.name ?? 'Jugador 1';
  const n2 = input.p2.name ?? 'Jugador 2';
  const surfName = SURFACE_ES[input.surface];
  const reasons: string[] = [];

  const diff = e1 - e2;
  const favName = diff >= 0 ? n1 : n2;
  reasons.push(
    `Elo efectivo en ${surfName}: ${n1} ${e1.toFixed(0)} vs ${n2} ${e2.toFixed(0)} ` +
      `(${Math.abs(diff).toFixed(0)} puntos a favor de ${favName}).`,
  );

  // Cuánto cambia la superficie el pronóstico frente al rating global puro.
  const probOverall = expectedWinProb(input.p1.overall.elo, input.p2.overall.elo);
  const shift = probP1 - probOverall;
  if (Math.abs(shift) >= 0.03) {
    const quien = shift > 0 ? n1 : n2;
    reasons.push(
      `La superficie mueve el pronóstico ${(Math.abs(shift) * 100).toFixed(1)} puntos ` +
        `porcentuales hacia ${quien} respecto al rating global.`,
    );
  } else {
    reasons.push(`La superficie apenas altera el pronóstico respecto al rating global.`);
  }

  const w1 = surfaceWeight(input.p1.surface.matches, params);
  const w2 = surfaceWeight(input.p2.surface.matches, params);
  reasons.push(
    `Muestra en ${surfName}: ${n1} ${input.p1.surface.matches} partidos ` +
      `(peso ${(w1 * 100).toFixed(0)}%), ${n2} ${input.p2.surface.matches} ` +
      `(peso ${(w2 * 100).toFixed(0)}%).`,
  );

  if (conf < 0.5) {
    reasons.push(
      `Confianza baja (${(conf * 100).toFixed(0)}%): historial insuficiente. ` +
        `Este partido no es apto para paper trading.`,
    );
  }

  return {
    probP1,
    probP2: 1 - probP1,
    effectiveEloP1: e1,
    effectiveEloP2: e2,
    confidence: conf,
    reasons,
  };
}

export interface EloUpdate {
  scope: RatingScope;
  before: number;
  after: number;
  delta: number;
}

/**
 * Actualiza los ratings tras un partido resuelto. Devuelve los cambios de los
 * cuatro ámbitos afectados: global y superficie, de cada jugador.
 *
 * `p1Won` es la etiqueta guardada en la base con el orden independiente del
 * resultado (ver db/migrations/001_schema.sql).
 *
 * Importante: la expectativa se calcula con el rating EFECTIVO (el mismo que se
 * usó para predecir), pero la actualización se aplica por separado al rating
 * global y al de superficie. Así el rating de superficie aprende de la sorpresa
 * medida en las condiciones reales del partido.
 */
export function updateRatings(
  args: {
    p1Overall: Rating;
    p1Surface: Rating;
    p2Overall: Rating;
    p2Surface: Rating;
    p1Won: boolean;
    /** Categoría del torneo, para escalar K. */
    series?: string | null;
    /** Ronda, para escalar K. */
    round?: string | null;
  },
  params: EloParams = DEFAULT_ELO,
): {
  p1Overall: Rating;
  p1Surface: Rating;
  p2Overall: Rating;
  p2Surface: Rating;
  updates: Record<'p1Overall' | 'p1Surface' | 'p2Overall' | 'p2Surface', EloUpdate>;
} {
  const e1 = effectiveElo(args.p1Overall, args.p1Surface, params);
  const e2 = effectiveElo(args.p2Overall, args.p2Surface, params);
  const exp1 = expectedWinProb(e1, e2);
  const score1 = args.p1Won ? 1 : 0;
  const w = matchWeight(args.series, args.round);

  const bump = (r: Rating, expected: number, score: number): Rating => ({
    elo: r.elo + kFactor(r.matches, params) * w * (score - expected),
    matches: r.matches + 1,
  });

  const p1Overall = bump(args.p1Overall, exp1, score1);
  const p1Surface = bump(args.p1Surface, exp1, score1);
  const p2Overall = bump(args.p2Overall, 1 - exp1, 1 - score1);
  const p2Surface = bump(args.p2Surface, 1 - exp1, 1 - score1);

  const mk = (scope: RatingScope, before: Rating, after: Rating): EloUpdate => ({
    scope,
    before: before.elo,
    after: after.elo,
    delta: after.elo - before.elo,
  });

  return {
    p1Overall,
    p1Surface,
    p2Overall,
    p2Surface,
    updates: {
      p1Overall: mk('all', args.p1Overall, p1Overall),
      p1Surface: mk('all', args.p1Surface, p1Surface),
      p2Overall: mk('all', args.p2Overall, p2Overall),
      p2Surface: mk('all', args.p2Surface, p2Surface),
    },
  };
}
