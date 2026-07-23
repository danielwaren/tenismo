/**
 * Ingesta de partidos FUTUROS y sus cuotas reales desde The Odds API.
 *
 *   npx tsx scripts/odds-ingest.ts
 *   npx tsx scripts/odds-ingest.ts --dry-run     # no escribe, solo informa
 *
 * Esta API no es solo la fuente de cuotas: es la ÚNICA fuente de calendario
 * futuro del proyecto, porque tennis-data.co.uk solo publica lo ya jugado.
 *
 * REGLA NO NEGOCIABLE: sin ODDS_API_KEY esto es un no-op EXPLÍCITO. Nunca se
 * genera una cuota a partir de la probabilidad del modelo — eso convertiría la
 * validación en el modelo contra sí mismo.
 *
 * CUOTA DE LA API: listar deportes es gratis, así que primero se mira qué
 * torneos están activos y solo se piden cuotas de esos (1 crédito cada uno).
 * En semanas sin torneos cubiertos el coste es CERO.
 */
import { db } from '../src/lib/db';
import { loadEnv } from './lib/env';
import { runBatch } from './lib/batch';
import { fetchSports, fetchOdds, consensusFromEvent, tourFromSportKey, TOURNAMENT_INFO, tournamentNameFromKey } from './lib/odds-api';
import { buildIndex, resolvePlayer } from '../src/lib/players';

loadEnv();

const hasFlag = (n: string) => process.argv.includes(`--${n}`);

