/**
 * Ingesta de torneos EN CURSO, calendario y marcadores en vivo desde ESPN.
 *
 *   npx tsx scripts/espn-ingest.ts
 *   npx tsx scripts/espn-ingest.ts --dry-run
 *
 * Resuelve dos cosas que The Odds API no daba:
 *   · los torneos que se juegan AHORA, incluidos los ATP/WTA 250,
 *   · marcadores en vivo set por set.
 *
 * Es gratis y sin cuota. Crea/actualiza partidos 'scheduled' para los próximos y
 * en vivo, y llena `live_scores` para los que se están jugando. Los partidos ya
 * terminados NO se importan como resultado: tennis-data sigue siendo la fuente
 * de verdad de los completados (para no contaminar el Elo con dos versiones del
 * mismo partido). La reconciliación por pareja de jugadores los une después.
 *
 * DEDUP: antes de crear un partido comprueba si ya existe uno 'scheduled' con la
 * misma pareja y fecha (p.ej. creado por odds-ingest en un torneo cubierto). Si
 * existe, se le adjunta el marcador en vivo en vez de duplicarlo.
 */
import { db } from '../src/lib/db';
import { loadEnv } from './lib/env';
import { runBatch } from './lib/batch';
import { fetchScoreboard, surfaceHint, type EspnMatch, type EspnTournament } from '../src/lib/espn';
import { buildIndex, resolvePlayer } from '../src/lib/players';
import { normalizeName } from '@tti/model';

loadEnv();

const hasFlag = (n: string) => process.argv.includes(`--${n}`);

// Palabras genéricas que no identifican un torneo (para el enlace difuso).
const GENERIC = new Set([
  'open', 'international', 'ladies', 'masters', 'atp', 'wta', 'championships',
  'cup', 'trophy', 'tennis', 'de', 'the', 'grand', 'prix', 'classic', 'tour',
]);
function distinctiveTokens(name: string): string[] {
  return normalizeName(name).split(' ').filter((t) => t.length >= 4 && !GENERIC.has(t));
}

