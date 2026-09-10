/**
 * Adaptador de odds-api.io (https://odds-api.io) — reemplazo de The Odds API
 * como fuente de CUOTAS PRE-PARTIDO (sept 2026). Motivo: The Odds API son
 * 500 créditos/MES en el plan gratis y el US Open los agotó; odds-api.io da
 * 100/hora y 500/DÍA gratis, y además cubre Challenger e ITF (The Odds API
 * no). Ver docs/15-monetizacion.md.
 *
 * Devuelve los MISMOS tipos que `odds-api.ts` (`ConsensusOdds`,
 * `ConsensusLine`) para que `odds-ingest-io.ts` escriba en `odds`/`matches`
 * exactamente igual que el camino viejo. Regla no negociable heredada: la
 * cuota SIEMPRE viene de una casa real, nunca del modelo.
 *
 * Estructura de la API (v3, docs.odds-api.io):
 *   GET /events?sport=tennis&status=pending&apiKey=   -> próximos 14 días
 *   GET /odds/multi?eventIds=1,2,..&bookmakers=..&apiKey=  -> hasta 10 eventos
 * Cabeceras de cuota: x-ratelimit-remaining / -limit / -reset.
 * Mercados de tenis: "ML" (ganador), "Totals Games" (over/under de juegos),
 * "Spread Games" (hándicap de juegos, `hdp` = hándicap de home con signo).
 */

import type { ConsensusOdds, ConsensusLine } from './odds-api';

export const ODDS_API_IO_BASE = 'https://api.odds-api.io/v3';

export interface IoEvent {
  id: number;
  home: string;
  homeId: number;
  away: string;
  awayId: number;
  date: string;
  status: string; // pending | live | settled
  sport?: { name: string; slug: string };
  league?: { name: string; slug: string };
  bookmakerCount?: number;
}

/** Una fila de precios dentro de un mercado. Campos según el mercado. */
interface IoOddRow {
  home?: string | number;
  away?: string | number;
  over?: string | number;
  under?: string | number;
  hdp?: number;
}
interface IoMarket {
  name: string;
  odds?: IoOddRow[];
  updatedAt?: string;
}
export interface IoOddsEvent {
  id: number;
  home: string;
  away: string;
  date: string;
  status: string;
  sport?: { name: string; slug: string };
  league?: { name: string; slug: string };
  /** { "<Casa>": [ {name, odds:[...]}, ... ] } */
  bookmakers?: Record<string, IoMarket[]>;
}

export interface IoQuota {
  remaining: number | null;
  limit: number | null;
  /** epoch seconds del reinicio de la ventana horaria. */
  reset: number | null;
}

function quotaFrom(res: Response): IoQuota {
  const n = (h: string) => {
    const v = res.headers.get(h);
    return v === null || v === '' ? null : Number(v);
  };
  return {
    remaining: n('x-ratelimit-remaining'),
    limit: n('x-ratelimit-limit'),
    reset: n('x-ratelimit-reset'),
  };
}

const num = (v: unknown): number => Number(v);

/** ¿La respuesta indica cuota agotada? (429, o remaining=0 en la cabecera). */
export function isQuotaError(e: unknown): boolean {
  return /HTTP 429|rate ?limit|quota|too many requests/i.test(String((e as Error)?.message ?? e));
}

/**
 * Próximos partidos de tenis (status=pending, ~14 días por defecto). Una sola
 * llamada trae TODOS los circuitos (ATP, WTA, Challenger, ITF).
 */
export async function fetchTennisEvents(apiKey: string): Promise<{ events: IoEvent[]; quota: IoQuota }> {
  const url = `${ODDS_API_IO_BASE}/events?sport=tennis&status=pending&apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`odds-api.io /events: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  const body = await res.json();
  // La API puede devolver el array directo o envuelto en {data:[...]}.
  const events = (Array.isArray(body) ? body : (body?.data ?? body?.events ?? [])) as IoEvent[];
  return { events, quota: quotaFrom(res) };
}

/**
 * Cuotas de hasta 10 eventos por llamada. `bookmakers` es opcional: sin él la
 * API devuelve las casas que tenga el plan (2 en el gratis). Se puede fijar
 * con ODDS_API_IO_BOOKMAKERS si hiciera falta.
 */
