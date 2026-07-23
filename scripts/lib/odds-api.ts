/**
 * The Odds API — cuotas de partidos FUTUROS.
 *
 * Por qué hace falta: tennis-data.co.uk solo publica partidos ya jugados, así
 * que esta API no es solo la fuente de cuotas sino la ÚNICA fuente de calendario
 * futuro que tiene el proyecto.
 *
 * COBERTURA REAL (verificada 2026-07-22): 41 claves de torneo, no una clave
 * "tenis" global. Son los torneos grandes — Grand Slams, Masters 1000 y algunos
 * 500. Los ATP/WTA 250 NO están cubiertos, y hay semanas enteras del calendario
 * sin ningún torneo cubierto.
 *
 * CUOTA: /v4/sports (listar) es gratis; cada consulta de cuotas cuesta
 * markets × regions = 1 crédito con regions=eu&markets=h2h. Con 2-6 torneos
 * activos a la vez salen ~60-180 créditos/mes de los 500 del plan gratuito.
 * El histórico NO está disponible en el plan gratuito.
 */

export const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

export interface OddsApiSport {
  key: string;
  active: boolean;
  title: string;
}

export interface OddsApiOutcome { name: string; price: number }
export interface OddsApiMarket { key: string; outcomes: OddsApiOutcome[] }
export interface OddsApiBookmaker { key: string; title: string; markets: OddsApiMarket[] }
export interface OddsApiEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

/**
 * Superficie y tipo de pista por torneo.
 *
 * Este mapa es un riesgo de corrección: una superficie equivocada mete al
 * modelo en el rating que no toca. Ojo con dos trampas reales:
 *   · `tennis_atp_hamburg_open` es tierra batida, pero `tennis_wta_german_open`
 *     es BERLÍN, que se juega en HIERBA. Nombres parecidos, superficies opuestas.
 *   · `tennis_wta_stuttgart_open` es tierra batida BAJO TECHO.
 *
 * Si una clave no está aquí, la superficie queda a null: el modelo usa solo el
 * rating global, que es una degradación honesta en vez de una suposición.
 */
export const TOURNAMENT_INFO: Record<string, { surface: string; court: string; series: string }> = {
  // ── Grand Slams ──
  tennis_atp_aus_open_singles: { surface: 'hard', court: 'outdoor', series: 'Grand Slam' },
  tennis_wta_aus_open_singles: { surface: 'hard', court: 'outdoor', series: 'Grand Slam' },
  tennis_atp_french_open: { surface: 'clay', court: 'outdoor', series: 'Grand Slam' },
  tennis_wta_french_open: { surface: 'clay', court: 'outdoor', series: 'Grand Slam' },
  tennis_atp_wimbledon: { surface: 'grass', court: 'outdoor', series: 'Grand Slam' },
  tennis_wta_wimbledon: { surface: 'grass', court: 'outdoor', series: 'Grand Slam' },
  tennis_atp_us_open: { surface: 'hard', court: 'outdoor', series: 'Grand Slam' },
  tennis_wta_us_open: { surface: 'hard', court: 'outdoor', series: 'Grand Slam' },

  // ── Tierra batida ──
  tennis_atp_monte_carlo_masters: { surface: 'clay', court: 'outdoor', series: 'Masters 1000' },
  tennis_atp_madrid_open: { surface: 'clay', court: 'outdoor', series: 'Masters 1000' },
  tennis_wta_madrid_open: { surface: 'clay', court: 'outdoor', series: 'WTA1000' },
  tennis_atp_italian_open: { surface: 'clay', court: 'outdoor', series: 'Masters 1000' },
  tennis_wta_italian_open: { surface: 'clay', court: 'outdoor', series: 'WTA1000' },
  tennis_atp_barcelona_open: { surface: 'clay', court: 'outdoor', series: 'ATP500' },
  tennis_atp_hamburg_open: { surface: 'clay', court: 'outdoor', series: 'ATP500' },
  tennis_atp_munich: { surface: 'clay', court: 'outdoor', series: 'ATP250' },
  tennis_wta_charleston_open: { surface: 'clay', court: 'outdoor', series: 'WTA500' },
  tennis_wta_strasbourg: { surface: 'clay', court: 'outdoor', series: 'WTA500' },
  tennis_wta_stuttgart_open: { surface: 'clay', court: 'indoor', series: 'WTA500' },

  // ── Hierba (ojo: german_open = Berlín = hierba) ──
  tennis_atp_halle_open: { surface: 'grass', court: 'outdoor', series: 'ATP500' },
  tennis_atp_queens_club_champ: { surface: 'grass', court: 'outdoor', series: 'ATP500' },
  tennis_wta_queens_club_champ: { surface: 'grass', court: 'outdoor', series: 'WTA500' },
  tennis_wta_bad_homburg_open: { surface: 'grass', court: 'outdoor', series: 'WTA500' },
  tennis_wta_german_open: { surface: 'grass', court: 'outdoor', series: 'WTA500' },

  // ── Pista dura ──
  tennis_atp_indian_wells: { surface: 'hard', court: 'outdoor', series: 'Masters 1000' },
  tennis_wta_indian_wells: { surface: 'hard', court: 'outdoor', series: 'WTA1000' },
  tennis_atp_miami_open: { surface: 'hard', court: 'outdoor', series: 'Masters 1000' },
  tennis_wta_miami_open: { surface: 'hard', court: 'outdoor', series: 'WTA1000' },
  tennis_atp_canadian_open: { surface: 'hard', court: 'outdoor', series: 'Masters 1000' },
  tennis_wta_canadian_open: { surface: 'hard', court: 'outdoor', series: 'WTA1000' },
  tennis_atp_cincinnati_open: { surface: 'hard', court: 'outdoor', series: 'Masters 1000' },
  tennis_wta_cincinnati_open: { surface: 'hard', court: 'outdoor', series: 'WTA1000' },
  tennis_atp_shanghai_masters: { surface: 'hard', court: 'outdoor', series: 'Masters 1000' },
  tennis_atp_paris_masters: { surface: 'hard', court: 'indoor', series: 'Masters 1000' },
  tennis_atp_china_open: { surface: 'hard', court: 'outdoor', series: 'ATP500' },
  tennis_wta_china_open: { surface: 'hard', court: 'outdoor', series: 'WTA1000' },
  tennis_wta_wuhan_open: { surface: 'hard', court: 'outdoor', series: 'WTA1000' },
  tennis_atp_dubai: { surface: 'hard', court: 'outdoor', series: 'ATP500' },
  tennis_wta_dubai: { surface: 'hard', court: 'outdoor', series: 'WTA1000' },
  tennis_atp_qatar_open: { surface: 'hard', court: 'outdoor', series: 'ATP500' },
  tennis_wta_qatar_open: { surface: 'hard', court: 'outdoor', series: 'WTA1000' },
};