async function main() {
  const client = db();
  const dryRun = hasFlag('dry-run');

  const tourIds = new Map<string, number>();
  for (const r of (await client.execute('select id, code from tours')).rows) {
    tourIds.set(String(r.code), Number(r.id));
  }

  // Índices de jugadores y alias por circuito.
  const indices: Record<string, ReturnType<typeof buildIndex>> = {};
  const aliasMaps: Record<string, Map<string, number>> = {};
  for (const tour of ['ATP', 'WTA']) {
    const rows = (await client.execute({
      sql: 'select p.id, p.slug from players p join tours t on t.id = p.tour_id where t.code = ?',
      args: [tour],
    })).rows.map((r) => ({ id: Number(r.id), slug: String(r.slug) }));
    indices[tour] = buildIndex(rows);
    const al = (await client.execute({
      sql: `select a.slug, a.player_id from player_aliases a
            join players p on p.id = a.player_id join tours t on t.id = p.tour_id where t.code = ?`,
      args: [tour],
    })).rows;
    aliasMaps[tour] = new Map(al.map((r) => [String(r.slug), Number(r.player_id)]));
  }

  const report = { tournaments: 0, scheduled: 0, post: 0, live: 0, linked: 0, created: 0, unresolved: 0 };
  const liveMatchIds: number[] = [];
  const liveStmts: { sql: string; args: unknown[] }[] = [];

  for (const tour of ['ATP', 'WTA'] as const) {
    const tourId = tourIds.get(tour)!;
    let torneos: EspnTournament[];
    try {
      torneos = await fetchScoreboard(tour.toLowerCase() as 'atp' | 'wta');
    } catch (e) {
      console.log(`  ! ESPN ${tour}: ${(e as Error).message}`);
      continue;
    }

    for (const t of torneos) {
      // Todos los partidos de individuales del torneo: los terminados también,
      // para que el cuadro salga COMPLETO (rondas ya jugadas incluidas).
      const relevantes = t.matches;
      if (!relevantes.length) continue;
      report.tournaments++;
      const surface = surfaceHint(t.name);

      // Enlace difuso con un torneo existente de la misma temporada, o creación.
      let tournamentId: number | null = null;
      const espnTokens = distinctiveTokens(t.name);
      if (espnTokens.length) {
        const existentes = (await client.execute({
          sql: 'select id, name from tournaments where tour_id = ? and season = ?',
          args: [tourId, t.season],
        })).rows;
        const matches = existentes.filter((e) => {
          const et = new Set(distinctiveTokens(String(e.name)));
          return espnTokens.some((tok) => et.has(tok));
        });
        if (matches.length === 1) { tournamentId = Number(matches[0].id); report.linked++; }
      }
      if (tournamentId === null) {
        await client.execute({
          sql: `insert or ignore into tournaments (tour_id, season, name, surface, court)
                values (?, ?, ?, ?, ?)`,
          args: [tourId, t.season, t.name, surface, null],
        });
        tournamentId = Number((await client.execute({
          sql: 'select id from tournaments where tour_id = ? and season = ? and name = ?',
          args: [tourId, t.season, t.name],
        })).rows[0].id);
        report.created++;
      }

      for (const m of relevantes) {
        const rh = resolvePlayer(m.homeName, indices[tour], aliasMaps[tour]);
        const ra = resolvePlayer(m.awayName, indices[tour], aliasMaps[tour]);
        if (!rh.ok || !ra.ok || rh.playerId === ra.playerId) { report.unresolved++; continue; }

        const p1 = Math.min(rh.playerId, ra.playerId);
        const p2 = Math.max(rh.playerId, ra.playerId);
        const p1IsHome = p1 === rh.playerId;
        const playedOn = m.date.slice(0, 10);

        // Estado y resultado según ESPN. Los terminados se guardan como
        // 'completed' pero SOLO para mostrar: el Elo se entrena únicamente con
        // tennis-data (ver scripts/train-elo.ts), así que no lo contaminan.
        const isPost = m.state === 'post';
        const status = isPost ? 'completed' : 'scheduled';
        let p1Won: number | null = null;
        let setsJson: string | null = null;
        let winnerId: number | null = null;
        let loserId: number | null = null;
        if (isPost && m.homeWon !== null) {
          p1Won = (m.homeWon === p1IsHome) ? 1 : 0;
          winnerId = p1Won === 1 ? p1 : p2;
          loserId = p1Won === 1 ? p2 : p1;
          const winScore = m.homeWon ? m.homeScore : m.awayScore;
          const loseScore = m.homeWon ? m.awayScore : m.homeScore;
          if (winScore && loseScore) {
            setsJson = JSON.stringify(winScore.map((w, i) => [w, loseScore[i] ?? 0]));
          }
        }

        // Dedup: ¿ya existe un partido con esta pareja y fecha (±3 días)?
        // Cubre tanto el scheduled de odds-ingest como el completed de
        // tennis-data (que es la fuente autorizada: si ya está, no se duplica).
        const existente = (await client.execute({
          sql: `select id, source, status from matches where tour_id = ?
                  and p1_id = ? and p2_id = ? and abs(julianday(played_on) - julianday(?)) <= 3
                order by case when source = 'tennis-data' then 0 else 1 end limit 1`,
          args: [tourId, p1, p2, playedOn],
        })).rows[0];

        let matchId: number;
        if (existente && String(existente.source) === 'tennis-data') {
          // tennis-data manda: no se toca ni se duplica.
          matchId = Number(existente.id);
        } else if (existente) {
          matchId = Number(existente.id);
          // Actualiza el partido ESPN/odds existente con el resultado si terminó.
          if (isPost) {
            await client.execute({
              sql: `update matches set status='completed', p1_won=?, sets_json=?,
                    winner_id=?, loser_id=?, round=coalesce(round,?) where id=?`,
              args: [p1Won, setsJson, winnerId, loserId, m.round, matchId],
            });
          }
        } else {
          await client.execute({
            sql: `insert into matches
                    (tour_id, tournament_id, season, played_on, round, best_of, surface, court,
                     p1_id, p2_id, p1_won, sets_json, winner_id, loser_id, status, source, source_key)
                  values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'espn',?)
                  on conflict (source_key) do update set
                    played_on = excluded.played_on, round = excluded.round,
                    surface = excluded.surface, tournament_id = excluded.tournament_id,
                    status = excluded.status, p1_won = excluded.p1_won, sets_json = excluded.sets_json,
                    winner_id = excluded.winner_id, loser_id = excluded.loser_id`,
            args: [
              tourId, tournamentId, t.season, playedOn, m.round, 3, surface, null,
              p1, p2, p1Won, setsJson, winnerId, loserId, status, `espn:${m.id}`,
            ],
          });
          matchId = Number((await client.execute({
            sql: `select id from matches where source_key = ?`, args: [`espn:${m.id}`],
          })).rows[0].id);
        }
        if (isPost) report.post = (report.post ?? 0) + 1; else report.scheduled++;

        // Marcador en vivo (solo para los que se están jugando ahora).
        if (m.state === 'in') {
          const fmt = (arr: number[] | null) => (arr && arr.length ? arr.join(' ') : null);
          const scoreP1 = p1IsHome ? fmt(m.homeScore) : fmt(m.awayScore);
          const scoreP2 = p1IsHome ? fmt(m.awayScore) : fmt(m.homeScore);
          liveStmts.push({
            sql: `insert into live_scores (match_id, event_id, state, score_p1, score_p2, updated_at)
                  values (?, ?, 'live', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                  on conflict (match_id) do update set
                    score_p1 = excluded.score_p1, score_p2 = excluded.score_p2,
                    state = 'live', updated_at = excluded.updated_at`,
            args: [matchId, `espn:${m.id}`, scoreP1, scoreP2],
          });
          liveMatchIds.push(matchId);
          report.live++;
        }
      }
    }
  }

  console.log(
    `Torneos en curso: ${report.tournaments} (enlazados ${report.linked}, nuevos ${report.created}).\n` +
    `Próximos ${report.scheduled} · terminados ${report.post} · en vivo ${report.live} · sin resolver ${report.unresolved}.`,
  );

  if (dryRun) { console.log('--dry-run: no se ha escrito nada.'); return; }

  await runBatch(client, liveStmts, 'marcadores en vivo');
  // Los que ya no están 'in' se retiran de live_scores.
  if (liveMatchIds.length) {
    await client.execute({
      sql: `delete from live_scores where match_id not in (${liveMatchIds.map(() => '?').join(',')})`,
      args: liveMatchIds,
    });
  } else {
    await client.execute('delete from live_scores');
  }
  console.log('ESPN: ingesta terminada.');
}

main().catch((e) => {
  console.error('Fallo en espn-ingest:', e);
  process.exit(1);
});
