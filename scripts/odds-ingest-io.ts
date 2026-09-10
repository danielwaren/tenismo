/**
 * Ingesta de partidos FUTUROS y sus cuotas pre-partido desde odds-api.io.
 *
 *   npx tsx scripts/odds-ingest-io.ts
 *   npx tsx scripts/odds-ingest-io.ts --dry-run   # no escribe, solo informa
 *   npx tsx scripts/odds-ingest-io.ts --limit 30  # tope de eventos (pruebas)
 *
 * Reemplaza a scripts/odds-ingest.ts (The Odds API) — ver
 * docs/15-monetizacion.md y scripts/lib/odds-api-io.ts para el porqué. Escribe
 * en las MISMAS tablas (`matches` status='scheduled' source='odds-api-io',
 * `odds` is_closing=0) que el camino viejo, así que todo lo de después
 * (reconcile, train-elo, paper-trade, la ficha del partido) funciona igual.
 *
 * REGLA NO NEGOCIABLE: sin ODDS_API_IO_KEY esto es un no-op explícito. Jamás
 * se genera una cuota a partir del modelo.
 *
 * CUOTA: /events es 1 request; /odds/multi cubre 10 eventos por request. Con
 * ~40 partidos activos son ~5 requests/corrida. El plan gratis da 100/hora y
 * 500/día, así que sobra. Si se agota, se trata como no-op (igual que
 * odds-ingest.ts ante la cuota de The Odds API).
 */
import { db } from '../src/lib/db';
import { loadEnv } from './lib/env';
import { runBatch } from './lib/batch';
import {
  fetchTennisEvents, fetchOddsMulti, isQuotaError,
  mlFromOdds, totalsFromOdds, spreadsFromOdds,
  tourFromLeague, isLowTierLeague, surfaceAndBestOf, tournamentName,
  type IoEvent, type IoOddsEvent,
} from './lib/odds-api-io';
import { buildIndex, resolvePlayer } from '../src/lib/players';

loadEnv();

const SOURCE = 'odds-api-io';
const hasFlag = (n: string) => process.argv.includes(`--${n}`);
const flagVal = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};

