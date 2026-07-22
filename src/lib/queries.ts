import { db } from './db';

/**
 * Consultas de lectura. SOLO SERVIDOR: se ejecutan en páginas Astro y API
 * routes, y el resultado viaja a las islas de React como props ya resueltos.
 * (Ver la nota de src/lib/db.ts: sin RLS, el navegador no toca la base.)
 */

export interface RankingRow {
  playerId: number;
  name: string;
  tour: string;
  elo: number;
  matches: number;
}

export interface DbStats {
  players: number;
  tournaments: number;
  matches: number;
  completed: number;
  withOdds: number;
  predictions: number;
  firstSeason: number | null;
  lastSeason: number | null;
  lastMatch: string | null;
}

export async function getStats(): Promise<DbStats> {
  const c = db();
  const one = async (sql: string) => Number((await c.execute(sql)).rows[0]?.n ?? 0);
  const range = (
    await c.execute('select min(season) a, max(season) b, max(played_on) c from matches')
  ).rows[0];
  return {
    players: await one('select count(*) n from players'),
    tournaments: await one('select count(*) n from tournaments'),
    matches: await one('select count(*) n from matches'),
    completed: await one("select count(*) n from matches where status = 'completed'"),
    withOdds: await one('select count(distinct match_id) n from odds'),
    predictions: await one('select count(*) n from model_outputs'),
    firstSeason: range?.a === null ? null : Number(range?.a),
    lastSeason: range?.b === null ? null : Number(range?.b),
    lastMatch: (range?.c as string | null) ?? null,
  };
}

/**
 * Ranking Elo. `surface` = 'all' para el rating global.
 *
 * ATP y WTA son POOLS SEPARADOS: nunca juegan entre sí, así que sus Elo no son
 * comparables entre circuitos y la consulta siempre filtra por uno.
 */
export async function getRanking(
  tour: 'ATP' | 'WTA',
  surface: 'all' | 'hard' | 'clay' | 'grass' | 'carpet' = 'all',
  limit = 30,
  minMatches = 20,
): Promise<RankingRow[]> {
  const c = db();
  const res = await c.execute({
    sql: `select p.id, p.name, t.code as tour, r.elo, r.matches
          from player_ratings r
          join players p on p.id = r.player_id
          join tours   t on t.id = p.tour_id
          where t.code = ? and r.surface = ? and r.matches >= ?
          order by r.elo desc
          limit ?`,
    args: [tour, surface, minMatches, limit],
  });
  return res.rows.map((r) => ({
    playerId: Number(r.id),
    name: String(r.name),
    tour: String(r.tour),
    elo: Number(r.elo),
    matches: Number(r.matches),
  }));
}
