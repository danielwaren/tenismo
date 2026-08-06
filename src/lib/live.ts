import { db } from './db';
import { fetchScoreboard, type EspnTournament } from './espn';
import { buildIndex, resolvePlayer } from './players';
import type { LiveMatchRow } from './queries';

const TTL_MS = 12_000;

export interface ExternalLiveMatch {
  id: string;
  internalId: null;
  p1Id: null;
  p2Id: null;
  p1Slug: '';
  p2Slug: '';
  tour: 'ATP' | 'WTA';
  tournament: string;
  providerTournament: string;
  tournamentId: null;
  surface: null;
  round: string | null;
  playedOn: string;
  status: 'live';
  p1Name: string;
  p2Name: string;
  /**
   * Siempre false: este partido no está enlazado con ningún jugador de la
   * base, así que no hay id con el que pedir una foto. Está declarado —en vez
   * de omitido— para que las vistas puedan pintar el avatar sin distinguir
   * antes de qué tipo de partido se trata.
   */
  p1Photo: false;
  p2Photo: false;
  p1Won: null;
  probP1: null;
  confidence: null;
  scoreP1: string | null;
  scoreP2: string | null;
  liveState: 'live';
  resolution: 'unresolved-player' | 'unlinked-match';
}

export type LiveDisplayMatch = (LiveMatchRow & { internalId: number; providerTournament: string; resolution: 'linked' }) | ExternalLiveMatch;
export type LiveProviderStatus = 'ok' | 'partial' | 'unavailable';

export interface LiveTournamentDisplay {
  id: string;
  internalId: number | null;
  tour: 'ATP' | 'WTA';
  name: string;
  liveMatches: number;
  linkedMatches: number;
  unresolvedMatches: number;
}

export interface LiveSnapshot {
  matches: LiveDisplayMatch[];
  tournaments: LiveTournamentDisplay[];
  status: LiveProviderStatus;
  coverage: { received: number; linked: number; unresolved: number; providersAvailable: number };
  at: string;
}

let cache: { at: number; snapshot: LiveSnapshot } | null = null;
let inFlight: Promise<LiveSnapshot> | null = null;

function fmtScore(sets: number[] | null): string | null {
  return sets?.length ? sets.join(' ') : null;
}

