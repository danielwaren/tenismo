/**
 * Detección de torneos duplicados entre fuentes.
 *
 * EL PROBLEMA. Tres fuentes crean torneos y cada una lo llama distinto:
 * tennis-data dice "ATP Canadian Open", ESPN dice "National Bank Open presented
 * by Rogers" y The Odds API tiene el suyo. El enlace por nombre que hace
 * espn-ingest funciona cuando comparten alguna palabra distintiva ("Prague",
 * "Hamburg"), pero falla del todo cuando no comparten ninguna — y entonces
 * aparecen dos tarjetas del mismo torneo en el panel, una de ellas sin
 * superficie ni categoría.
 *
 * EL CRITERIO: LOS JUGADORES. Un tenista no puede estar en dos torneos a la vez.
 * Si dos torneos del mismo circuito tienen fechas solapadas y comparten varios
 * jugadores, son el mismo evento. Es una prueba mucho más fuerte que el nombre y
 * no depende de cómo lo escriba cada fuente. Verificado: el National Bank Open
 * de ESPN y el ATP Canadian Open de The Odds API comparten los 24 jugadores del
 * segundo, todos.
 *
 * POR QUÉ LOS CRITERIOS SON TAN ESTRICTOS. La primera versión de este fichero
 * pedía solo fechas solapadas y 4 jugadores en común, y fusionó Monte Carlo con
 * Miami. Dos cosas lo rompían:
 *
 *   · Los torneos de semanas contiguas SÍ se solapan por un día o dos, y sí
 *     comparten jugadores: los mismos que acaban uno empiezan el siguiente.
 *     "Un jugador no puede estar en dos torneos a la vez" solo vale si el
 *     solape es real, no si es el roce entre el domingo y el lunes.
 *   · El encadenado (A=B, B=C ⇒ A=C) convertía un enlace dudoso en una cascada:
 *     así entró el Mifel de Los Cabos en el Canadian Open.
 *
 * Ahora hacen falta DOS pruebas independientes y no se encadena nada. Una
 * fusión equivocada mete partidos de un torneo en otro y contamina el Elo por
 * superficie sin dejar rastro; un duplicado sin fusionar solo se ve feo.
 */

export interface TournamentAgg {
  id: number;
  tourId: number;
  season: number;
  name: string;
  surface: string | null;
  series: string | null;
  location: string | null;
  /** Fecha del primer y último partido, ISO. */
  from: string;
  to: string;
  matches: number;
  /** Jugadores que aparecen en el torneo. */
  players: Set<number>;
}

/** Mínimo de jugadores en común, en cualquiera de las dos vías. */
export const MIN_SHARED_PLAYERS = 4;
/** Contención mínima del torneo pequeño en el grande, sin ayuda del nombre. */
export const MIN_CONTAINMENT = 0.8;
/** Contención mínima cuando el nombre ya apunta al mismo sitio. */
export const MIN_CONTAINMENT_WITH_NAME = 0.3;
/** El solape de fechas tiene que cubrir esta parte del torneo más corto. */
export const MIN_DATE_OVERLAP = 0.5;

/** Palabras que no identifican un torneo: están en medio circuito. */
const GENERIC = new Set([
  'open', 'international', 'ladies', 'masters', 'atp', 'wta', 'championships',
  'cup', 'trophy', 'tennis', 'de', 'the', 'grand', 'prix', 'classic', 'tour',
  'presented', 'powered', 'by', 'championship', 'women', 'mens', 'men',
]);

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Palabras del nombre que sí identifican el evento ("prague", "hamburg"). */
export function distinctiveTokens(name: string): string[] {
  return normalize(name).split(' ').filter((t) => t.length >= 4 && !GENERIC.has(t));
}

/** ¿Comparten los nombres alguna palabra identificativa? */
export function shareName(a: TournamentAgg, b: TournamentAgg): boolean {
  const ta = new Set(distinctiveTokens(a.name));
  return distinctiveTokens(b.name).some((t) => ta.has(t));
}

const dias = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/** ¿Se solapan los rangos de fechas? (inclusive por los dos extremos) */
export function overlaps(a: TournamentAgg, b: TournamentAgg): boolean {
  return a.from <= b.to && b.from <= a.to;
}

/**
 * Qué fracción del torneo MÁS CORTO cubre el solape.
 *
 * Distingue el caso real (dos vistas del mismo evento: solape casi total) del
 * roce entre semanas consecutivas (un día de solape sobre una semana: 0,14).
 */
export function dateOverlapRatio(a: TournamentAgg, b: TournamentAgg): number {
  const ini = Math.max(dias(a.from), dias(b.from));
  const fin = Math.min(dias(a.to), dias(b.to));
  if (fin < ini) return 0;
  const solape = fin - ini + 1;
  const corto = Math.min(dias(a.to) - dias(a.from), dias(b.to) - dias(b.from)) + 1;
  return corto > 0 ? Math.min(solape / corto, 1) : 0;
}

