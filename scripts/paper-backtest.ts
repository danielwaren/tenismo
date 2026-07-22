/**
 * Backtest del simulador de Paper Trading sobre cuotas REALES históricas.
 *
 *   npx tsx scripts/paper-backtest.ts
 *   npx tsx scripts/paper-backtest.ts --book market_max --min-edge 0.04
 *
 * Responde a la única pregunta que importa antes de encender nada: apostando
 * como diría el modelo, a precios que existieron de verdad, ¿se habría ganado?
 *
 * METODOLOGÍA
 *   · Probabilidad JUSTA del mercado: se devigan las cuotas de cierre de
 *     Pinnacle, que es el libro afilado de referencia.
 *   · Precio de EJECUCIÓN: configurable (`--book`). Lo realista no es apostar
 *     contra Pinnacle sino al mejor precio disponible (`market_max`), que
 *     también es una cuota real registrada por la fuente.
 *   · Ambas son cuotas de casas reales. En ningún punto se deriva una cuota de
 *     la probabilidad del modelo.
 *
 * LÍMITE HONESTO DE ESTE BACKTEST: se apuesta a la cuota de CIERRE, así que por
 * construcción el CLV es cero y no se mide. Lo que mide es si el modelo bate al
 * precio final, que es la prueba más dura. El CLV real solo puede medirse hacia
 * adelante, capturando cuotas antes del cierre (eso lo hace odds-ingest).
 */
import { db } from '../src/lib/db';
import { loadEnv } from './lib/env';
import { decideBet, devigTwoWay, settleProfit, type StakeRules } from '@tti/model';

loadEnv();

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Libro afilado del que se toma la probabilidad justa. */
const FAIR_BOOK = 'pinnacle';

