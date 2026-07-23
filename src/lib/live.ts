import { db } from './db';
import { fetchScoreboard } from './espn';
import { buildIndex, resolvePlayer } from './players';
import type { LiveMatchRow } from './queries';

/**
 * Marcadores EN VIVO consultados a ESPN **en el momento de la petición**.
 *
 * Antes esto se leía de `live_scores`, que solo se refrescaba cuando corría el
 * cron (cada 15 min). Resultado: la web mostraba una foto vieja — partidos ya
 * terminados seguían marcados "EN VIVO" y los que acababan de empezar no
 * aparecían. Como ESPN es gratis y sin cuota, la fuente se consulta aquí mismo.
 *
 * Se mantiene una caché en memoria muy corta para que varias peticiones
 * seguidas (SSR + polling de varias pestañas) no disparen una llamada cada una.
 */

const TTL_MS = 12_000;
let cache: { at: number; rows: LiveMatchRow[] } | null = null;
let inFlight: Promise<LiveMatchRow[]> | null = null;

/** Marcador "6 4 3" a partir del array de juegos por set. */
function fmtScore(sets: number[] | null): string | null {
  return sets && sets.length ? sets.join(' ') : null;
}

async function loadLive(): Promise<LiveMatchRow[]> {
  const c = db();

  const [atp, wta] = await Promise.all([
    fetchScoreboard('atp').catch(() => []),
    fetchScoreboard('wta').catch(() => []),
  ]);

  const enVivo: { tour: 'ATP' | 'WTA'; espnId: string; home: string; away: string; homeScore: number[] | null; awayScore: number[] | null }[] = [];
  for (const [tour, torneos] of [['ATP', atp], ['WTA', wta]] as const) {
    for (const t of torneos) {
      for (const m of t.matches) {
        if (m.state !== 'in') continue;
        enVivo.push({
          tour, espnId: m.id, home: m.homeName, away: m.awayName,
          homeScore: m.homeScore, awayScore: m.awayScore,
        });
      }
    }
  }

  if (!enVivo.length) {
    // Sin partidos en vivo: se limpia la tabla para que los contadores de los
    // torneos no sigan mostrando un "en vivo" fantasma.
    await c.execute('delete from live_scores');
    return [];
  }

  const version = String(
    (await c.execute("select v from app_config where k = 'model_version'")).rows[0]?.v ?? '',
  );

  // Índices para resolver por nombre los partidos que no casen por source_key.
  const indices: Record<string, ReturnType<typeof buildIndex>> = {};
  const aliases: Record<string, Map<string, number>> = {};
  for (const tour of ['ATP', 'WTA']) {
    const rows = (await c.execute({
      sql: 'select p.id, p.slug from players p join tours t on t.id = p.tour_id where t.code = ?',
      args: [tour],
    })).rows.map((r) => ({ id: Number(r.id), slug: String(r.slug) }));
    indices[tour] = buildIndex(rows);
    const al = (await c.execute({
      sql: `select a.slug, a.player_id from player_aliases a
            join players p on p.id = a.player_id join tours t on t.id = p.tour_id where t.code = ?`,
      args: [tour],
    })).rows;
    aliases[tour] = new Map(al.map((r) => [String(r.slug), Number(r.player_id)]));
  }

  const rows: LiveMatchRow[] = [];
  const vivos: number[] = [];

  for (const ev of enVivo) {
    // 1) Por source_key, que es como lo guarda espn-ingest.
    let row = (await c.execute({
      sql: `select m.id, t.code tour, tr.name tournament, tr.id tournament_id, m.surface, m.round,
                   m.played_on, m.status, m.p1_id, m.p1_won,
                   p1.name p1_name, p2.name p2_name, mo.prob_p1, mo.confidence
            from matches m
            join tours t on t.id = m.tour_id
            join tournaments tr on tr.id = m.tournament_id
            join players p1 on p1.id = m.p1_id
            join players p2 on p2.id = m.p2_id
            left join model_outputs mo on mo.match_id = m.id and mo.model_version = ?
            where m.source_key = ?`,
      args: [version, `espn:${ev.espnId}`],
    })).rows[0];

    // 2) Si no está (p.ej. el partido lo creó odds-ingest y espn-ingest se le
    //    adjuntó), se resuelve por pareja de jugadores.
    if (!row) {
      const rh = resolvePlayer(ev.home, indices[ev.tour], aliases[ev.tour]);
      const ra = resolvePlayer(ev.away, indices[ev.tour], aliases[ev.tour]);
      if (!rh.ok || !ra.ok || rh.playerId === ra.playerId) continue;
      const p1 = Math.min(rh.playerId, ra.playerId);
      const p2 = Math.max(rh.playerId, ra.playerId);
      row = (await c.execute({
        sql: `select m.id, t.code tour, tr.name tournament, tr.id tournament_id, m.surface, m.round,
                     m.played_on, m.status, m.p1_id, m.p1_won,
                     p1.name p1_name, p2.name p2_name, mo.prob_p1, mo.confidence
              from matches m
              join tours t on t.id = m.tour_id
              join tournaments tr on tr.id = m.tournament_id
              join players p1 on p1.id = m.p1_id
              join players p2 on p2.id = m.p2_id
              left join model_outputs mo on mo.match_id = m.id and mo.model_version = ?
              where m.p1_id = ? and m.p2_id = ?
                and abs(julianday(m.played_on) - julianday('now')) <= 3
              order by case when m.status = 'scheduled' then 0 else 1 end limit 1`,
        args: [version, p1, p2],
      })).rows[0];
      if (!row) continue;
    }

    // Orientar el marcador de ESPN (home/away) al orden p1/p2 de la base.
    const rh2 = resolvePlayer(ev.home, indices[ev.tour], aliases[ev.tour]);
    const p1IsHome = rh2.ok && rh2.playerId === Number(row.p1_id);
    const scoreP1 = fmtScore(p1IsHome ? ev.homeScore : ev.awayScore);
    const scoreP2 = fmtScore(p1IsHome ? ev.awayScore : ev.homeScore);
    const matchId = Number(row.id);

    rows.push({
      id: matchId,
      tour: String(row.tour),
      tournament: String(row.tournament),
      tournamentId: Number(row.tournament_id),
      surface: (row.surface as string | null) ?? null,
      round: (row.round as string | null) ?? null,
      playedOn: String(row.played_on),
      status: String(row.status),
      p1Name: String(row.p1_name),
      p2Name: String(row.p2_name),
      p1Won: row.p1_won === null ? null : Number(row.p1_won),
      probP1: row.prob_p1 === null ? null : Number(row.prob_p1),
      confidence: row.confidence === null ? null : Number(row.confidence),
      scoreP1, scoreP2,
      liveState: 'live',
    });
    vivos.push(matchId);

    // Se persiste para que los contadores "en vivo" de los torneos cuadren.
    await c.execute({
      sql: `insert into live_scores (match_id, event_id, state, score_p1, score_p2, updated_at)
            values (?, ?, 'live', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            on conflict (match_id) do update set
              score_p1 = excluded.score_p1, score_p2 = excluded.score_p2,
              state = 'live', updated_at = excluded.updated_at`,
      args: [matchId, `espn:${ev.espnId}`, scoreP1, scoreP2],
    });
  }

  // Retira los que ya no están en vivo (terminaron desde la última consulta).
  if (vivos.length) {
    await c.execute({
      sql: `delete from live_scores where match_id not in (${vivos.map(() => '?').join(',')})`,
      args: vivos,
    });
  } else {
    await c.execute('delete from live_scores');
  }

  return rows;
}

/** Partidos en vivo ahora mismo. Cachea TTL_MS y colapsa peticiones paralelas. */
export async function getLiveNow(): Promise<LiveMatchRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  if (inFlight) return inFlight;
  inFlight = loadLive()
    .then((rows) => {
      cache = { at: Date.now(), rows };
      return rows;
    })
    .catch((e) => {
      console.warn('[live] ESPN no respondió:', (e as Error).message);
      return cache?.rows ?? [];
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}