async function loadLive(): Promise<LiveSnapshot> {
  const c = db();
  const results = await Promise.allSettled([fetchScoreboard('atp'), fetchScoreboard('wta')]);
  const providersAvailable = results.filter((r) => r.status === 'fulfilled').length;
  if (providersAvailable === 0) throw new Error('Los dos marcadores de ESPN fallaron');

  const feeds: Array<['ATP' | 'WTA', EspnTournament[]]> = [
    ['ATP', results[0].status === 'fulfilled' ? results[0].value : []],
    ['WTA', results[1].status === 'fulfilled' ? results[1].value : []],
  ];
  const events: Array<{ tour: 'ATP' | 'WTA'; tournament: string; espnId: string; date: string; round: string | null; home: string; away: string; homeScore: number[] | null; awayScore: number[] | null }> = [];
  for (const [tour, tournaments] of feeds) for (const tournament of tournaments) {
    for (const match of tournament.matches) if (match.state === 'in') events.push({
      tour, tournament: tournament.name, espnId: match.id, date: match.date,
      round: match.round, home: match.homeName, away: match.awayName,
      homeScore: match.homeScore, awayScore: match.awayScore,
    });
  }

  const version = String((await c.execute("select v from app_config where k = 'model_version'")).rows[0]?.v ?? '');
  const indices: Record<string, ReturnType<typeof buildIndex>> = {};
  const aliases: Record<string, Map<string, number>> = {};
  for (const tour of ['ATP', 'WTA']) {
    const players = (await c.execute({
      sql: 'select p.id, p.slug from players p join tours t on t.id = p.tour_id where t.code = ?', args: [tour],
    })).rows.map((r) => ({ id: Number(r.id), slug: String(r.slug) }));
    indices[tour] = buildIndex(players);
    const aliasRows = (await c.execute({
      sql: `select a.slug, a.player_id from player_aliases a join players p on p.id = a.player_id join tours t on t.id = p.tour_id where t.code = ?`, args: [tour],
    })).rows;
    aliases[tour] = new Map(aliasRows.map((r) => [String(r.slug), Number(r.player_id)]));
  }

  const matches: LiveDisplayMatch[] = [];
  const linkedIds: number[] = [];
  const seen = new Set<number>();
  for (const event of events) {
    const home = resolvePlayer(event.home, indices[event.tour], aliases[event.tour]);
    const away = resolvePlayer(event.away, indices[event.tour], aliases[event.tour]);
    let row = (await c.execute({
      sql: `select m.id, t.code tour, tr.name tournament, tr.id tournament_id, m.surface, m.round, m.played_on, m.status, m.p1_id, m.p2_id, m.p1_won, p1.name p1_name, p2.name p2_name, p1.slug p1_slug, p2.slug p2_slug, mo.prob_p1, mo.confidence from matches m join tours t on t.id=m.tour_id join tournaments tr on tr.id=m.tournament_id join players p1 on p1.id=m.p1_id join players p2 on p2.id=m.p2_id left join model_outputs mo on mo.match_id=m.id and mo.model_version=? where m.source_key=?`,
      args: [version, `espn:${event.espnId}`],
    })).rows[0];

    if (!row && home.ok && away.ok && home.playerId !== away.playerId) {
      const p1 = Math.min(home.playerId, away.playerId);
      const p2 = Math.max(home.playerId, away.playerId);
      row = (await c.execute({
        sql: `select m.id, t.code tour, tr.name tournament, tr.id tournament_id, m.surface, m.round, m.played_on, m.status, m.p1_id, m.p2_id, m.p1_won, p1.name p1_name, p2.name p2_name, p1.slug p1_slug, p2.slug p2_slug, (p1.photo_url is not null) p1_photo, (p2.photo_url is not null) p2_photo, mo.prob_p1, mo.confidence from matches m join tours t on t.id=m.tour_id join tournaments tr on tr.id=m.tournament_id join players p1 on p1.id=m.p1_id join players p2 on p2.id=m.p2_id left join model_outputs mo on mo.match_id=m.id and mo.model_version=? where m.p1_id=? and m.p2_id=? and abs(m.played_on::date-current_date)<=3 order by case when m.status='scheduled' then 0 else 1 end limit 1`,
        args: [version, p1, p2],
      })).rows[0];
    }

    if (!row) {
      matches.push({
        id: `espn:${event.espnId}`, internalId: null, p1Id: null, p2Id: null, p1Slug: '', p2Slug: '', tour: event.tour, tournament: event.tournament,
        providerTournament: event.tournament,
        tournamentId: null, surface: null, round: event.round, playedOn: event.date, status: 'live',
        p1Name: event.home, p2Name: event.away, p1Photo: false, p2Photo: false,
        p1Won: null, probP1: null, confidence: null,
        scoreP1: fmtScore(event.homeScore), scoreP2: fmtScore(event.awayScore), liveState: 'live',
        resolution: home.ok && away.ok ? 'unlinked-match' : 'unresolved-player',
      });
      continue;
    }

    const matchId = Number(row.id);
    if (seen.has(matchId)) continue;
    seen.add(matchId);
    const p1IsHome = home.ok && home.playerId === Number(row.p1_id);
    const scoreP1 = fmtScore(p1IsHome ? event.homeScore : event.awayScore);
    const scoreP2 = fmtScore(p1IsHome ? event.awayScore : event.homeScore);
    matches.push({
      id: matchId, internalId: matchId, p1Id: Number(row.p1_id), p2Id: Number(row.p2_id), p1Slug: String(row.p1_slug), p2Slug: String(row.p2_slug), tour: String(row.tour), tournament: String(row.tournament),
      providerTournament: event.tournament,
      tournamentId: Number(row.tournament_id), surface: (row.surface as string | null) ?? null,
      round: (row.round as string | null) ?? null, playedOn: String(row.played_on), status: String(row.status),
      p1Name: String(row.p1_name), p2Name: String(row.p2_name),
      p1Photo: row.p1_photo === true, p2Photo: row.p2_photo === true,
      p1Won: row.p1_won === null ? null : Number(row.p1_won),
      probP1: row.prob_p1 === null ? null : Number(row.prob_p1),
      confidence: row.confidence === null ? null : Number(row.confidence),
      scoreP1, scoreP2, liveState: 'live', resolution: 'linked',
    });
    linkedIds.push(matchId);
    await c.execute({
      sql: `insert into live_scores (match_id,event_id,state,score_p1,score_p2,updated_at) values (?,?,'live',?,?,iso_now()) on conflict (match_id) do update set score_p1=excluded.score_p1,score_p2=excluded.score_p2,state='live',updated_at=excluded.updated_at`,
      args: [matchId, `espn:${event.espnId}`, scoreP1, scoreP2],
    });
  }

  // Solo limpiamos datos antiguos cuando al menos un proveedor respondió. Un fallo total
  // jamás debe parecer un día sin partidos.
  if (providersAvailable === 2 && linkedIds.length) await c.execute({
    sql: `delete from live_scores where match_id not in (${linkedIds.map(() => '?').join(',')})`, args: linkedIds,
  });
  else if (providersAvailable === 2 && events.length === 0) await c.execute('delete from live_scores');

  const unresolved = matches.filter((m) => m.resolution !== 'linked').length;
  const tournamentMap = new Map<string, LiveTournamentDisplay>();
  for (const match of matches) {
    const key = `${match.tour}:${match.providerTournament.toLocaleLowerCase()}`;
    const current = tournamentMap.get(key);
    const linked = match.resolution === 'linked';
    if (!current) tournamentMap.set(key, {
      id: key, internalId: linked ? match.tournamentId : null, tour: match.tour as 'ATP' | 'WTA',
      name: linked ? match.tournament : match.providerTournament, liveMatches: 1,
      linkedMatches: linked ? 1 : 0, unresolvedMatches: linked ? 0 : 1,
    });
    else {
      current.liveMatches += 1;
      current.linkedMatches += linked ? 1 : 0;
      current.unresolvedMatches += linked ? 0 : 1;
      if (linked && current.internalId === null) {
        current.internalId = match.tournamentId;
        current.name = match.tournament;
      }
    }
  }
  return {
    matches, tournaments: [...tournamentMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    status: providersAvailable < 2 || unresolved > 0 ? 'partial' : 'ok',
    coverage: { received: events.length, linked: linkedIds.length, unresolved, providersAvailable },
    at: new Date().toISOString(),
  };
}

export async function getLiveSnapshot(): Promise<LiveSnapshot> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.snapshot;
  if (inFlight) return inFlight;
  const request: Promise<LiveSnapshot> = loadLive().then((snapshot) => {
    cache = { at: Date.now(), snapshot };
    return snapshot;
  }).catch((error): LiveSnapshot => {
    console.warn('[live] Proveedor no disponible:', (error as Error).message);
    if (cache) return { ...cache.snapshot, status: 'unavailable' as const, at: new Date().toISOString() };
    return { matches: [], tournaments: [], status: 'unavailable', coverage: { received: 0, linked: 0, unresolved: 0, providersAvailable: 0 }, at: new Date().toISOString() };
  }).finally(() => { inFlight = null; });
  inFlight = request;
  return request;
}

export async function getLiveNow(): Promise<LiveDisplayMatch[]> {
  return (await getLiveSnapshot()).matches;
}
