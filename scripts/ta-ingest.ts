/**
 * Ingesta de estadísticas de saque y resto desde tennisabstract.com (ATP).
 *
 *   npm run db:ta                      # rastrea 40 fichas y enlaza
 *   npm run db:ta -- --max 200         # más fichas en esta pasada
 *   npm run db:ta -- --link-only       # sin red: solo re-enlaza lo ya guardado
 *   npm run db:ta -- --seed "Carlos Alcaraz" --seed "Jack Draper"
 *   npm run db:ta -- --force           # ignora la caché en disco
 *
 * CÓMO ENCUENTRA A LOS JUGADORES (bola de nieve). Tennis Abstract no publica
 * un índice de jugadores bajo /cgi-bin/ — el que existe está en /jsplayers/,
 * que su robots.txt prohíbe. Pero cada ficha nombra a TODOS los rivales de ese
 * jugador, así que el índice se construye rastreando: se parte de unas semillas
 * y cada ficha descubre las siguientes. Dos o tres saltos desde el top-100
 * alcanzan el circuito Challenger.
 *
 * QUÉ ESCRIBE Y QUÉ NO:
 *   · `ta_matches`  todo lo que ve, incluidos Challengers e ITF que no están en
 *                   `matches`. Es un almacén intermedio: no crea partidos.
 *   · `match_stats` solo los partidos que ya existen en `matches` y que se
 *                   enlazan sin ambigüedad.
 * `tennis-data` sigue siendo la ÚNICA fuente autorizada de resultados: esta
 * ingesta no toca `matches` ni el Elo. Promover los Challengers de `ta_matches`
 * a partidos de verdad es una decisión aparte y consciente.
 *
 * IDEMPOTENTE: repetir la pasada no duplica nada (upsert por `ta_key` y por
 * `(match_id, player_id)`), y cada partido se ve dos veces a propósito — una
 * por la ficha de cada jugador — lo que da validación cruzada gratis.
 */
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, isLocalDb } from '../src/lib/db';
import { buildIndex, resolvePlayer, type PlayerIndex } from '../src/lib/players';
import { loadEnv } from './lib/env';
import { runBatch as runBatchWithRetry } from './lib/batch';
import { bulkLinkStmts, type TaLink } from './lib/links';
import {
  fetchPlayerPage,
  parsePlayerPage,
  taNameFromFullName,
  taSlug,
  sameScore,
  TA_DELAY_MS,
  TA_SOURCE,
  type TaMatch,
  type SideStats,
} from './lib/ta';

loadEnv();

const CACHE_DIR = join(process.cwd(), 'data', 'raw', 'ta');

/**
 * Semillas del rastreo: jugadores actuales repartidos por nivel para que la
 * bola de nieve alcance pronto tanto el top como el circuito Challenger.
 * Solo se usan cuando `ta_frontier` está vacía.
 *
 * Van con la grafía de Tennis Abstract, que capitaliza las partículas: "Alex De
 * Minaur", no "Alex de Minaur". Equivocarse cuesta una petición perdida y nada
 * más — el nombre correcto aparece igualmente como rival en cualquier otra
 * ficha, con la ortografía de la fuente. Lo mismo vale para `--seed`.
 */
const DEFAULT_SEEDS = [
  'Novak Djokovic', 'Carlos Alcaraz', 'Jannik Sinner', 'Alexander Zverev',
  'Daniil Medvedev', 'Taylor Fritz', 'Casper Ruud', 'Stefanos Tsitsipas',
  'Lorenzo Musetti', 'Ben Shelton', 'Alex De Minaur', 'Andrey Rublev',
  'Mattia Bellucci', 'Tomas Martin Etcheverry',
];