async function main() {
  const client = db();
  const execBook = arg('book', 'market_max');
  const fromSeason = Number(arg('from-season', '2024'));

  const cfg = (await client.execute('select * from paper_trading_config where id = 1')).rows[0];
  const rules: StakeRules = {
    kellyDivisor: Number(arg('kelly-divisor', String(cfg?.kelly_divisor ?? 4))),
    maxStakePct: Number(arg('max-stake-pct', String(cfg?.max_stake_pct ?? 0.02))),
    minEdge: Number(arg('min-edge', String(cfg?.min_edge ?? 0.02))),
    minConfidence: Number(arg('min-confidence', String(cfg?.min_confidence ?? 0.5))),
  };
  const initialBankroll = Number(arg('bankroll', String(cfg?.initial_bankroll ?? 100)));
  const version = String(
    (await client.execute("select v from app_config where k = 'model_version'")).rows[0]?.v ?? '',
  );

  const rows = (await client.execute({
    sql: `
      select m.id, m.played_on, m.p1_won, m.season, t.code as tour, m.surface,
             mo.prob_p1, mo.confidence,
             fair1.odds as fair_p1, fair2.odds as fair_p2,
             ex1.odds  as exec_p1,  ex2.odds  as exec_p2
      from matches m
      join tours t on t.id = m.tour_id
      join model_outputs mo on mo.match_id = m.id and mo.model_version = ?
      join odds fair1 on fair1.match_id = m.id and fair1.selection = 'p1' and fair1.bookmaker = ?
      join odds fair2 on fair2.match_id = m.id and fair2.selection = 'p2' and fair2.bookmaker = ?
      join odds ex1   on ex1.match_id   = m.id and ex1.selection   = 'p1' and ex1.bookmaker   = ?
      join odds ex2   on ex2.match_id   = m.id and ex2.selection   = 'p2' and ex2.bookmaker   = ?
      where m.status = 'completed' and m.p1_won is not null and m.season >= ?
      order by m.played_on, m.id
    `,
    args: [version, FAIR_BOOK, FAIR_BOOK, execBook, execBook, fromSeason],
  })).rows;

  if (!rows.length) {
    console.log('Sin partidos evaluables. ¿Se ejecutaron db:elo, fit-model y predict?');
    return;
  }

  console.log(`Modelo ${version}   ·   probabilidad justa: ${FAIR_BOOK}   ·   ejecución: ${execBook}`);
  console.log(`Reglas: ventaja mín ${(rules.minEdge * 100).toFixed(1)}%, confianza mín ${rules.minConfidence}, ` +
    `Kelly/${rules.kellyDivisor}, tope ${(rules.maxStakePct * 100).toFixed(1)}% de banca`);
  console.log(`Partidos candidatos (${fromSeason}+, con cuota real): ${rows.length}\n`);

  let bankroll = initialBankroll;
  let peak = bankroll;
  let maxDrawdown = 0;
  let staked = 0;
  let bets = 0;
  let wins = 0;
  let sumEdge = 0;
  const rechazos = new Map<string, number>();
  const porTour = new Map<string, { bets: number; profit: number; staked: number }>();
  const porSuperficie = new Map<string, { bets: number; profit: number; staked: number }>();

  for (const r of rows) {
    const fair = devigTwoWay(Number(r.fair_p1), Number(r.fair_p2));
    if (!fair) continue;

    const probP1 = Number(r.prob_p1);
    const confidence = r.confidence === null ? 0 : Number(r.confidence);
    const p1Won = Number(r.p1_won) === 1;

    // Se evalúan las dos patas y se elige la de MAYOR ventaja; en un mercado
    // binario solo una de las dos puede tenerla.
    const candidatos = [
      { sel: 'p1' as const, modelProb: probP1, odds: Number(r.exec_p1), devigedProb: fair.p1 },
      { sel: 'p2' as const, modelProb: 1 - probP1, odds: Number(r.exec_p2), devigedProb: fair.p2 },
    ];
    let elegido: { sel: 'p1' | 'p2'; d: ReturnType<typeof decideBet>; odds: number } | null = null;
    let mejorRechazo = '';
    for (const c of candidatos) {
      const d = decideBet({ ...c, confidence }, rules);
      if (d.place && (!elegido || d.edge > elegido.d.edge)) elegido = { sel: c.sel, d, odds: c.odds };
      if (!d.place && !mejorRechazo) mejorRechazo = d.reason.replace(/[\d.,]+%?/g, 'N');
    }

    if (!elegido) {
      rechazos.set(mejorRechazo, (rechazos.get(mejorRechazo) ?? 0) + 1);
      continue;
    }

    const stake = bankroll * elegido.d.stakeFraction;
    if (!(stake > 0.01)) continue;

    const won = elegido.sel === 'p1' ? p1Won : !p1Won;
    const profit = settleProfit(stake, elegido.odds, won);

    bankroll += profit;
    staked += stake;
    bets++;
    if (won) wins++;
    sumEdge += elegido.d.edge;

    peak = Math.max(peak, bankroll);
    maxDrawdown = Math.max(maxDrawdown, (peak - bankroll) / peak);

    for (const [map, key] of [
      [porTour, String(r.tour)],
      [porSuperficie, String(r.surface ?? 'desconocida')],
    ] as const) {
      const e = map.get(key) ?? { bets: 0, profit: 0, staked: 0 };
      e.bets++; e.profit += profit; e.staked += stake;
      map.set(key, e);
    }
    if (bankroll <= 0) { console.log('\n  ! Banca agotada: se detiene el backtest.'); break; }
  }

  const profit = bankroll - initialBankroll;
  const roi = staked > 0 ? (profit / staked) * 100 : 0;
  const pct = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`;

  console.log('── RESULTADO ─────────────────────────────────────────');
  console.log(`  Apuestas simuladas   ${bets} de ${rows.length} partidos (${((bets / rows.length) * 100).toFixed(1)}%)`);
  if (!bets) {
    console.log('  Ninguna apuesta pasó los filtros.');
  } else {
    console.log(`  Aciertos             ${wins} (${((wins / bets) * 100).toFixed(1)}%)`);
    console.log(`  Ventaja media decl.  ${(sumEdge / bets * 100).toFixed(2)}%`);
    console.log(`  Total arriesgado     ${staked.toFixed(2)}`);
    console.log(`  Banca                ${initialBankroll.toFixed(2)} -> ${bankroll.toFixed(2)}  (${pct((profit / initialBankroll) * 100)})`);
    console.log(`  ROI sobre lo apostado ${pct(roi)}`);
    console.log(`  Peor caída (drawdown) ${(maxDrawdown * 100).toFixed(1)}%`);
  }

  if (bets) {
    console.log('\n  Por circuito:');
    for (const [k, v] of [...porTour.entries()].sort()) {
      console.log(`    ${k.padEnd(5)} ${String(v.bets).padStart(5)} apuestas   ROI ${pct((v.profit / v.staked) * 100)}`);
    }
    console.log('  Por superficie:');
    for (const [k, v] of [...porSuperficie.entries()].sort()) {
      console.log(`    ${k.padEnd(12)} ${String(v.bets).padStart(5)} apuestas   ROI ${pct((v.profit / v.staked) * 100)}`);
    }
  }

  console.log('\n  Motivos de descarte más frecuentes:');
  for (const [motivo, n] of [...rechazos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log(`    ${String(n).padStart(6)}  ${motivo}`);
  }

  console.log(
    '\nLectura: se apuesta a la cuota de CIERRE, así que esto mide si el modelo bate\n' +
      'al precio final del mercado — la prueba más dura. Un ROI negativo aquí NO es un\n' +
      'fallo del simulador: es el modelo diciendo que todavía no tiene ventaja.',
  );
}

main().catch((e) => {
  console.error('Fallo en el backtest:', e);
  process.exit(1);
});