/** 'ATP' o 'WTA' a partir de la clave del torneo. */
export function tourFromSportKey(key: string): 'ATP' | 'WTA' | null {
  if (key.startsWith('tennis_atp_')) return 'ATP';
  if (key.startsWith('tennis_wta_')) return 'WTA';
  return null;
}

/** Nombre legible del torneo a partir de la clave, si no viene el título. */
export function tournamentNameFromKey(key: string, title?: string): string {
  if (title) return title;
  return key.replace(/^tennis_(atp|wta)_/, '').replace(/_/g, ' ');
}

export interface QuotaInfo { remaining: number | null; used: number | null; lastCost: number | null }

function quotaFrom(res: Response): QuotaInfo {
  const num = (h: string) => {
    const v = res.headers.get(h);
    return v === null ? null : Number(v);
  };
  return {
    remaining: num('x-requests-remaining'),
    used: num('x-requests-used'),
    lastCost: num('x-requests-last'),
  };
}

/** Lista de deportes. No consume cuota. */
export async function fetchSports(apiKey: string): Promise<{ sports: OddsApiSport[]; quota: QuotaInfo }> {
  const res = await fetch(`${ODDS_API_BASE}/sports/?apiKey=${apiKey}`);
  if (!res.ok) throw new Error(`the-odds-api /sports: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  return { sports: (await res.json()) as OddsApiSport[], quota: quotaFrom(res) };
}

/** Cuotas de un torneo. Cuesta 1 crédito con regions=eu y markets=h2h. */
export async function fetchOdds(
  apiKey: string,
  sportKey: string,
  regions = 'eu',
): Promise<{ events: OddsApiEvent[]; quota: QuotaInfo }> {
  const url = `${ODDS_API_BASE}/sports/${sportKey}/odds/` +
    `?apiKey=${apiKey}&regions=${regions}&markets=h2h&oddsFormat=decimal&dateFormat=iso`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`the-odds-api ${sportKey}: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  return { events: (await res.json()) as OddsApiEvent[], quota: quotaFrom(res) };
}

// Los marcadores en vivo NO vienen de aquí: se sacan de ESPN (gratis, set por
// set y con más cobertura). The Odds API solo se usa para las CUOTAS reales que
// necesita el Paper Trading. Ver scripts/espn-ingest.ts.

export interface ConsensusOdds {
  /** Media entre casas para cada jugador, con el número de casas. */
  home: { mean: number; max: number; books: number };
  away: { mean: number; max: number; books: number };
}

/**
 * Agrega el mercado h2h de un evento: media y máximo por jugador.
 *
 * Se guardan los dos porque miden cosas distintas: la media aproxima el precio
 * "de mercado" y el máximo es el precio al que realmente se podría operar. En
 * el histórico existen las dos columnas equivalentes (Avg y Max), así que el
 * backtest y la operativa en vivo quedan comparables.
 */
export function consensusFromEvent(ev: OddsApiEvent): ConsensusOdds | null {
  const acc: Record<'home' | 'away', number[]> = { home: [], away: [] };
  for (const bm of ev.bookmakers ?? []) {
    for (const mk of bm.markets ?? []) {
      if (mk.key !== 'h2h') continue;
      for (const o of mk.outcomes ?? []) {
        const price = Number(o.price);
        if (!(price > 1)) continue;
        if (o.name === ev.home_team) acc.home.push(price);
        else if (o.name === ev.away_team) acc.away.push(price);
      }
    }
  }
  if (!acc.home.length || !acc.away.length) return null;
  const agg = (xs: number[]) => ({
    mean: xs.reduce((a, b) => a + b, 0) / xs.length,
    max: Math.max(...xs),
    books: xs.length,
  });
  return { home: agg(acc.home), away: agg(acc.away) };
}