/** Ventana para casar la fecha de INICIO DE TORNEO de TA con la del partido. */
const TOURNAMENT_WINDOW_DAYS = 21;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function argAll(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const runBatch = (stmts: { sql: string; args: unknown[] }[], label: string) =>
  runBatchWithRetry(db(), stmts, label, { chunk: 300 });

const STAT_KEYS: (keyof SideStats)[] = [
  'ace', 'df', 'svpt', 'firstIn', 'firstWon', 'secondWon', 'svGms', 'bpSaved', 'bpFaced',
];

const sameStats = (x: SideStats, y: SideStats) => STAT_KEYS.every((k) => x[k] === y[k]);

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Rastreo ──────────────────────────────────────────────────────────────────

interface FrontierRow { taName: string; fullName: string; taId: string | null; depth: number }

async function seedFrontier(seeds: string[]): Promise<void> {
  const client = db();
  const n = Number((await client.execute('select count(*) n from ta_frontier')).rows[0].n);
  const extra = seeds.map((s) => ({ full: s, ta: taNameFromFullName(s) })).filter((s) => s.ta);
  if (n > 0 && !extra.length) return;

  const list = n === 0 && !extra.length ? DEFAULT_SEEDS.map((s) => ({ full: s, ta: taNameFromFullName(s) })) : extra;
  if (!list.length) return;

  await runBatch(
    list.map((s) => ({
      sql: `insert into ta_frontier (ta_name, full_name, depth, seen_from) values (?, ?, 0, 'semilla')
            on conflict (ta_name) do nothing`,
      args: [s.ta, s.full],
    })),
    'semillas',
  );
  console.log(`  semillas: ${list.length}`);
}

async function nextBatch(limit: number, maxDepth: number): Promise<FrontierRow[]> {
  const res = await db().execute({
    sql: `select ta_name, full_name, ta_id, depth from ta_frontier
          where fetched = 0 and depth <= ? order by depth, seen_at limit ?`,
    args: [maxDepth, limit],
  });
  return res.rows.map((r) => ({
    taName: String(r.ta_name),
    fullName: String(r.full_name),
    taId: r.ta_id == null ? null : String(r.ta_id),
    depth: Number(r.depth),
  }));
}

// ── Almacén intermedio ───────────────────────────────────────────────────────

/** Fusiona las dos visitas al mismo partido y detecta discrepancias. */
function mergeSighting(
  acc: Map<string, { m: TaMatch; sides: number; conflict: boolean }>,
  m: TaMatch,
): void {
  const prev = acc.get(m.key);
  if (!prev) {
    acc.set(m.key, { m, sides: 1, conflict: false });
    return;
  }
  // La segunda ficha no aporta datos nuevos: confirma los de la primera. Si no
  // coinciden, algo va mal en el mapeo o en la fuente y NO se escribe nada.
  const conflict =
    prev.conflict ||
    (prev.m.hasStats && m.hasStats && (!sameStats(prev.m.a.stats, m.a.stats) || !sameStats(prev.m.b.stats, m.b.stats)));
  // Se conserva la visita que sí trae estadísticas.
  const best = prev.m.hasStats ? prev.m : m;
  acc.set(m.key, { m: best, sides: Math.min(prev.sides + 1, 2), conflict });
}

function upsertTaMatch(e: { m: TaMatch; sides: number; conflict: boolean }, aId: number | null, bId: number | null) {
  const { m } = e;
  const s = (side: 'a' | 'b') => {
    const st = m[side].stats;
    return [st.ace, st.df, st.svpt, st.firstIn, st.firstWon, st.secondWon, st.svGms, st.bpSaved, st.bpFaced];
  };
  return {
    sql: `insert into ta_matches (
            ta_key, tour_code, event_date, event, level, surface, round, best_of, score, minutes,
            a_slug, a_name, a_player_id, a_rank, b_slug, b_name, b_player_id, b_rank, winner_slug,
            a_ace,a_df,a_svpt,a_first_in,a_first_won,a_second_won,a_sv_gms,a_bp_saved,a_bp_faced,
            b_ace,b_df,b_svpt,b_first_in,b_first_won,b_second_won,b_sv_gms,b_bp_saved,b_bp_faced,
            mcp_chart_id, ta_event_id, sides_seen, conflict, link_status)
          values (?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?, ?,?,?,?,?)
          on conflict (ta_key) do update set
            a_player_id  = coalesce(excluded.a_player_id, ta_matches.a_player_id),
            b_player_id  = coalesce(excluded.b_player_id, ta_matches.b_player_id),
            sides_seen   = greatest(ta_matches.sides_seen, excluded.sides_seen),
            conflict     = greatest(ta_matches.conflict, excluded.conflict),
            mcp_chart_id = coalesce(excluded.mcp_chart_id, ta_matches.mcp_chart_id),
            updated_at   = iso_now()`,
    args: [
      m.key, 'ATP', m.eventDate, m.event, m.level, m.surface, m.round, m.bestOf, m.score, m.minutes,
      m.a.slug, m.a.fullName, aId, m.a.rank, m.b.slug, m.b.fullName, bId, m.b.rank, m.winnerSlug,
      ...s('a'), ...s('b'),
      m.mcpChartId, m.eventId, e.sides, e.conflict ? 1 : 0,
      e.conflict ? 'conflict' : m.hasStats ? 'pending' : 'no_stats',
    ],
  };
}

// ── Enlace con nuestros partidos ─────────────────────────────────────────────

interface PendingRow {
  taKey: string; eventDate: string; score: string | null;
  aId: number | null; bId: number | null;
  a: SideStats; b: SideStats;
}

/**
 * Enlaza las filas del almacén intermedio con `matches` y escribe `match_stats`.
 *
 * El emparejamiento NO puede ir por fecha exacta: la columna 0 de TA es la
 * fecha de inicio del TORNEO, así que en un Grand Slam el partido real puede
 * ser dos semanas después. Y tampoco por ronda: "R32" de TA equivale a "1ª
 * ronda" o a "2ª ronda" según el tamaño del cuadro, que la fuente no da.
 * Queda: circuito + pareja de jugadores + ventana de 21 días + MARCADOR.
 *
 * EL MARCADOR SE COMPRUEBA SIEMPRE, no solo para desempatar. La primera versión
 * lo usaba únicamente cuando había varios candidatos, y con un solo candidato
 * enlazaba a ciegas: un round robin de la Laver Cup (6-3 6-2) acabó pegado a la
 * final de Tokio (6-4 6-4) porque caía dentro de la ventana de 21 días y era el
 * único partido de esa pareja. Mismo fallo con ATP Cup → Open de Australia y con
 * una previa de Lyon → cuadro principal de Lyon. Un candidato único no es
 * prueba de nada; el marcador sí.
 *
 * Si quedan dos candidatos tras el filtro, no se enlaza ninguno — la misma regla
 * que ya rige la reconciliación de The Odds API.
 */
async function linkPending(atpTourId: number): Promise<Record<string, number>> {
  const client = db();

  // Todos los partidos ATP en memoria, indexados por pareja. Antes esto era una
  // consulta por fila pendiente: contra un fichero local da igual, pero contra
  // Turso son miles de idas y venidas por red.
  const byPair = new Map<string, { id: number; playedOn: string; score: string | null }[]>();
  const all = await client.execute({
    sql: 'select id, p1_id, p2_id, played_on, sets_json from matches where tour_id = ?',
    args: [atpTourId],
  });
  for (const r of all.rows) {
    const key = pairKey(Number(r.p1_id), Number(r.p2_id));
    const list = byPair.get(key) ?? [];
    list.push({ id: Number(r.id), playedOn: String(r.played_on), score: setsToScore(String(r.sets_json ?? '')) });
    byPair.set(key, list);
  }

  const res = await client.execute({
    sql: `select ta_key, event_date, score, a_player_id, b_player_id,
                 a_ace,a_df,a_svpt,a_first_in,a_first_won,a_second_won,a_sv_gms,a_bp_saved,a_bp_faced,
                 b_ace,b_df,b_svpt,b_first_in,b_first_won,b_second_won,b_sv_gms,b_bp_saved,b_bp_faced
          from ta_matches
          where link_status in ('pending','no_candidate','score_mismatch')
            and conflict = 0 and a_svpt is not null`,
    args: [],
  });

  const side = (r: Record<string, unknown>, p: 'a' | 'b'): SideStats => ({
    ace: r[`${p}_ace`] as number, df: r[`${p}_df`] as number, svpt: r[`${p}_svpt`] as number,
    firstIn: r[`${p}_first_in`] as number, firstWon: r[`${p}_first_won`] as number,
    secondWon: r[`${p}_second_won`] as number, svGms: r[`${p}_sv_gms`] as number,
    bpSaved: r[`${p}_bp_saved`] as number, bpFaced: r[`${p}_bp_faced`] as number,
  });

  const pending: PendingRow[] = res.rows.map((r) => ({
    taKey: String(r.ta_key),
    eventDate: String(r.event_date),
    score: r.score == null ? null : String(r.score),
    aId: r.a_player_id == null ? null : Number(r.a_player_id),
    bId: r.b_player_id == null ? null : Number(r.b_player_id),
    a: side(r as never, 'a'),
    b: side(r as never, 'b'),
  }));

  const counts: Record<string, number> = {
    linked: 0, no_candidate: 0, score_mismatch: 0, ambiguous: 0, unresolved: 0, no_score: 0,
  };
  // Los enlaces se acumulan como DATOS, no como sentencias sueltas: son ~46.000
  // y de una en una tardaban más que todo el resto del job junto (el run #10
  // murió por timeout ahí, con el rastreo y las 52.676 filas de ta_matches ya
  // escritas). Abajo se convierten en unos pocos `update ... from (values ...)`.
  const links: TaLink[] = [];
  const statStmts: { sql: string; args: unknown[] }[] = [];
  const mark = (key: string, status: string) => {
    counts[status]++;
    links.push({ taKey: key, status, matchId: null });
  };

  for (const p of pending) {
    if (!p.aId || !p.bId) {
      counts.unresolved++;
      continue; // se queda 'pending': quizá el jugador aparezca en otra pasada
    }
    if (!p.score) {
      // Sin marcador no se puede verificar la identidad del partido. Antes de
      // enlazar a ciegas, se deja sin enlazar y se cuenta.
      mark(p.taKey, 'no_score');
      continue;
    }

    const window = addDays(p.eventDate, TOURNAMENT_WINDOW_DAYS);
    const inWindow = (byPair.get(pairKey(p.aId, p.bId)) ?? []).filter(
      (m) => m.playedOn >= p.eventDate && m.playedOn <= window,
    );
    if (inWindow.length === 0) {
      mark(p.taKey, 'no_candidate');
      continue;
    }

    const hits = inWindow.filter((m) => sameScore(p.score, m.score));
    if (hits.length === 0) {
      // Había partidos de esa pareja en la ventana, pero ninguno con ese
      // marcador: es OTRO partido (previa, round robin, torneo solapado).
      mark(p.taKey, 'score_mismatch');
      continue;
    }
    if (hits.length > 1) {
      mark(p.taKey, 'ambiguous');
      continue;
    }

    const matchId = hits[0].id;
    counts.linked++;
    links.push({ taKey: p.taKey, status: 'linked', matchId });
    for (const [pid, st] of [[p.aId, p.a], [p.bId, p.b]] as const) {
      statStmts.push({
        sql: `insert into match_stats
                (match_id, player_id, serve_points, first_in, first_won, second_won, serve_games,
                 aces, double_faults, bp_saved, bp_faced, source, ta_key)
              values (?,?,?,?,?,?,?,?,?,?,?,?,?)
              on conflict (match_id, player_id) do update set
                serve_points=excluded.serve_points, first_in=excluded.first_in,
                first_won=excluded.first_won, second_won=excluded.second_won,
                serve_games=excluded.serve_games, aces=excluded.aces,
                double_faults=excluded.double_faults, bp_saved=excluded.bp_saved,
                bp_faced=excluded.bp_faced, ta_key=excluded.ta_key`,
        args: [
          matchId, pid, st.svpt, st.firstIn, st.firstWon, st.secondWon, st.svGms,
          st.ace, st.df, st.bpSaved, st.bpFaced, TA_SOURCE, p.taKey,
        ],
      });
    }
  }

  await runBatch(statStmts, 'estadísticas');
  await runBatch(bulkLinkStmts(links), 'enlaces');
  return counts;
}

/** Clave de pareja independiente del orden. */
const pairKey = (x: number, y: number) => (x < y ? `${x}|${y}` : `${y}|${x}`);

/** `sets_json` ([[6,4],[7,5]], ganador primero) → '6-4 7-5' para comparar. */
function setsToScore(setsJson: string): string | null {
  if (!setsJson) return null;
  try {
    const sets = JSON.parse(setsJson) as [number, number][];
    if (!Array.isArray(sets) || !sets.length) return null;
    return sets.map(([w, l]) => `${w}-${l}`).join(' ');
  } catch {
    return null;
  }
}

// ── Principal ────────────────────────────────────────────────────────────────

async function main() {
  const client = db();
  const max = Number(arg('max', '40'));
  const maxDepth = Number(arg('depth', '3'));
  const delayMs = Number(arg('delay', String(TA_DELAY_MS)));
  const linkOnly = hasFlag('link-only');
  const force = hasFlag('force');

  console.log(`Base: ${isLocalDb() ? 'SIN CONFIGURAR' : 'Supabase'} — ${process.env.SUPABASE_DB_HOST}`);

  const atpTourId = Number((await client.execute("select id from tours where code='ATP'")).rows[0].id);

  // Índice de jugadores ATP para resolver los nombres completos de TA.
  const rows = (await client.execute({
    sql: 'select id, slug from players where tour_id = ?',
    args: [atpTourId],
  })).rows.map((r) => ({ id: Number(r.id), slug: String(r.slug) }));
  const index: PlayerIndex = buildIndex(rows);
  const aliases = new Map<string, number>(
    (await client.execute({
      sql: 'select a.slug, a.player_id from player_aliases a join players p on p.id = a.player_id where p.tour_id = ?',
      args: [atpTourId],
    })).rows.map((r) => [String(r.slug), Number(r.player_id)]),
  );
  console.log(`Jugadores ATP en base: ${rows.length} (+${aliases.size} alias)\n`);

  const resolve = (fullName: string): number | null => {
    const r = resolvePlayer(fullName, index, aliases);
    return r.ok ? r.playerId : null;
  };

  if (!linkOnly) {
    await seedFrontier(argAll('seed'));

    const queue = await nextBatch(max, maxDepth);
    if (!queue.length) {
      console.log('Frontera vacía: no quedan fichas por pedir dentro de la profundidad indicada.');
    } else {
      console.log(`Rastreando ${queue.length} fichas (1 cada ${delayMs / 1000}s ≈ ${Math.ceil((queue.length * delayMs) / 60000)} min)\n`);
    }

    const seen = new Map<string, { m: TaMatch; sides: number; conflict: boolean }>();
    const newFrontier = new Map<string, { taName: string; fullName: string; taId: string | null; from: string; depth: number }>();
    const playerStmts: { sql: string; args: unknown[] }[] = [];
    const aliasStmts: { sql: string; args: unknown[] }[] = [];
    let ok = 0;
    let failed = 0;

    for (const [i, f] of queue.entries()) {
      process.stdout.write(`  [${i + 1}/${queue.length}] ${f.taName} … `);
      let html: string;
      try {
        html = await fetchPlayerPage(f.taName, { cacheDir: CACHE_DIR, force, delayMs: i === 0 ? 0 : delayMs });
      } catch (e) {
        failed++;
        console.log(`ERROR: ${(e as Error).message.slice(0, 90)}`);
        playerStmts.push({
          sql: `update ta_frontier set fetched = 1 where ta_name = ?`,
          args: [f.taName],
        });
        continue;
      }

      let parsed;
      try {
        parsed = parsePlayerPage(html, f.taName);
      } catch (e) {
        // Casi siempre es la trampa del jugador equivocado. Se marca y se sigue:
        // no se ingiere NADA de una respuesta que no se ha podido identificar.
        failed++;
        console.log(`DESCARTADA: ${(e as Error).message.slice(0, 90)}`);
        playerStmts.push({ sql: `update ta_frontier set fetched = 1 where ta_name = ?`, args: [f.taName] });
        continue;
      }

      ok++;
      for (const m of parsed.matches) mergeSighting(seen, m);

      const playerId = resolve(parsed.fullName);
      const conStats = parsed.matches.filter((m) => m.hasStats).length;
      const ultimo = parsed.matches.map((m) => m.eventDate).sort().pop() ?? null;
      console.log(`${parsed.matches.length} partidos (${conStats} con stats)${playerId ? '' : '  [sin jugador en base]'}`);

      if (playerId) {
        playerStmts.push({
          sql: `insert into ta_players (player_id, ta_name, full_name, ta_id, last_fetched_at, last_match_date, matches_seen, status)
                values (?,?,?,?, iso_now(), ?, ?, 'ok')
                on conflict (player_id) do update set
                  ta_name=excluded.ta_name, full_name=excluded.full_name,
                  ta_id=coalesce(excluded.ta_id, ta_players.ta_id),
                  last_fetched_at=excluded.last_fetched_at, last_match_date=excluded.last_match_date,
                  matches_seen=excluded.matches_seen, status='ok'`,
          args: [playerId, f.taName, parsed.fullName, f.taId, ultimo, parsed.matches.length],
        });
        // El alias ahorra resolver por heurística en las siguientes pasadas.
        aliasStmts.push({
          sql: `insert into player_aliases (player_id, alias, slug, source) values (?,?,?,?)
                on conflict (slug, player_id) do nothing`,
          args: [playerId, parsed.fullName, taSlug(parsed.fullName), TA_SOURCE],
        });
      }
      playerStmts.push({ sql: `update ta_frontier set fetched = 1 where ta_name = ?`, args: [f.taName] });

      for (const o of parsed.opponents) {
        if (!newFrontier.has(o.taName)) {
          newFrontier.set(o.taName, { ...o, from: f.taName, depth: f.depth + 1 });
        }
      }
    }

    console.log(`\n  fichas leídas: ${ok}  ·  descartadas: ${failed}`);
    console.log(`  partidos distintos vistos: ${seen.size}`);

    const conflictos = [...seen.values()].filter((e) => e.conflict).length;
    const dobles = [...seen.values()].filter((e) => e.sides === 2).length;
    console.log(`  confirmados por las dos fichas: ${dobles}  ·  discrepancias: ${conflictos}`);

    // Escritura
    const matchStmts = [...seen.values()].map((e) =>
      upsertTaMatch(e, resolve(e.m.a.fullName), resolve(e.m.b.fullName)),
    );
    await runBatch(matchStmts, 'ta_matches');
    await runBatch(aliasStmts, 'alias');
    await runBatch(playerStmts, 'ta_players');

    await runBatch(
      [...newFrontier.values()].map((o) => ({
        sql: `insert into ta_frontier (ta_name, full_name, ta_id, seen_from, depth) values (?,?,?,?,?)
              on conflict (ta_name) do nothing`,
        args: [o.taName, o.fullName, o.taId, o.from, o.depth],
      })),
      'frontera',
    );
  }

  // ── Enlace ─────────────────────────────────────────────────────────────────
  if (hasFlag('relink')) {
    // Vuelve a comprobar TODO, incluido lo ya enlazado. Hace falta cuando cambia
    // la regla de emparejamiento: los enlaces viejos no se revisan solos.
    await client.execute(`delete from match_stats where source = '${TA_SOURCE}'`);
    await client.execute(`update ta_matches set match_id = null, link_status = case
        when conflict = 1 then 'conflict'
        when a_svpt is null then 'no_stats'
        else 'pending' end`);
    console.log('\n  --relink: enlaces y estadísticas de Tennis Abstract borrados, se recalculan.');
  }

  console.log('\nEnlazando con partidos existentes…');
  const counts = await linkPending(atpTourId);
  console.log(`  enlazados            ${counts.linked}`);
  console.log(`  sin candidato        ${counts.no_candidate}   (Challenger/ITF/exhibición o anterior a 2013: no están en matches)`);
  console.log(`  marcador distinto    ${counts.score_mismatch}   (había pareja en la ventana pero era otro partido)`);
  console.log(`  ambiguos             ${counts.ambiguous}`);
  console.log(`  sin marcador         ${counts.no_score}`);
  console.log(`  jugador sin casar    ${counts.unresolved}`);

  // ── Resumen ────────────────────────────────────────────────────────────────
  const q = async (sql: string) => Number((await db().execute(sql)).rows[0].n);
  const estado: [string, number][] = [
    ['fichas pendientes en la frontera', await q('select count(*) n from ta_frontier where fetched = 0')],
    ['jugadores con ficha leída', await q('select count(*) n from ta_players')],
    ['partidos vistos', await q('select count(*) n from ta_matches')],
    ['   con estadísticas', await q('select count(*) n from ta_matches where a_svpt is not null')],
    ['   enlazados', await q("select count(*) n from ta_matches where link_status='linked'")],
    ['filas de match_stats', await q('select count(*) n from match_stats')],
    ['partidos nuestros con stats', await q('select count(distinct match_id) n from match_stats')],
  ];

  console.log('\nEstado:');
  for (const [k, v] of estado) console.log(`  ${k.padEnd(34)} ${v}`);

  // En GitHub Actions, el mismo resumen va a la pestaña del job. Se escribe
  // desde aquí y no con un `tsx -e` en el YAML: ese inline no llegaba a
  // ejecutarse y el paso terminaba en verde sin imprimir nada.
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    const md = [
      '### Estadísticas de Tennis Abstract (ATP)',
      '',
      '| | |',
      '|---|---:|',
      ...estado.map(([k, v]) => `| ${k.trim()} | **${v}** |`),
      '',
      `_Enlazados en esta pasada: ${counts.linked} · sin candidato: ${counts.no_candidate} · marcador distinto: ${counts.score_mismatch} · ambiguos: ${counts.ambiguous}_`,
      '',
    ].join('\n');
    appendFileSync(summaryFile, md, 'utf8');
  }
}

main().catch((e) => {
  console.error('\nFallo en la ingesta de Tennis Abstract:', e);
  process.exit(1);
});
