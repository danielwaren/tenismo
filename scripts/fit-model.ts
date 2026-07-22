/**
 * Ajusta la regresión logística sobre las features y la evalúa FUERA DE MUESTRA.
 *
 *   npx tsx scripts/fit-model.ts
 *   npx tsx scripts/fit-model.ts --train-until 2021 --valid 2022 --version tennis-logreg-1.1.0
 *
 * Reparto temporal, nunca aleatorio: un split al azar mezclaría partidos de la
 * misma semana en train y test, y el modelo se estaría evaluando sobre jugadores
 * cuya forma ya vio. El corte es por temporada:
 *   · train  … hasta --train-until
 *   · valid  … la temporada siguiente, solo para elegir la penalización L2
 *   · test   … de ahí en adelante, jamás usada para ajustar nada
 *
 * Con el L2 elegido, el modelo final se reajusta sobre train+valid. El test
 * sigue limpio.
 */
import { db } from '../src/lib/db';
import { loadEnv } from './lib/env';
import {
  FEATURE_NAMES, fitLogistic, predictProb, meanLogLoss,
  brierScore, logLoss, devigTwoWay, expectedWinProb,
  type BinaryOutcome, type LogRegModel,
} from '@tti/model';

loadEnv();

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Rejilla amplia a propósito: en el primer ajuste el óptimo cayó en el extremo
// (L2=1000), señal de que la rejilla se quedaba corta. Si vuelve a elegirse un
// extremo, el aviso al final lo señala en vez de dar el resultado por bueno.
const L2_GRID = [0.1, 1, 3, 10, 30, 100, 300, 1000, 3000, 10000, 30000];
const fmt = (x: number, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : '—');

interface RowData {
  matchId: number;
  season: number;
  x: number[];
  y: number;
  eloProb: number;
  market: number | null;
}

