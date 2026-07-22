/**
 * Evalúa el modelo contra el MERCADO sobre los partidos ya jugados.
 *
 *   npx tsx scripts/evaluate.ts
 *   npx tsx scripts/evaluate.ts --book pinnacle --min-confidence 0.8
 *
 * Las predicciones que lee (`model_outputs`) las escribió train-elo con los
 * ratings PREVIOS a cada partido, así que esto es un backtest walk-forward, no
 * un ajuste sobre datos ya vistos.
 *
 * La referencia honesta NO es "acertar mucho": es el Brier de la cuota de cierre
 * devigada. El mercado de tenis está muy afinado; un modelo que no se le acerque
 * no tiene ningún value que ofrecer, y así hay que reportarlo.
 */
import { db } from '../src/lib/db';
import { loadEnv } from './lib/env';
import {
  brierScore, logLoss, brierSkillScore, reliabilityBins, devigTwoWay,
  type BinaryOutcome,
} from '@tti/model';

loadEnv();

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const fmt = (x: number, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : '—');

function report(label: string, model: BinaryOutcome[], market: BinaryOutcome[] | null) {
  console.log(`\n── ${label} (${model.length} partidos) ─────────────────────`);
  if (!model.length) { console.log('  sin datos'); return; }
  console.log(`  Brier    modelo ${fmt(brierScore(model))}` + (market ? `   mercado ${fmt(brierScore(market))}` : ''));
  console.log(`  LogLoss  modelo ${fmt(logLoss(model))}` + (market ? `   mercado ${fmt(logLoss(market))}` : ''));
  console.log(`  Skill vs tasa base: modelo ${fmt(brierSkillScore(model))}` +
    (market ? `   mercado ${fmt(brierSkillScore(market))}` : ''));
  const acc = model.filter((r) => (r.prob >= 0.5 ? r.actual === 1 : r.actual === 0)).length / model.length;
  console.log(`  Acierto del favorito del modelo: ${(acc * 100).toFixed(1)}%`);
  if (market) {
    const accM = market.filter((r) => (r.prob >= 0.5 ? r.actual === 1 : r.actual === 0)).length / market.length;
    console.log(`  Acierto del favorito del mercado: ${(accM * 100).toFixed(1)}%`);
  }
}

async function main() {
  const client = db();
  const book = arg('book', 'pinnacle');
  const minConf = Number(arg('min-confidence', '0'));

  // Una fila por partido resuelto con predicción; las cuotas de la casa elegida
  // se pivotan a columnas para poder devigar el mercado de dos vías.
  const rows = (await client.execute({
    sql: `
      select m.id, m.p1_won, m.surface, m.season, t.code as tour, mo.prob_p1, mo.confidence,
             o1.odds as odds_p1, o2.odds as odds_p2
      from matches m
      join tours t on t.id = m.tour_id
      join model_outputs mo on mo.match_id = m.id
      left join odds o1 on o1.match_id = m.id and o1.selection = 'p1' and o1.bookmaker = ?
      left join odds o2 on o2.match_id = m.id and o2.selection = 'p2' and o2.bookmaker = ?
      where m.status = 'completed' and m.p1_won is not null and mo.confidence >= ?
    `,
    args: [book, book, minConf],
  })).rows;

  if (!rows.length) {
    console.log('No hay partidos evaluables. ¿Se ejecutó `npm run db:elo`?');
    return;
  }

  const model: BinaryOutcome[] = [];
  const market: BinaryOutcome[] = [];
  const pairedModel: BinaryOutcome[] = [];   // solo donde TAMBIÉN hay mercado
  const bySurface = new Map<string, { m: BinaryOutcome[]; k: BinaryOutcome[] }>();
  const byTour = new Map<string, { m: BinaryOutcome[]; k: BinaryOutcome[] }>();
  const bySeason = new Map<number, { m: BinaryOutcome[]; k: BinaryOutcome[] }>();
  let disagree = 0;

  for (const r of rows) {
    const actual = (Number(r.p1_won) === 1 ? 1 : 0) as 0 | 1;
    const mRow: BinaryOutcome = { prob: Number(r.prob_p1), actual };
    model.push(mRow);

    const o1 = r.odds_p1 === null ? null : Number(r.odds_p1);
    const o2 = r.odds_p2 === null ? null : Number(r.odds_p2);
    const dev = o1 && o2 ? devigTwoWay(o1, o2) : null;
    let kRow: BinaryOutcome | null = null;
    if (dev) {
      kRow = { prob: dev.p1, actual };
      market.push(kRow);
      pairedModel.push(mRow);
      if ((mRow.prob >= 0.5) !== (kRow.prob >= 0.5)) disagree++;
    }

    const push = (map: Map<any, { m: BinaryOutcome[]; k: BinaryOutcome[] }>, key: any) => {
      if (!map.has(key)) map.set(key, { m: [], k: [] });
      map.get(key)!.m.push(mRow);
      if (kRow) map.get(key)!.k.push(kRow);
    };
    push(bySurface, r.surface ?? 'desconocida');
    push(byTour, r.tour);
    push(bySeason, Number(r.season));
  }

  console.log(`Casa de referencia: ${book}${minConf > 0 ? `   ·   confianza mínima ${minConf}` : ''}`);
  console.log(`Partidos con predicción: ${model.length}   ·   con cuota de cierre: ${market.length}`);

  report('GLOBAL — modelo vs mercado (mismos partidos)', pairedModel, market);

  for (const [tour, v] of [...byTour.entries()].sort()) report(`Circuito ${tour}`, v.m, v.k.length ? v.k : null);
  for (const [surf, v] of [...bySurface.entries()].sort()) report(`Superficie ${surf}`, v.m, v.k.length ? v.k : null);

  console.log('\n── Por temporada ──────────────────────────────────────');
  console.log('  año     n      Brier modelo   Brier mercado');
  for (const [season, v] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(
      `  ${season}  ${String(v.m.length).padStart(5)}   ${fmt(brierScore(v.m)).padStart(11)}   ${fmt(brierScore(v.k)).padStart(13)}`,
    );
  }

  console.log('\n── Fiabilidad del modelo (partidos con cuota) ─────────');
  console.log('  rango       n      predicho   observado   desvío');
  for (const b of reliabilityBins(pairedModel, 10)) {
    if (!b.count) continue;
    const dev = b.observed - b.meanPredicted;
    console.log(
      `  ${b.from.toFixed(1)}-${b.to.toFixed(1)}  ${String(b.count).padStart(5)}   ` +
        `${b.meanPredicted.toFixed(3).padStart(8)}   ${b.observed.toFixed(3).padStart(9)}   ${(dev >= 0 ? '+' : '') + dev.toFixed(3)}`,
    );
  }

  console.log(
    `\nModelo y mercado eligen favorito distinto en ${disagree} de ${market.length} partidos ` +
      `(${((disagree / Math.max(1, market.length)) * 100).toFixed(1)}%).`,
  );
  console.log(
    '\nLectura: si el Brier del modelo no se acerca al del mercado, cualquier "edge" que\n' +
      'calcule es ruido, no value. Ese es el criterio para activar o no el Paper Trading.',
  );
}

main().catch((e) => {
  console.error('Fallo al evaluar:', e);
  process.exit(1);
});
