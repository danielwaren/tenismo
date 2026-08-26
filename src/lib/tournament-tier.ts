/**
 * ¿Vale la pena mandar un push cuando arranca este partido? Filtro para
 * "Notificación de partidos": Slams, Masters 1000/WTA1000 y Challenger
 * (pedido explícito — el resto del circuito, ATP/WTA 250/500, se queda fuera:
 * decenas de partidos en vivo cada día harían el aviso inútil por exceso).
 *
 * Dos señales, no una sola, porque ninguna alcanza sola con los datos reales:
 *   - `series` (de tournaments.series, convención tennis-data.co.uk) etiqueta
 *     bien Masters 1000/WTA1000, pero viene NULL para los Grand Slam en los
 *     torneos futuros/en vivo (verificado contra la base: "US Open" con
 *     series=null tanto en ATP como en WTA).
 *   - El NOMBRE de un Slam nunca lleva patrocinador (a diferencia de Masters
 *     1000 como "Western & Southern Financial Group Masters" — el nombre de
 *     Cincinnati con el sponsor del año puesto delante), así que buscar el
 *     nombre del Slam es la señal que SÍ es estable para ese caso.
 */

const GRAND_SLAM_NAMES = ['australian open', 'roland garros', 'french open', 'wimbledon', 'us open'];
const NOTABLE_SERIES = new Set(['grand slam', 'masters 1000', 'wta1000', 'masters cup', 'wta finals', 'atp finals', 'tour finals']);

export interface TournamentTierInput {
  tour: string;
  /** tournaments.series — puede venir null (ver cabecera). */
  series: string | null;
  name: string;
}

export function isNotableTournament(input: TournamentTierInput): boolean {
  if (input.tour === 'Challenger') return true;
  if (input.series && NOTABLE_SERIES.has(input.series.trim().toLowerCase())) return true;
  const name = input.name.toLowerCase();
  return GRAND_SLAM_NAMES.some((slam) => name.includes(slam));
}