async function main() {
  const client = db();
  const trainUntil = Number(arg('train-until', '2022'));
  const validSeason = Number(arg('valid', String(trainUntil + 1)));
  const version = arg('version', 'tennis-logreg-1.0.0');
  const book = arg('book', 'pinnacle');

  const res = await client.execute({
    sql: `
      select f.match_id, m.season, m.p1_won,
             f.elo_diff_surface, f.elo_diff_overall, f.rank_log_diff, f.points_log_diff,
             f.h2h, f.h2h_surface, f.load_diff, f.intensity_diff, f.rest_diff, f.form_diff,
             f.exp_diff, f.surface_exp_diff, f.best_of5_elo_diff,
             o1.odds as odds_p1, o2.odds as odds_p2
      from match_features f
      join matches m on m.id = f.match_id
      left join odds o1 on o1.match_id = m.id and o1.selection = 'p1' and o1.bookmaker = ?
      left join odds o2 on o2.match_id = m.id and o2.selection = 'p2' and o2.bookmaker = ?
      where m.status = 'completed' and m.p1_won is not null
      order by m.played_on, m.id
    `,
    args: [book, book],
  });

  if (!res.rows.length) {
    console.log('No hay features. Ejecuta primero `npm run db:elo -- --reset`.');
    return;
  }

  const data: RowData[] = res.rows.map((r) => {
    // El orden DEBE coincidir con FEATURE_NAMES.
    const x = [
      Number(r.elo_diff_surface), Number(r.elo_diff_overall), Number(r.rank_log_diff),
      Number(r.points_log_diff), Number(r.h2h), Number(r.h2h_surface),
      Number(r.load_diff), Number(r.intensity_diff), Number(r.rest_diff),
      Number(r.form_diff), Number(r.exp_diff), Number(r.surface_exp_diff),
      Number(r.best_of5_elo_diff),
    ];
    if (x.length !== FEATURE_NAMES.length) {
      throw new Error(`Desajuste: ${x.length} columnas para ${FEATURE_NAMES.length} features`);
    }
    const o1 = r.odds_p1 === null ? null : Number(r.odds_p1);
    const o2 = r.odds_p2 === null ? null : Number(r.odds_p2);
    const dev = o1 && o2 ? devigTwoWay(o1, o2) : null;
    return {
      matchId: Number(r.match_id),
      season: Number(r.season),
      x,
      y: Number(r.p1_won) === 1 ? 1 : 0,
      // El Elo puro se reconstruye desde su propia feature: es exactamente la
      // probabilidad que produjo el modelo de la Fase 1.
      eloProb: expectedWinProb(Number(r.elo_diff_surface) * 400, 0),
      market: dev ? dev.p1 : null,
    };
  });

  const train = data.filter((d) => d.season <= trainUntil);
  const valid = data.filter((d) => d.season === validSeason);
  const test = data.filter((d) => d.season > validSeason);

  console.log(`Features: ${FEATURE_NAMES.length}   ·   casa de referencia: ${book}`);
  console.log(`  train  ≤${trainUntil}      ${train.length} partidos`);
  console.log(`  valid   ${validSeason}         ${valid.length} partidos`);
  console.log(`  test   >${validSeason}      ${test.length} partidos\n`);

  if (!train.length || !valid.length || !test.length) {
    console.log('Alguno de los tres conjuntos está vacío: ajusta --train-until / --valid.');
    return;
  }

  // ── Elección del L2 sobre validación ───────────────────────────────────────
  const Xtr = train.map((d) => d.x);
  const ytr = train.map((d) => d.y);
  const Xva = valid.map((d) => d.x);
  const yva = valid.map((d) => d.y);

  let best: { l2: number; ll: number; model: LogRegModel } | null = null;
  console.log('Selección de penalización L2 (log-loss en validación):');
  for (const l2 of L2_GRID) {
    const model = fitLogistic(Xtr, ytr, [...FEATURE_NAMES], { l2 });
    const ll = meanLogLoss(Xva, yva, model);
    console.log(`  L2 ${String(l2).padStart(6)}   ${fmt(ll)}${model.converged ? '' : '  (sin converger)'}`);
    if (!best || ll < best.ll) best = { l2, ll, model };
  }
  console.log(`  elegido L2 = ${best!.l2}`);
  if (best!.l2 === L2_GRID[0] || best!.l2 === L2_GRID[L2_GRID.length - 1]) {
    console.log(
      `  ! AVISO: el óptimo cae en el extremo de la rejilla. El verdadero óptimo\n` +
      `    puede estar fuera; amplía L2_GRID antes de fiarte de estos pesos.`,
    );
  }
  console.log('');

  // Modelo final: mismo L2, reajustado sobre train+valid. El test sigue limpio.
  const trainFull = [...train, ...valid];
  const model = fitLogistic(
    trainFull.map((d) => d.x),
    trainFull.map((d) => d.y),
    [...FEATURE_NAMES],
    { l2: best!.l2 },
  );

  console.log('Pesos ajustados (sin término independiente, por antisimetría):');
  const byMagnitude = FEATURE_NAMES.map((n, i) => ({ n, w: model.weights[i] }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  for (const { n, w } of byMagnitude) {
    const bar = '█'.repeat(Math.min(30, Math.round(Math.abs(w) * 6)));
    console.log(`  ${n.padEnd(17)} ${w >= 0 ? '+' : '-'}${Math.abs(w).toFixed(3).padStart(6)}  ${bar}`);
  }

  // ── Evaluación fuera de muestra ────────────────────────────────────────────
  const paired = test.filter((d) => d.market !== null);
  const mk = (f: (d: RowData) => number): BinaryOutcome[] =>
    paired.map((d) => ({ prob: f(d), actual: d.y as 0 | 1 }));

  const nuevo = mk((d) => predictProb(d.x, model));
  const elo = mk((d) => d.eloProb);
  const mercado = mk((d) => d.market!);

  const acc = (rows: BinaryOutcome[]) =>
    rows.filter((r) => (r.prob >= 0.5 ? r.actual === 1 : r.actual === 0)).length / rows.length;

  console.log(`\n── TEST fuera de muestra: temporadas >${validSeason}, ${paired.length} partidos con cuota ──`);
  console.log('                    Elo solo    Con features    Mercado');
  console.log(`  Brier            ${fmt(brierScore(elo)).padStart(9)}    ${fmt(brierScore(nuevo)).padStart(12)}   ${fmt(brierScore(mercado)).padStart(8)}`);
  console.log(`  LogLoss          ${fmt(logLoss(elo)).padStart(9)}    ${fmt(logLoss(nuevo)).padStart(12)}   ${fmt(logLoss(mercado)).padStart(8)}`);
  console.log(`  Acierto favorito ${(acc(elo) * 100).toFixed(1).padStart(8)}%    ${(acc(nuevo) * 100).toFixed(1).padStart(11)}%   ${(acc(mercado) * 100).toFixed(1).padStart(7)}%`);

  const gapElo = brierScore(elo) - brierScore(mercado);
  const gapNew = brierScore(nuevo) - brierScore(mercado);
  const cerrado = ((gapElo - gapNew) / gapElo) * 100;
  console.log(`\n  Distancia al mercado (Brier): ${fmt(gapElo)} -> ${fmt(gapNew)}   ` +
    `(${cerrado >= 0 ? 'se cierra' : 'se ABRE'} el ${Math.abs(cerrado).toFixed(0)}% de la brecha)`);

  const metrics = {
    test_matches: paired.length,
    brier: { elo: brierScore(elo), features: brierScore(nuevo), market: brierScore(mercado) },
    logloss: { elo: logLoss(elo), features: logLoss(nuevo), market: logLoss(mercado) },
    gap_closed_pct: cerrado,
  };

  // ── Persistencia ───────────────────────────────────────────────────────────
  await client.execute({
    sql: `insert into model_fits
          (model_version, feature_names, weights, l2, train_seasons, valid_seasons, test_seasons, n_train, metrics)
          values (?,?,?,?,?,?,?,?,?)
          on conflict (model_version) do update set
            feature_names = excluded.feature_names, weights = excluded.weights, l2 = excluded.l2,
            train_seasons = excluded.train_seasons, valid_seasons = excluded.valid_seasons,
            test_seasons = excluded.test_seasons, n_train = excluded.n_train, metrics = excluded.metrics`,
    args: [
      version, JSON.stringify(FEATURE_NAMES), JSON.stringify(model.weights), best!.l2,
      `<=${trainUntil}`, String(validSeason), `>${validSeason}`, trainFull.length,
      JSON.stringify(metrics),
    ],
  });

  await client.execute({ sql: "update app_config set v = ? where k = 'model_version'", args: [version] });

  console.log(`\nGuardado el ajuste "${version}" (${trainFull.length} partidos de entrenamiento).`);
  console.log('El model_version activo de la app pasa a ser ese.');
  console.log('Ahora ejecuta `npx tsx scripts/predict.ts --all` para aplicar estos pesos.');
}

main().catch((e) => {
  console.error('Fallo al ajustar:', e);
  process.exit(1);
});