export async function fetchOddsMulti(
  apiKey: string,
  eventIds: number[],
  bookmakers?: string,
): Promise<{ events: IoOddsEvent[]; quota: IoQuota }> {
  const params = new URLSearchParams({ eventIds: eventIds.join(','), apiKey });
  if (bookmakers) params.set('bookmakers', bookmakers);
  const res = await fetch(`${ODDS_API_IO_BASE}/odds/multi?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`odds-api.io /odds/multi: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  const body = await res.json();
  const events = (Array.isArray(body) ? body : (body?.data ?? body?.events ?? [])) as IoOddsEvent[];
  return { events, quota: quotaFrom(res) };
}

// ── Parsers: bookmakers{} de odds-api.io → tipos ConsensusOdds/ConsensusLine ──

const agg = (xs: number[]) => ({
  mean: xs.reduce((s, x) => s + x, 0) / xs.length,
  max: Math.max(...xs),
  books: xs.length,
});

/** Itera (casa, mercado) de un evento; `wanted` acepta variantes de nombre. */
function* marketsOf(ev: IoOddsEvent, wanted: string[]): Generator<IoMarket> {
  const want = new Set(wanted.map((w) => w.toLowerCase()));
  for (const markets of Object.values(ev.bookmakers ?? {})) {
    for (const mk of markets ?? []) {
      if (want.has(String(mk.name).toLowerCase())) yield mk;
    }
  }
}

/** Ganador (ML). Devuelve precios por lado HOME/AWAY del evento. */
export function mlFromOdds(ev: IoOddsEvent): ConsensusOdds | null {
  const home: number[] = [];
  const away: number[] = [];
  for (const mk of marketsOf(ev, ['ML', 'Moneyline', 'Match Winner', '1x2'])) {
    for (const row of mk.odds ?? []) {
      const h = num(row.home);
      const a = num(row.away);
      if (h > 1) home.push(h);
      if (a > 1) away.push(a);
    }
  }
  if (!home.length || !away.length) return null;
  return { home: agg(home), away: agg(away) };
}

/** Total de juegos (Over/Under). Se queda con la línea `hdp` más cubierta. */
export function totalsFromOdds(ev: IoOddsEvent): ConsensusLine | null {
  const byLine = new Map<number, { over: number[]; under: number[] }>();
  for (const mk of marketsOf(ev, ['Totals Games', 'Totals', 'Total Games', 'Over/Under'])) {
    for (const row of mk.odds ?? []) {
      const line = Number(row.hdp);
      const over = num(row.over);
      const under = num(row.under);
      if (!Number.isFinite(line)) continue;
      const b = byLine.get(line) ?? { over: [], under: [] };
      if (over > 1) b.over.push(over);
      if (under > 1) b.under.push(under);
      byLine.set(line, b);
    }
  }
  let best: { line: number; over: number[]; under: number[] } | null = null;
  for (const [line, b] of byLine) {
    if (!b.over.length || !b.under.length) continue;
    if (!best || b.over.length + b.under.length > best.over.length + best.under.length) best = { line, ...b };
  }
  if (!best) return null;
  return { line: best.line, a: agg(best.over), b: agg(best.under) };
}

/**
 * Hándicap de juegos. `hdp` de odds-api.io ya viene CON SIGNO y pegado a la
 * fila que trae los dos precios (home/away), así que `line` = `hdp` directo
 * (hándicap de home: negativo = favorito que da juegos). Más simple que el
 * camino de The Odds API, que tenía que reconstruir el signo por outcome.
 */
export function spreadsFromOdds(ev: IoOddsEvent): ConsensusLine | null {
  const byHdp = new Map<number, { home: number[]; away: number[] }>();
  for (const mk of marketsOf(ev, ['Spread Games', 'Spread', 'Handicap Games', 'Game Handicap'])) {
    for (const row of mk.odds ?? []) {
      const hdp = Number(row.hdp);
      const h = num(row.home);
      const a = num(row.away);
      if (!Number.isFinite(hdp) || hdp === 0) continue;
      const b = byHdp.get(hdp) ?? { home: [], away: [] };
      if (h > 1) b.home.push(h);
      if (a > 1) b.away.push(a);
      byHdp.set(hdp, b);
    }
  }
  let best: { line: number; home: number[]; away: number[] } | null = null;
  for (const [hdp, b] of byHdp) {
    if (!b.home.length || !b.away.length) continue;
    if (!best || b.home.length + b.away.length > best.home.length + best.away.length) best = { line: hdp, ...b };
  }
  if (!best) return null;
  return { line: best.line, a: agg(best.home), b: agg(best.away) };
}

// ── Metadatos de torneo a partir del nombre de la liga ───────────────────────

/** ATP salvo que el nombre de la liga diga WTA/Women/Ladies. */
export function tourFromLeague(leagueName: string | undefined): 'ATP' | 'WTA' {
  return /\bwta\b|women|ladies|girls/i.test(leagueName ?? '') ? 'WTA' : 'ATP';
}

/** true si la liga es ITF/Futures — se ignoran (jugadores rara vez en la base, ruido). */
export function isLowTierLeague(leagueName: string | undefined): boolean {
  return /\bitf\b|futures|\butr\b|exhibition|exho/i.test(leagueName ?? '');
}

const SLAM_SURFACE: [RegExp, string, number][] = [
  [/wimbledon/i, 'grass', 5],
  [/roland[ -]?garros|french open/i, 'clay', 5],
  [/us open|u\.s\. open/i, 'hard', 5],
  [/australian open/i, 'hard', 5],
];

/**
 * Superficie y best_of por nombre de liga. Solo cubre los Slams (nombres
 * estables y donde la superficie más importa); el resto sale null y lo
 * completa `reconcile.ts` al fusionar el torneo con su gemelo de
 * tennis-data/ESPN ("superficie heredada del torneo").
 */
export function surfaceAndBestOf(leagueName: string | undefined, tour: 'ATP' | 'WTA'): { surface: string | null; bestOf: number } {
  for (const [re, surface, bo] of SLAM_SURFACE) {
    if (re.test(leagueName ?? '')) return { surface, bestOf: tour === 'ATP' ? bo : 3 };
  }
  return { surface: null, bestOf: 3 };
}

/** Nombre de torneo limpio a partir de league.name (quita el prefijo "ATP - " / "WTA - "). */
export function tournamentName(leagueName: string | undefined): string {
  const raw = (leagueName ?? '').trim();
  if (!raw) return '(torneo sin nombre)';
  return raw.replace(/^\s*(ATP|WTA)\s*[-–:]\s*/i, '').trim() || raw;
}
