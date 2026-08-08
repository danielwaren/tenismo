import type { APIRoute } from 'astro';
import { getLiveTournaments, getOngoingTournaments, getUpcomingTournaments } from '../../../lib/queries';
import { getChallengerCalendar } from '../../../lib/challenger';
import { jsonCors as json, corsPreflight } from '../../../lib/api-cors';

export const prerender = false;

export const OPTIONS: APIRoute = async () => corsPreflight();

interface ActiveTournament {
  /** Solo sirve de clave en la lista. Va prefijado porque conviven dos espacios
   *  de identificadores: el id numérico de la base y el slug de Challenger. */
  id: string;
  name: string;
  tour: string;
  surface: string | null;
  live: boolean;
}

/**
 * Torneos en directo y próximos, para el selector del formulario de apuestas.
 *
 * Igual que el buscador de jugadores: escribir el torneo a mano se presta a
 * erratas ("National Bank Open" contra "ATP Canadian Open" contra "Canada"), y
 * el nombre es lo que después permite reconocer la apuesta y cruzarla con el
 * partido. Aquí la lista es corta —los que se juegan ahora o empiezan ya—, así
 * que se manda entera y el filtrado se hace en el cliente, sin una petición por
 * pulsación.
 *
 * DOS FUENTES, no una. ATP y WTA salen de la base; los Challenger NO están en
 * la base (se piden a tennisexplorer en cada visita y no se guardan nunca,
 * porque el torneo y la fecha son del proveedor, no nuestros), así que hay que
 * añadirlos aparte o el circuito Challenger del formulario queda sin ningún
 * torneo que elegir.
 */
export const GET: APIRoute = async () => {
  // Los EN CURSO son imprescindibles aquí, no un extra: casi siempre se apuesta
  // a un torneo que ya empezó. "Próximos" son solo los que aún no arrancan.
  //
  // El calendario Challenger va con catch propio: es una petición a un sitio
  // externo y si falla NO debe llevarse por delante la lista de ATP/WTA, que
  // es la que se usa la mayor parte del tiempo.
  const [live, ongoing, upcoming, challenger] = await Promise.all([
    getLiveTournaments(),
    getOngoingTournaments(20),
    getUpcomingTournaments(20),
    getChallengerCalendar().catch(() => null),
  ]);

  const deLaBase = (t: { id: number; name: string; tour: string; surface: string | null; live: number }): ActiveTournament => ({
    id: `db:${t.id}`, name: t.name, tour: t.tour, surface: t.surface, live: t.live > 0,
  });

  /*
   * Challenger: el snapshot es del DÍA (es lo único que da la fuente gratuita),
   * así que van todos los de hoy, no solo los que tienen un partido en juego en
   * este segundo — un torneo con partidos por empezar hoy es igual de apostable,
   * y el punto rojo distingue cuáles están de verdad en directo.
   *
   * `surface` va a null a propósito: tennisexplorer no publica la superficie.
   * Rellenarla con una suposición contaminaría el campo del formulario, que es
   * justo uno de los que usa el modelo para filtrar el Elo.
   */
  const enVivoCh = new Set(
    (challenger?.matches ?? []).filter((m) => m.status === 'live').map((m) => m.tournamentId),
  );
  const deChallenger: ActiveTournament[] = (challenger?.tournaments ?? []).map((t) => ({
    id: `ch:${t.id}`,
    name: t.name,
    tour: 'Challenger',
    surface: null,
    live: enVivoCh.has(t.id),
  }));

  const seen = new Set<string>();
  const salida: ActiveTournament[] = [];
  const añadir = (t: ActiveTournament) => {
    // Un torneo en directo también sale en "en curso": no se repite.
    if (seen.has(t.id)) return;
    seen.add(t.id);
    salida.push(t);
  };

  // Lo que se está jugando AHORA primero, sea del circuito que sea.
  for (const t of live.map(deLaBase)) añadir(t);
  for (const t of deChallenger.filter((t) => t.live)) añadir(t);
  for (const t of ongoing.map(deLaBase)) añadir(t);
  for (const t of upcoming.map(deLaBase)) añadir(t);
  for (const t of deChallenger.filter((t) => !t.live)) añadir(t);

  return json({ tournaments: salida });
};
