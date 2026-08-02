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

// `point` solo viene en totals ('Over'/'Under' + la línea) y spreads (el
// nombre del jugador + su hándicap, con signo opuesto al del rival).
export interface OddsApiOutcome { name: string; price: number; point?: number }
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

/**
 * Cuotas de un torneo: ganador (h2h), total de juegos (totals) y hándicap de
 * juegos (spreads). VERIFICADO CONTRA LA API REAL (no solo documentación): los
 * tres existen para tenis — 32 eventos de prueba, hasta 17 casas cada uno.
 * `totals`/`spreads`/`outrights` cuestan 1 crédito cada uno por combinación de
 * region (ver la cabecera del fichero); pedir los tres juntos en una sola
 * llamada sale más barato que tres llamadas sueltas.
 *
 * NO hay mercado de sets ni de aces: se pidieron expresamente y la API los
 * rechazó como "Invalid markets". Por eso el Paper Trading solo cubre
 * Ganador y Juegos — Set y Aces se quedan en proyección informativa, sin
 * cuota real con la que compararlos.
 */
export async function fetchOdds(
  apiKey: string,
  sportKey: string,
  regions = 'eu',
): Promise<{ events: OddsApiEvent[]; quota: QuotaInfo }> {
  const url = `${ODDS_API_BASE}/sports/${sportKey}/odds/` +
    `?apiKey=${apiKey}&regions=${regions}&markets=h2h,totals,spreads&oddsFormat=decimal&dateFormat=iso`;
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

export interface ConsensusLine {
  line: number;
  a: { mean: number; max: number; books: number };
  b: { mean: number; max: number; books: number };
}

const agg = (xs: number[]) => ({
  mean: xs.reduce((s, x) => s + x, 0) / xs.length,
  max: Math.max(...xs),
  books: xs.length,
});

/**
 * Total de juegos (Over/Under) consensuado de un evento.
 *
 * Distintas casas publican líneas ligeramente distintas (21.5, 22, 22.5): se
 * agrupan por línea EXACTA y se toma la que más casas cubren, no la primera
 * que aparece — es la más representativa del consenso real, no un accidente
 * de qué libro llegó primero al array.
 */
export function totalsFromEvent(ev: OddsApiEvent): ConsensusLine | null {
  const byLine = new Map<number, { over: number[]; under: number[] }>();
  for (const bm of ev.bookmakers ?? []) {
    for (const mk of bm.markets ?? []) {
      if (mk.key !== 'totals') continue;
      for (const o of mk.outcomes ?? []) {
        const price = Number(o.price);
        const line = Number(o.point);
        if (!(price > 1) || !Number.isFinite(line)) continue;
        const bucket = byLine.get(line) ?? { over: [], under: [] };
        if (o.name === 'Over') bucket.over.push(price);
        else if (o.name === 'Under') bucket.under.push(price);
        byLine.set(line, bucket);
      }
    }
  }
  let best: { line: number; over: number[]; under: number[] } | null = null;
  for (const [line, b] of byLine) {
    if (!b.over.length || !b.under.length) continue;
    const votos = b.over.length + b.under.length;
    if (!best || votos > best.over.length + best.under.length) best = { line, ...b };
  }
  if (!best) return null;
  return { line: best.line, a: agg(best.over), b: agg(best.under) };
}

/**
 * Hándicap de juegos consensuado. `line` es el hándicap de `a` (home) CON
 * SIGNO: positivo significa que home es el desvalido (recibe juegos),
 * negativo que es el favorito (los da). El de `b` (away) es el mismo número
 * en negativo por construcción del mercado — no hace falta guardarlo aparte.
 *
 * Se agrupa por MAGNITUD (|point|) porque cada casa publica el mismo número
 * con signo opuesto para cada jugador, y hay que juntar las dos filas en una
 * sola línea de mercado; pero el signo de `line` se toma del lado de home
 * específicamente, para no perder quién es el favorito.
 */
export function spreadsFromEvent(ev: OddsApiEvent): ConsensusLine | null {
  const byMagnitud = new Map<number, { home: number[]; away: number[]; homeSign: number }>();
  for (const bm of ev.bookmakers ?? []) {
    for (const mk of bm.markets ?? []) {
      if (mk.key !== 'spreads') continue;
      for (const o of mk.outcomes ?? []) {
        const price = Number(o.price);
        const point = Number(o.point);
        if (!(price > 1) || !Number.isFinite(point) || point === 0) continue;
        const magnitud = Math.abs(point);
        const bucket = byMagnitud.get(magnitud) ?? { home: [], away: [], homeSign: 0 };
        if (o.name === ev.home_team) { bucket.home.push(price); bucket.homeSign = Math.sign(point); }
        else if (o.name === ev.away_team) bucket.away.push(price);
        byMagnitud.set(magnitud, bucket);
      }
    }
  }
  let best: { magnitud: number; home: number[]; away: number[]; homeSign: number } | null = null;
  for (const [magnitud, b] of byMagnitud) {
    // Sin haber visto el lado de home no se sabe el signo: esa línea se descarta.
    if (!b.home.length || !b.away.length || b.homeSign === 0) continue;
    const votos = b.home.length + b.away.length;
    if (!best || votos > best.home.length + best.away.length) best = { magnitud, ...b };
  }
  if (!best) return null;
  return { line: best.magnitud * best.homeSign, a: agg(best.home), b: agg(best.away) };
}
