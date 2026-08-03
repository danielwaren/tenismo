/**
 * Backtest: ¿mejora el Elo si se entrena también con los partidos de
 * Challenger (y el circuito principal pre-2013) que trajo Tennis Abstract?
 *
 *   npx tsx scripts/backtest-elo-ta.ts
 *
 * NO ESCRIBE NADA. Corre dos simulaciones Elo completas, solo en memoria:
 *   · BASE:    igual que train-elo.ts hoy — solo matches de source='tennis-data'.
 *   · VARIANTE: BASE + los partidos de ta_matches con level en (G,M,A,C) que
 *     NO están ya en `matches` (link_status='no_candidate') y con los dos
 *     jugadores resueltos a un player_id nuestro.
 *
 * Las dos simulaciones recorren el MISMO orden cronológico y, para cada
 * partido de `matches`, guardan la predicción walk-forward (con el estado
 * ANTES de ese partido, igual que en producción) antes de actualizar. Al
 * final se compara Brier score / log-loss de las dos series de predicciones
 * contra el resultado real. Solo se puntúan partidos de `matches` (los únicos
 * con resultado verificable en nuestro esquema) — los de Challenger informan
 * el rating pero no se evalúan directamente.
 *
 * ALCANCE DELIBERADO: se incluyen G (slam pre-2013), M (masters pre-2013), A
 * (circuito principal pre-2013) y C (challenger) — todos con jugadores
 * identificables. Se EXCLUYEN Futures/ITF (niveles S, 15, 25: muestra muy
 * ruidosa, jugadores semi-profesionales) y Copa Davis/Juegos Olímpicos
 * (dinámica de equipo/motivación distinta a un partido de circuito). Solo
 * ATP: Tennis Abstract WTA está fuera del proyecto por permiso de robots.txt
 * (ver db/migrations/008_tennis_abstract.sql), así que esto no toca WTA.
 *
 * event_date de Tennis Abstract es el INICIO DEL TORNEO, no la fecha del
 * partido — por eso el orden dentro de un mismo torneo se resuelve por ronda
 * (Q1 antes que R32 antes que F), no por fecha exacta.
 */
import { db } from '../src/lib/db';
import { loadEnv } from './lib/env';
import {
  DEFAULT_ELO, predictMatch, updateRatings,
  brierScore, logLoss, brierSkillScore,
  type Rating, type Surface, type BinaryOutcome,
} from '@tti/model';

loadEnv();

const TA_LEVELS = ['G', 'M', 'A', 'C'];
const LEVEL_SERIES: Record<string, string> = {
  G: 'grand slam', M: 'masters 1000', A: 'default', C: 'challenger',
};
const TA_ROUND_TO_ENGLISH: Record<string, string> = {
  Q1: 'Qualifying', Q2: 'Qualifying', Q3: 'Qualifying',
  R128: '1st Round', R64: '2nd Round', R32: '3rd Round', R16: '4th Round',
  QF: 'Quarterfinals', SF: 'Semifinals', BR: 'Semifinals', F: 'The Final', RR: 'Round Robin',
};
const ROUND_ORDER: Record<string, number> = {
  Qualifying: 0, '1st Round': 1, '2nd Round': 2, '3rd Round': 3,
  '4th Round': 4, 'Round Robin': 4, Quarterfinals: 5, Semifinals: 6, 'The Final': 7,
};

interface Item {
  dateKey: string;
  roundOrder: number;
  a: number; b: number; aWon: boolean;
  surface: Surface | null;
  series: string;
  round: string;
  fromTa: boolean;
  // Solo para los de `matches`: para poder anotar la predicción.
  matchId?: number;
  tourCode?: string;
}

