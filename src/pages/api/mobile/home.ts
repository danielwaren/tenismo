import type { APIRoute } from 'astro';
import {
  getStats, getUpcomingMatches, getUpcomingTournaments, getOngoingTournaments,
  getRecentTournaments, getAceEstimates,
} from '../../../lib/queries';
import { getLiveSnapshot } from '../../../lib/live';
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

  const [stats, upcoming, upcomingTourns, ongoingTourns, recentTourns] = await Promise.all([
    getStats(),
    getUpcomingMatches(40),
    getUpcomingTournaments(20),
    getOngoingTournaments(20),
    getRecentTournaments(9),
  ]);

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
    aces,
  });
};

export const OPTIONS: APIRoute = async () => corsPreflight();