async function main() {
  const client = db();
  const dryRun = hasFlag('dry-run');
  const apiKey = process.env.ODDS_API_KEY;

  if (!apiKey) {
    console.log(
      'Sin ODDS_API_KEY: no se hace nada.\n' +
        'No se inventan cuotas a partir del modelo — sin fuente real, no hay cuotas.',
    );
    return;
  }

  // 1) Qué torneos están activos. Gratis.
  const { sports, quota } = await fetchSports(apiKey);
  const activos = sports.filter((s) => s.key.startsWith('tennis') && s.active);
  console.log(`Cuota API: ${quota.remaining ?? '?'} créditos restantes (usados ${quota.used ?? '?'}).`);
  console.log(`Torneos de tenis activos: ${activos.length}${activos.length ? ' — ' + activos.map((s) => s.key).join(', ') : ''}`);

  if (!activos.length) {
    console.log('Ningún torneo cubierto en curso: no se gasta ni un crédito.');
    console.log('La cobertura son Grand Slams, Masters 1000 y algunos 500; los 250 no entran.');
    return;
  }

  // 2) Índices de jugadores por circuito.
  const indices: Record<string, ReturnType<typeof buildIndex>> = {};
  const aliasMaps: Record<string, Map<string, number>> = {};
  const tourIds = new Map<string, number>();
  for (const r of (await client.execute('select id, code from tours')).rows) {
    tourIds.set(String(r.code), Number(r.id));
  }
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

  const matchStmts: { sql: string; args: unknown[] }[] = [];
  const unmatchedStmts: { sql: string; args: unknown[] }[] = [];
  const pendientes: { sourceKey: string; sel: 'home' | 'away'; odds: any }[] = [];
  let eventos = 0;
  let resueltos = 0;
  let sinCuota = 0;
  let gastados = 0;

  for (const sport of activos) {
    const tour = tourFromSportKey(sport.key);
    if (!tour) continue;
    const info = TOURNAMENT_INFO[sport.key];
    if (!info) {
      console.log(`  ! ${sport.key}: torneo desconocido, superficie sin determinar (el modelo usará solo el Elo global)`);
    }

    const { events, quota: q } = await fetchOdds(apiKey, sport.key);
    gastados += q.lastCost ?? 1;
    console.log(`  ${sport.key}: ${events.length} eventos (coste ${q.lastCost ?? '?'} crédito/s)`);

    for (const ev of events) {
      eventos++;
      const cons = consensusFromEvent(ev);
      if (!cons) { sinCuota++; continue; }

      const rHome = resolvePlayer(ev.home_team, indices[tour], aliasMaps[tour]);
      const rAway = resolvePlayer(ev.away_team, indices[tour], aliasMaps[tour]);
      if (!rHome.ok || !rAway.ok) {
        const motivo = [!rHome.ok ? `${ev.home_team}: ${rHome.reason}` : '', !rAway.ok ? `${ev.away_team}: ${rAway.reason}` : '']
          .filter(Boolean).join(' | ');
        console.log(`    ✗ sin resolver — ${motivo}`);
        unmatchedStmts.push({
          sql: `insert into unmatched_events (event_id, sport_key, home_team, away_team, commence_at, reason)
                values (?,?,?,?,?,?)
                on conflict (source, event_id) do update set reason = excluded.reason, seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
          args: [ev.id, sport.key, ev.home_team, ev.away_team, ev.commence_time, motivo],
        });
        continue;
      }
      if (rHome.playerId === rAway.playerId) {
        console.log(`    ✗ ${ev.home_team} vs ${ev.away_team}: ambos resuelven al mismo jugador`);
        continue;
      }

      // Mismo criterio que el histórico: p1 = id menor. Independiente del
      // resultado (que además aquí todavía no existe) y del lado de la API.
      const p1 = Math.min(rHome.playerId, rAway.playerId);
      const p2 = Math.max(rHome.playerId, rAway.playerId);
      const p1EsHome = p1 === rHome.playerId;
      const playedOn = ev.commence_time.slice(0, 10);
      const season = Number(playedOn.slice(0, 4));
      const sourceKey = `odds:${ev.id}`;
      const nombre = tournamentNameFromKey(sport.key, sport.title);

      matchStmts.push({
        sql: `insert or ignore into tournaments (tour_id, season, name, location, series, surface, court)
              values (?,?,?,?,?,?,?)`,
        args: [tourIds.get(tour)!, season, nombre, null, info?.series ?? null, info?.surface ?? null, info?.court ?? null],
      });
      matchStmts.push({
        sql: `insert into matches
                (tour_id, tournament_id, season, played_on, round, best_of, surface, court,
                 p1_id, p2_id, p1_won, status, source, source_key)
              values (?, (select id from tournaments where tour_id=? and season=? and name=?), ?,?,?,?,?,?,?,?,?, 'scheduled', 'the-odds-api', ?)
              on conflict (source_key) do update set
                played_on = excluded.played_on, surface = excluded.surface, court = excluded.court`,
        args: [
          tourIds.get(tour)!, tourIds.get(tour)!, season, nombre, season, playedOn,
          null, tour === 'ATP' && info?.series === 'Grand Slam' ? 5 : 3,
          info?.surface ?? null, info?.court ?? null, p1, p2, null, sourceKey,
        ],
      });

      const lado = (sel: 'p1' | 'p2') => ((sel === 'p1') === p1EsHome ? cons.home : cons.away);
      for (const sel of ['p1', 'p2'] as const) {
        pendientes.push({ sourceKey, sel, odds: lado(sel) });
      }
      resueltos++;
    }
  }

  console.log(`\nEventos: ${eventos} · resueltos ${resueltos} · sin cuota ${sinCuota} · sin resolver ${unmatchedStmts.length}`);
  console.log(`Créditos gastados en esta corrida: ${gastados}`);

  if (dryRun) {
    console.log('\n--dry-run: no se ha escrito nada en la base.');
    return;
  }

  await runBatch(client, matchStmts, 'partidos programados');
  await runBatch(client, unmatchedStmts, 'eventos sin resolver');

  // Las cuotas se escriben después, cuando ya existen los match_id.
  const idPorClave = new Map<string, number>(
    (await client.execute("select id, source_key from matches where source = 'the-odds-api'")).rows
      .map((r) => [String(r.source_key), Number(r.id)]),
  );
  const capturedAt = new Date().toISOString();
  const oddsStmts: { sql: string; args: unknown[] }[] = [];
  for (const p of pendientes) {
    const matchId = idPorClave.get(p.sourceKey);
    if (!matchId) continue;
    // Se guardan media y máximo: la media aproxima el precio de mercado y el
    // máximo es el precio al que de verdad se podría operar.
    for (const [bookmaker, valor] of [
      [`consensus(${p.odds.books})`, p.odds.mean],
      ['market_max', p.odds.max],
    ] as const) {
      if (!(valor > 1)) continue;
      oddsStmts.push({
        sql: `insert or ignore into odds
              (match_id, source, bookmaker, market, selection, odds, implied_prob, is_closing, captured_at)
              values (?, 'the-odds-api', ?, 'match_winner', ?, ?, ?, 0, ?)`,
        args: [matchId, bookmaker, p.sel, Math.round(valor * 100) / 100,
          Math.round((1 / valor) * 10000) / 10000, capturedAt],
      });
    }
  }
  await runBatch(client, oddsStmts, 'cuotas');
  console.log(`Escritos ${resueltos} partidos programados y ${oddsStmts.length} filas de cuota.`);
}

main().catch((e) => {
  console.error('Fallo en la ingesta de cuotas:', e);
  process.exit(1);
});