async function main() {
  const c = db();
  console.log('Cargando partidos de circuito (source=tennis-data)…');
  const tour = (await c.execute(`
    select m.id, m.p1_id, m.p2_id, m.p1_won, m.surface, m.played_on, m.round, tr.series, t.code tour_code
    from matches m
    join tournaments tr on tr.id = m.tournament_id
    join tours t on t.id = m.tour_id
    where m.status = 'completed' and m.p1_won is not null and m.source = 'tennis-data'
    order by m.played_on, m.id
  `)).rows;
  console.log(`  ${tour.length} partidos.`);

  console.log('Cargando partidos de Tennis Abstract fuera de `matches` (Challenger + circuito pre-2013)…');
  const ta = (await c.execute({
    sql: `select event_date, round, level, surface, a_slug, b_slug, a_player_id, b_player_id, winner_slug
          from ta_matches
          where link_status = 'no_candidate' and level in (${TA_LEVELS.map(() => '?').join(',')})
            and a_player_id is not null and b_player_id is not null`,
    args: TA_LEVELS,
  })).rows;
  console.log(`  ${ta.length} partidos adicionales (niveles ${TA_LEVELS.join(',')}).`);

  const items: Item[] = [];
  for (const r of tour) {
    const round = (r.round as string | null) ?? 'default';
    items.push({
      dateKey: String(r.played_on),
      roundOrder: ROUND_ORDER[round] ?? 3,
      a: Number(r.p1_id), b: Number(r.p2_id), aWon: Number(r.p1_won) === 1,
      surface: (r.surface as Surface | null) ?? null,
      series: (r.series as string | null) ?? 'default',
      round,
      fromTa: false,
      matchId: Number(r.id),
      tourCode: String(r.tour_code),
    });
  }
  for (const r of ta) {
    const round = TA_ROUND_TO_ENGLISH[String(r.round)] ?? 'default';
    const surfRaw = (r.surface as string | null)?.toLowerCase() ?? null;
    items.push({
      dateKey: String(r.event_date),
      roundOrder: ROUND_ORDER[round] ?? 3,
      a: Number(r.a_player_id), b: Number(r.b_player_id),
      aWon: String(r.winner_slug) === String(r.a_slug),
      surface: (surfRaw as Surface | null),
      series: LEVEL_SERIES[String(r.level)] ?? 'default',
      round,
      fromTa: true,
    });
  }
  items.sort((x, y) => (x.dateKey < y.dateKey ? -1 : x.dateKey > y.dateKey ? 1 : x.roundOrder - y.roundOrder));
  console.log(`Total combinado, orden cronológico: ${items.length}\n`);

  // ── Simulación ───────────────────────────────────────────────────────────
  interface PlayerState { all: Rating; bySurface: Map<string, Rating> }
  const blank = (): PlayerState => ({ all: { elo: DEFAULT_ELO.baseElo, matches: 0 }, bySurface: new Map() });

  function run(includeTa: boolean) {
    const state = new Map<number, PlayerState>();
    const get = (pid: number, surface: Surface | null): { all: Rating; surf: Rating } => {
      if (!state.has(pid)) state.set(pid, blank());
      const s = state.get(pid)!;
      if (!surface) return { all: s.all, surf: { elo: s.all.elo, matches: 0 } };
      if (!s.bySurface.has(surface)) s.bySurface.set(surface, { elo: s.all.elo, matches: 0 });
      return { all: s.all, surf: s.bySurface.get(surface)! };
    };

    const preds: (BinaryOutcome & { matchId: number; tourCode: string })[] = [];

    for (const it of items) {
      if (it.fromTa && !includeTa) continue;

      const a = get(it.a, it.surface);
      const b = get(it.b, it.surface);

      if (!it.fromTa) {
        const pred = predictMatch({
          surface: (it.surface ?? 'hard') as Surface,
          p1: { overall: a.all, surface: a.surf },
          p2: { overall: b.all, surface: b.surf },
        });
        preds.push({ prob: pred.probP1, actual: it.aWon ? 1 : 0, matchId: it.matchId!, tourCode: it.tourCode! });
      }

      const next = updateRatings({
        p1Overall: a.all, p1Surface: a.surf, p2Overall: b.all, p2Surface: b.surf,
        p1Won: it.aWon, series: it.series, round: it.round,
      });
      const sA = state.get(it.a)!;
      const sB = state.get(it.b)!;
      sA.all = next.p1Overall;
      sB.all = next.p2Overall;
      if (it.surface) {
        sA.bySurface.set(it.surface, next.p1Surface);
        sB.bySurface.set(it.surface, next.p2Surface);
      }
    }
    return { preds, state };
  }

  console.log('Simulando BASE (solo circuito, igual que producción)…');
  const base = run(false);
  console.log('Simulando VARIANTE (circuito + Challenger/TA)…');
  const variant = run(true);

  // ── Métricas ─────────────────────────────────────────────────────────────
  const report = (label: string, rows: BinaryOutcome[]) => {
    if (!rows.length) { console.log(`  ${label}: sin partidos`); return; }
    console.log(
      `  ${label.padEnd(28)} Brier ${brierScore(rows).toFixed(5)}  ` +
      `log-loss ${logLoss(rows).toFixed(5)}  skill ${brierSkillScore(rows).toFixed(4)}  (n=${rows.length})`,
    );
  };

  console.log('\n── Resultado (todos los tours) ──────────────────────────────');
  report('BASE', base.preds);
  report('VARIANTE (+Challenger/TA)', variant.preds);

  console.log('\n── Solo ATP (lo único que puede cambiar: Challenger es ATP-only) ──');
  report('BASE', base.preds.filter((p) => p.tourCode === 'ATP'));
  report('VARIANTE (+Challenger/TA)', variant.preds.filter((p) => p.tourCode === 'ATP'));

  console.log('\n── Solo WTA (control: no debería cambiar) ──');
  report('BASE', base.preds.filter((p) => p.tourCode === 'WTA'));
  report('VARIANTE (+Challenger/TA)', variant.preds.filter((p) => p.tourCode === 'WTA'));

  // ── Ejemplo ilustrativo ────────────────────────────────────────────────
  const tabilo = (await c.execute("select id from players where name like '%Tabilo%'")).rows[0];
  if (tabilo) {
    const pid = Number(tabilo.id);
    const b = base.state.get(pid);
    const v = variant.state.get(pid);
    console.log('\n── Ejemplo: Alejandro Tabilo ──────────────────────────────────');
    console.log(`  BASE:      Elo global ${b?.all.elo.toFixed(0)}  (${b?.all.matches} partidos)`);
    console.log(`  VARIANTE:  Elo global ${v?.all.elo.toFixed(0)}  (${v?.all.matches} partidos)`);
  }

  console.log('\nNo se ha escrito nada en la base. Esto es solo comparación.');
}

main().catch((e) => {
  console.error('\nFallo en el backtest:', e);
  process.exit(1);
});