async function main() {
  const client = db();
  const dryRun = hasFlag('dry-run');
  const limit = flagVal('limit') ? Number(flagVal('limit')) : Infinity;
  const apiKey = process.env.ODDS_API_IO_KEY;
  const bookmakers = process.env.ODDS_API_IO_BOOKMAKERS || undefined;

  if (!apiKey) {
    console.log('Sin ODDS_API_IO_KEY: no se hace nada. No se inventan cuotas a partir del modelo.');
    return;
  }

  // 1) Calendario: todos los partidos de tenis próximos, un solo request.
  let events: IoEvent[];
  let quota;
  try {
    ({ events, quota } = await fetchTennisEvents(apiKey));
  } catch (e) {
    if (isQuotaError(e)) {
      console.warn(`Cuota de odds-api.io agotada al pedir el calendario. No-op. (${(e as Error).message})`);
      return;
    }
    throw e;
  }
  console.log(`Cuota odds-api.io: ${quota.remaining ?? '?'}/${quota.limit ?? '?'} restantes esta hora.`);
  console.log(`Eventos de tenis próximos: ${events.length}`);

  if (quota.remaining !== null && quota.remaining <= 0) {
    console.warn('0 requests restantes: no se piden cuotas. El simulador sigue con lo último que tenga.');
    return;
  }

  // 2) Índices de jugadores (ATP/WTA) y alias.
  const tourIds = new Map<string, number>();
  for (const r of (await client.execute('select id, code from tours')).rows) {
    tourIds.set(String(r.code), Number(r.id));
  }
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

  // 3) Resolver jugadores y filtrar. Se descartan ITF/Futures y los que no
  //    resuelven (van a unmatched_events para revisar).
  interface Resuelto {
    ev: IoEvent;
    tour: 'ATP' | 'WTA';
    p1: number; p2: number; p1EsHome: boolean;
    tournament: string; surface: string | null; bestOf: number;
  }
  const resueltos: Resuelto[] = [];
  const unmatchedStmts: { sql: string; args: unknown[] }[] = [];
  let itf = 0, sinResolver = 0, mismos = 0;

  for (const ev of events) {
    if (ev.status !== 'pending') continue;
    const leagueName = ev.league?.name;
    if (isLowTierLeague(leagueName)) { itf++; continue; }

    const tour = tourFromLeague(leagueName);
    const rHome = resolvePlayer(ev.home, indices[tour], aliasMaps[tour]);
    const rAway = resolvePlayer(ev.away, indices[tour], aliasMaps[tour]);
    if (!rHome.ok || !rAway.ok) {
      sinResolver++;
      const motivo = [!rHome.ok ? `${ev.home}: ${rHome.reason}` : '', !rAway.ok ? `${ev.away}: ${rAway.reason}` : '']
        .filter(Boolean).join(' | ');
      unmatchedStmts.push({
        sql: `insert into unmatched_events (source, event_id, sport_key, home_team, away_team, commence_at, reason)
              values (?,?,?,?,?,?,?)
              on conflict (source, event_id) do update set reason = excluded.reason, seen_at = iso_now()`,
        args: [SOURCE, String(ev.id), leagueName ?? 'tennis', ev.home, ev.away, ev.date, motivo],
      });
      continue;
    }
    if (rHome.playerId === rAway.playerId) { mismos++; continue; }

    const { surface, bestOf } = surfaceAndBestOf(leagueName, tour);
    resueltos.push({
      ev, tour,
      p1: Math.min(rHome.playerId, rAway.playerId),
      p2: Math.max(rHome.playerId, rAway.playerId),
      p1EsHome: Math.min(rHome.playerId, rAway.playerId) === rHome.playerId,
      tournament: tournamentName(leagueName), surface, bestOf,
    });
    if (resueltos.length >= limit) break;
  }
  console.log(`Resueltos ${resueltos.length} · ITF/otros descartados ${itf} · sin resolver ${sinResolver} · mismo jugador ${mismos}`);

  if (!resueltos.length) {
    if (!dryRun && unmatchedStmts.length) await runBatch(client, unmatchedStmts, 'eventos sin resolver');
    console.log('Nada que ingerir.');
    return;
  }

  // 4) Cuotas: /odds/multi en lotes de 10.
  const oddsByEvent = new Map<number, IoOddsEvent>();
  const ids = resueltos.map((r) => r.ev.id);
  for (let i = 0; i < ids.length; i += 10) {
    const lote = ids.slice(i, i + 10);
    try {
      const { events: got, quota: q } = await fetchOddsMulti(apiKey, lote, bookmakers);
      for (const e of got) oddsByEvent.set(Number(e.id), e);
      if (q.remaining !== null) console.log(`  odds ${Math.min(i + 10, ids.length)}/${ids.length} — quedan ${q.remaining} requests`);
    } catch (e) {
      if (isQuotaError(e)) { console.warn(`  Cuota agotada a mitad — se guarda lo obtenido (${oddsByEvent.size} eventos con cuota).`); break; }
      throw e;
    }
  }

  // 5) Armar las filas.
  const matchStmts: { sql: string; args: unknown[] }[] = [];
  const pendientes: { sourceKey: string; sel: 'p1' | 'p2'; mean: number; max: number; books: number }[] = [];
  const pendientesTotal: { sourceKey: string; lado: 'over' | 'under'; mean: number; max: number; books: number; line: number }[] = [];
  const pendientesHcp: { sourceKey: string; sel: 'p1' | 'p2'; mean: number; max: number; books: number; line: number }[] = [];
  let conCuota = 0, sinCuota = 0, sinTotales = 0, sinHcp = 0;

  for (const r of resueltos) {
    const od = oddsByEvent.get(r.ev.id);
    const ml = od ? mlFromOdds(od) : null;
    if (!ml) { sinCuota++; continue; }
    conCuota++;

    const playedOn = r.ev.date.slice(0, 10);
    const season = Number(playedOn.slice(0, 4));
    const sourceKey = `${SOURCE}:${r.ev.id}`;
    const tourId = tourIds.get(r.tour)!;

    matchStmts.push({
      sql: `insert into tournaments (tour_id, season, name, location, series, surface, court)
            values (?,?,?,?,?,?,?) on conflict do nothing`,
      args: [tourId, season, r.tournament, null, null, r.surface, null],
    });
    matchStmts.push({
      sql: `insert into matches
              (tour_id, tournament_id, season, played_on, round, best_of, surface, court,
               p1_id, p2_id, p1_won, status, source, source_key)
            values (?, (select id from tournaments where tour_id=? and season=? and name=?), ?,?,?,?,?,?,?,?,?, 'scheduled', '${SOURCE}', ?)
            on conflict (source_key) do update set
              played_on = excluded.played_on, surface = excluded.surface`,
      args: [tourId, tourId, season, r.tournament, season, playedOn, null, r.bestOf, r.surface, null, r.p1, r.p2, null, sourceKey],
    });

    const ladoML = (sel: 'p1' | 'p2') => ((sel === 'p1') === r.p1EsHome ? ml.home : ml.away);
    for (const sel of ['p1', 'p2'] as const) {
      const s = ladoML(sel);
      pendientes.push({ sourceKey, sel, mean: s.mean, max: s.max, books: s.books });
    }

    const tot = od ? totalsFromOdds(od) : null;
    if (tot) {
      pendientesTotal.push({ sourceKey, lado: 'over', mean: tot.a.mean, max: tot.a.max, books: tot.a.books, line: tot.line });
      pendientesTotal.push({ sourceKey, lado: 'under', mean: tot.b.mean, max: tot.b.max, books: tot.b.books, line: tot.line });
    } else { sinTotales++; }

    const hcp = od ? spreadsFromOdds(od) : null;
    if (hcp) {
      // hcp.line viene orientado a HOME; se reorienta a p1 (id menor).
      const lineaP1 = r.p1EsHome ? hcp.line : -hcp.line;
      const aP1 = r.p1EsHome ? hcp.a : hcp.b;
      const aP2 = r.p1EsHome ? hcp.b : hcp.a;
      pendientesHcp.push({ sourceKey, sel: 'p1', mean: aP1.mean, max: aP1.max, books: aP1.books, line: lineaP1 });
      pendientesHcp.push({ sourceKey, sel: 'p2', mean: aP2.mean, max: aP2.max, books: aP2.books, line: -lineaP1 });
    } else { sinHcp++; }
  }

  console.log(`Con cuota ${conCuota} · sin cuota ${sinCuota} · sin totales ${sinTotales} · sin hándicap ${sinHcp}`);

  if (dryRun) {
    console.log('\n--dry-run: no se escribió nada.');
    for (const p of pendientes.slice(0, 12)) console.log('  ', JSON.stringify(p));
    return;
  }

  await runBatch(client, matchStmts, 'partidos programados');
  if (unmatchedStmts.length) await runBatch(client, unmatchedStmts, 'eventos sin resolver');

  const idPorClave = new Map<string, number>(
    (await client.execute({ sql: `select id, source_key from matches where source = ?`, args: [SOURCE] })).rows
      .map((r) => [String(r.source_key), Number(r.id)]),
  );
  const capturedAt = new Date().toISOString();
  const oddsStmts: { sql: string; args: unknown[] }[] = [];

  const pushOdds = (
    matchId: number, market: string, selection: string, line: number | null, bookmaker: string, valor: number,
  ) => {
    if (!(valor > 1)) return;
    oddsStmts.push({
      sql: `insert into odds
            (match_id, source, bookmaker, market, selection, odds, implied_prob, is_closing, captured_at, line)
            values (?, '${SOURCE}', ?, ?, ?, ?, ?, 0, ?, ?)
            on conflict do nothing`,
      args: [matchId, bookmaker, market, selection, Math.round(valor * 100) / 100,
        Math.round((1 / valor) * 1e4) / 1e4, capturedAt, line],
    });
  };

  for (const p of pendientes) {
    const id = idPorClave.get(p.sourceKey);
    if (!id) continue;
    pushOdds(id, 'match_winner', p.sel, null, `consensus(${p.books})`, p.mean);
    pushOdds(id, 'match_winner', p.sel, null, 'market_max', p.max);
  }
  for (const p of pendientesTotal) {
    const id = idPorClave.get(p.sourceKey);
    if (!id) continue;
    pushOdds(id, 'total_games', p.lado, p.line, `consensus(${p.books})`, p.mean);
    pushOdds(id, 'total_games', p.lado, p.line, 'market_max', p.max);
  }
  for (const p of pendientesHcp) {
    const id = idPorClave.get(p.sourceKey);
    if (!id) continue;
    pushOdds(id, 'games_hcp', p.sel, p.line, `consensus(${p.books})`, p.mean);
    pushOdds(id, 'games_hcp', p.sel, p.line, 'market_max', p.max);
  }

  await runBatch(client, oddsStmts, 'cuotas');
  console.log(`Escritos ${conCuota} partidos programados y ${oddsStmts.length} filas de cuota (source=${SOURCE}).`);
}

main().catch((e) => {
  console.error('Fallo en odds-ingest-io:', e);
  process.exit(1);
});