export function sharedPlayers(a: TournamentAgg, b: TournamentAgg): number {
  const [small, big] = a.players.size <= b.players.size ? [a.players, b.players] : [b.players, a.players];
  let n = 0;
  for (const p of small) if (big.has(p)) n++;
  return n;
}

/** Qué parte del torneo con menos jugadores está dentro del otro. */
export function containment(a: TournamentAgg, b: TournamentAgg): number {
  const menor = Math.min(a.players.size, b.players.size);
  return menor > 0 ? sharedPlayers(a, b) / menor : 0;
}

/**
 * Dos torneos son el mismo evento si, además de circuito, temporada y un solape
 * de fechas sustancial, se cumple UNA de estas dos:
 *
 *   · el nombre comparte una palabra identificativa y hay jugadores en común
 *     ("Livesport Prague Open" y "Prague Open");
 *   · o los jugadores del pequeño están casi todos en el grande, aunque los
 *     nombres no se parezcan en nada ("National Bank Open presented by Rogers"
 *     y "ATP Canadian Open": 24 de 24).
 */
export function shouldMerge(a: TournamentAgg, b: TournamentAgg): boolean {
  if (a.id === b.id) return false;
  if (a.tourId !== b.tourId || a.season !== b.season) return false;
  if (!overlaps(a, b)) return false;
  if (dateOverlapRatio(a, b) < MIN_DATE_OVERLAP) return false;
  if (sharedPlayers(a, b) < MIN_SHARED_PLAYERS) return false;

  const c = containment(a, b);
  return shareName(a, b) ? c >= MIN_CONTAINMENT_WITH_NAME : c >= MIN_CONTAINMENT;
}

/**
 * Cuánta información aporta la fila. Gana la que trae superficie y categoría,
 * NO la que tiene más partidos: la superficie es justo lo que falta (ESPN no la
 * publica) y sin ella no se puede proyectar aces ni filtrar el Elo.
 */
export function metadataScore(t: TournamentAgg): number {
  return (t.surface ? 2 : 0) + (t.series ? 2 : 0) + (t.location ? 1 : 0);
}

/** De dos torneos iguales, cuál se queda. Determinista ante empates. */
export function pickCanonical(a: TournamentAgg, b: TournamentAgg): TournamentAgg {
  const sa = metadataScore(a);
  const sb = metadataScore(b);
  if (sa !== sb) return sa > sb ? a : b;
  if (a.matches !== b.matches) return a.matches > b.matches ? a : b;
  return a.id < b.id ? a : b;
}

export interface MergeGroup {
  canonical: TournamentAgg;
  duplicates: TournamentAgg[];
}

/** Pares descartados por ambigüedad, para poder revisarlos a mano. */
export interface SkippedPair {
  ids: [number, number];
  names: [string, string];
  reason: string;
}

export interface DuplicateReport {
  groups: MergeGroup[];
  skipped: SkippedPair[];
}

/**
 * Agrupa los torneos que son el mismo evento. SIN ENCADENAR.
 *
 * Solo se fusionan parejas que cumplen el criterio DIRECTAMENTE. Antes esto
 * usaba conjuntos disjuntos, y un enlace flojo bastaba para arrastrar a un
 * torneo entero que no tenía nada que ver: A=B y B=C hacía A=C aunque A y C no
 * compartieran ni un jugador. Así acabó el Mifel de Los Cabos dentro del
 * Canadian Open.
 *
 * Si un torneo queda como duplicado de uno y a la vez como superviviente de
 * otro, la situación es ambigua y NO se toca ninguno de los dos: se registra
 * para mirarlo a mano. Es la misma regla que ya rige la reconciliación de
 * partidos — adivinar sale más caro que dejarlo.
 */
export function findDuplicateGroups(list: TournamentAgg[]): DuplicateReport {
  const pares: { canonical: TournamentAgg; duplicate: TournamentAgg }[] = [];
  const skipped: SkippedPair[] = [];

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (!shouldMerge(list[i], list[j])) continue;
      const canonical = pickCanonical(list[i], list[j]);
      const duplicate = canonical.id === list[i].id ? list[j] : list[i];
      pares.push({ canonical, duplicate });
    }
  }

  const esDuplicado = new Set(pares.map((p) => p.duplicate.id));
  const esCanonico = new Set(pares.map((p) => p.canonical.id));

  const porCanonico = new Map<number, MergeGroup>();
  for (const p of pares) {
    // Un torneo que es duplicado en una pareja y superviviente en otra sería el
    // eslabón de una cadena. Se corta aquí.
    if (esDuplicado.has(p.canonical.id) || esCanonico.has(p.duplicate.id)) {
      skipped.push({
        ids: [p.canonical.id, p.duplicate.id],
        names: [p.canonical.name, p.duplicate.name],
        reason: 'encadenado con otra pareja',
      });
      continue;
    }
    const g = porCanonico.get(p.canonical.id) ?? { canonical: p.canonical, duplicates: [] };
    if (!g.duplicates.some((d) => d.id === p.duplicate.id)) g.duplicates.push(p.duplicate);
    porCanonico.set(p.canonical.id, g);
  }

  return { groups: [...porCanonico.values()], skipped };
}
