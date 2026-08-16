import type { APIRoute } from 'astro';
import {
  getStats, getUpcomingMatches, getUpcomingTournaments, getOngoingTournaments,
  getRecentTournaments, getAceEstimates,
} from '../../../lib/queries';
import { getLiveSnapshot } from '../../../lib/live';
import { getChallengerCalendar } from '../../../lib/challenger';
import { jsonCors, corsPreflight } from '../../../lib/api-cors';

export const prerender = false;

/**
 * Panel de inicio para la app móvil — mismo dato que pinta `index.astro`
 * (estadísticas, en vivo, próximos partidos, torneos), servido como JSON. La
 * app nunca toca la base directo: es un cliente HTTP más de esta API, igual
 * que la propia web. Ver el comentario de `db.ts` — eso no cambia por tener
 * ahora dos frentes (web + móvil) consumiéndola.
 */
export const GET: APIRoute = async () => {
  const liveSnapshot = await getLiveSnapshot();
  const liveMatches = liveSnapshot.matches;

  const [stats, upcoming, upcomingTourns, ongoingTourns, recentTourns, challengerSnapshot] = await Promise.all([
    getStats(),
    getUpcomingMatches(40),
    getUpcomingTournaments(20),
    getOngoingTournaments(20),
    getRecentTournaments(9),
    getChallengerCalendar(),
  ]);

  // Resumen liviano para el móvil: solo partidos EN VIVO sueltos (para su
  // propio carrusel) + torneos agrupados con conteo por estado. El resto de
  // los partidos "por jugar"/"jugados" sueltos no viaja — mismo criterio que
  // ya aplica `ChallengerCalendar.astro` en la web (ver ese archivo): con
  // nombres de jugador sin enlazar a la base (sin foto, sin id, sin
  // probabilidad del modelo), listarlos uno por uno no aporta tanto como
  // agruparlos por torneo.
  const challengerCounts = new Map<string, { name: string; matchCount: number; liveMatches: number; upcomingMatches: number; completedMatches: number }>();
  for (const m of challengerSnapshot.matches) {
    const acc = challengerCounts.get(m.tournamentId) ?? { name: m.tournament, matchCount: 0, liveMatches: 0, upcomingMatches: 0, completedMatches: 0 };
    acc.matchCount++;
    if (m.status === 'live') acc.liveMatches++;
    else if (m.status === 'completed') acc.completedMatches++;
    else acc.upcomingMatches++;
    challengerCounts.set(m.tournamentId, acc);
  }
  const challenger = {
    status: challengerSnapshot.status,
    source: challengerSnapshot.source,
    horizonDays: challengerSnapshot.horizonDays,
    liveMatches: challengerSnapshot.matches
      .filter((m) => m.status === 'live')
      .map((m) => ({
        id: m.id, tournament: m.tournament, tournamentId: m.tournamentId, round: m.round,
        player1: m.player1, player2: m.player2, score: m.score, status: m.status,
      })),
    tournaments: challengerSnapshot.tournaments.map((t) => {
      const c = challengerCounts.get(t.id);
      return {
        id: t.id, name: t.name, matchCount: t.matchCount,
        liveMatches: c?.liveMatches ?? 0, upcomingMatches: c?.upcomingMatches ?? 0, completedMatches: c?.completedMatches ?? 0,
      };
    }),
  };

  const aces = Object.fromEntries(
    await getAceEstimates([
      ...upcoming.map((m) => m.id),
      ...liveMatches.flatMap((m) => (m.internalId === null ? [] : [m.internalId])),
    ]),
  );

  // Mismo umbral de "datos desactualizados" que el banner de la web — la app
  // no debe verse más al día de lo que está la ingesta.
  const DIAS_AVISO = 2;
  const diasDesde = (iso: string | null) =>
    iso === null ? null : Math.floor((Date.now() - new Date(`${iso}T00:00:00Z`).getTime()) / 86_400_000);
  const antiguedad = diasDesde(stats.lastResult);

  return jsonCors({
    stats,
    stale: antiguedad !== null && antiguedad > DIAS_AVISO,
    live: { matches: liveMatches, status: liveSnapshot.status },
    upcoming,
    ongoingTournaments: ongoingTourns,
    upcomingTournaments: upcomingTourns,
    recentTournaments: recentTourns,
    challenger,
    aces,
  });
};

export const OPTIONS: APIRoute = async () => corsPreflight();
