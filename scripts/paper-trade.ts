/**
 * Paper Trading en vivo: coloca apuestas SIMULADAS sobre partidos programados y
 * liquida las que ya se han jugado.
 *
 *   npx tsx scripts/paper-trade.ts             # coloca y liquida
 *   npx tsx scripts/paper-trade.ts --settle-only
 *   npx tsx scripts/paper-trade.ts --dry-run
 *
 * NO ejecuta apuestas reales, no habla con ninguna casa, no mueve dinero. Solo
 * escribe en `paper_trades`.
 *
 * MODO AUDITORÍA (paper_trading_config.value_enabled = 0, el valor por defecto):
 * el backtest sobre 9.861 partidos fuera de muestra demostró que la "ventaja"
 * del modelo es ANTI-predictiva — cuanta más declara, más se pierde (ver
 * docs/04-backtest-paper-trading.md). Así que esto NO es una estrategia: sirve
 * para medir CLV, que es la única señal capaz de detectar ventaja real antes de
 * que el beneficio se distinga de la suerte.
 *
 * Regla no negociable: la cuota siempre viene de una casa real. Si un partido no
 * tiene cuota registrada, no se genera apuesta.
 */
import { db } from '../src/lib/db';
import { loadEnv } from './lib/env';
import { runBatch } from './lib/batch';
import { decideBet, devigTwoWay, settleProfit, clv, type StakeRules } from '@tti/model';

loadEnv();

const hasFlag = (n: string) => process.argv.includes(`--${n}`);

/** Casa de la que sale la probabilidad justa y a la que se "apuesta". */
const FAIR_BOOK_LIKE = 'consensus%';
const EXEC_BOOK = 'market_max';

async function colocar(client: ReturnType<typeof db>, dryRun: boolean) {
  const cfg = (await client.execute('select * from paper_trading_config where id = 1')).rows[0];
  if (!cfg) { console.log('Sin configuración de paper trading.'); return; }

  const rules: StakeRules = {
    kellyDivisor: Number(cfg.kelly_divisor),
    maxStakePct: Number(cfg.max_stake_pct),
    minEdge: Number(cfg.min_edge),
    minConfidence: Number(cfg.min_confidence),
  };
  const valueEnabled = Number(cfg.value_enabled) === 1;
  const version = String(
    (await client.execute("select v from app_config where k = 'model_version'")).rows[0]?.v ?? '',
  );

  // Banca disponible = inicial + resultado liquidado - lo comprometido en abiertas.
  let bankroll = Number(
    (await client.execute({
      sql: `select ? + coalesce((select sum(profit) from paper_trades where status in ('won','lost')),0)
                   - coalesce((select sum(stake) from paper_trades where status='open'),0) as b`,
      args: [Number(cfg.initial_bankroll)],
    })).rows[0].b,
  );

  console.log(`Banca disponible: ${bankroll.toFixed(2)}   ·   modo ${valueEnabled ? 'VALUE' : 'AUDITORÍA (value_enabled=0)'}`);
  if (bankroll <= 0) { console.log('Sin banca disponible: no se coloca nada.'); return; }

  // Partidos programados con pronóstico y cuota real, sin apuesta previa.
  const rows = (await client.execute({
    sql: `
      select m.id, m.played_on, mo.prob_p1, mo.confidence,
             fair1.odds as fair_p1, fair2.odds as fair_p2,
             ex1.odds as exec_p1, ex2.odds as exec_p2, ex1.bookmaker as book
      from matches m
      join model_outputs mo on mo.match_id = m.id and mo.model_version = ?
      join odds fair1 on fair1.match_id = m.id and fair1.selection='p1' and fair1.bookmaker like ?
      join odds fair2 on fair2.match_id = m.id and fair2.selection='p2' and fair2.bookmaker like ?
      join odds ex1 on ex1.match_id = m.id and ex1.selection='p1' and ex1.bookmaker = ?
      join odds ex2 on ex2.match_id = m.id and ex2.selection='p2' and ex2.bookmaker = ?
      left join paper_trades pt on pt.match_id = m.id
      where m.status = 'scheduled' and pt.id is null
      group by m.id
      order by m.played_on
    `,
    args: [version, FAIR_BOOK_LIKE, FAIR_BOOK_LIKE, EXEC_BOOK, EXEC_BOOK],
  })).rows;

  if (!rows.length) { console.log('No hay partidos programados con cuota y pronóstico pendientes.'); return; }
  console.log(`Candidatos: ${rows.length}`);

  const stmts: { sql: string; args: unknown[] }[] = [];
  let colocadas = 0;
  for (const r of rows) {
    const fair = devigTwoWay(Number(r.fair_p1), Number(r.fair_p2));
    if (!fair) continue;
    const probP1 = Number(r.prob_p1);
    const confidence = r.confidence === null ? 0 : Number(r.confidence);

    const candidatos = [
      { sel: 'p1' as const, modelProb: probP1, odds: Number(r.exec_p1), devigedProb: fair.p1 },
      { sel: 'p2' as const, modelProb: 1 - probP1, odds: Number(r.exec_p2), devigedProb: fair.p2 },
    ];
    let mejor: { sel: 'p1' | 'p2'; d: ReturnType<typeof decideBet>; odds: number; devig: number; prob: number } | null = null;
    for (const c of candidatos) {
      const d = decideBet({ ...c, confidence }, rules);
      if (d.place && (!mejor || d.edge > mejor.d.edge)) {
        mejor = { sel: c.sel, d, odds: c.odds, devig: c.devigedProb, prob: c.modelProb };
      }
    }
    if (!mejor) continue;

    const stake = Math.round(bankroll * mejor.d.stakeFraction * 100) / 100;
    if (!(stake > 0.01)) continue;

    stmts.push({
      sql: `insert or ignore into paper_trades
            (match_id, selection, bookmaker, odds_taken, implied_prob, model_prob, edge,
             confidence, stake, bankroll_before, model_version)
            values (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        Number(r.id), mejor.sel, String(r.book), mejor.odds,
        Math.round(mejor.devig * 1e4) / 1e4, Math.round(mejor.prob * 1e4) / 1e4,
        Math.round(mejor.d.edge * 1e4) / 1e4, confidence, stake,
        Math.round(bankroll * 100) / 100, version,
      ],
    });
    bankroll -= stake;
    colocadas++;
    console.log(`  ${r.played_on}  partido ${r.id}  ${mejor.sel} @ ${mejor.odds}  stake ${stake}  (${mejor.d.reason})`);
  }

  if (dryRun) { console.log(`\n--dry-run: se habrían colocado ${colocadas} apuestas.`); return; }
  await runBatch(client, stmts, 'apuestas');
  console.log(`Apuestas simuladas colocadas: ${colocadas}`);
}

async function liquidar(client: ReturnType<typeof db>, dryRun: boolean) {
  // Un partido programado se resuelve cuando la reconciliación lo ha fusionado
  // con su versión jugada de tennis-data (ver scripts/reconcile.ts).
  const rows = (await client.execute(`
    select pt.id, pt.match_id, pt.selection, pt.odds_taken, pt.stake, m.p1_won
    from paper_trades pt
    join matches m on m.id = pt.match_id
    where pt.status = 'open' and m.status = 'completed' and m.p1_won is not null
  `)).rows;

  if (!rows.length) { console.log('Nada que liquidar.'); return; }

  const stmts: { sql: string; args: unknown[] }[] = [];
  for (const r of rows) {
    const p1Won = Number(r.p1_won) === 1;
    const won = String(r.selection) === 'p1' ? p1Won : !p1Won;
    const stake = Number(r.stake);
    const oddsTaken = Number(r.odds_taken);
    const profit = settleProfit(stake, oddsTaken, won);

    // Cuota de cierre: la de tennis-data (Pinnacle) es la de cierre REAL; si
    // aún no está, se usa la última captura de The Odds API como aproximación.
    const cierre = (await client.execute({
      sql: `select odds from odds
            where match_id = ? and selection = ?
              and (bookmaker = 'pinnacle' or source = 'the-odds-api')
            order by case when bookmaker = 'pinnacle' then 0 else 1 end, captured_at desc
            limit 1`,
      args: [Number(r.match_id), String(r.selection)],
    })).rows[0];
    const closing = cierre ? Number(cierre.odds) : null;
    const valorCierre = closing !== null ? clv(oddsTaken, closing) : null;

    stmts.push({
      sql: `update paper_trades set status = ?, profit = ?, closing_odds = ?, clv = ?,
            settled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = ?`,
      args: [
        won ? 'won' : 'lost', Math.round(profit * 100) / 100, closing,
        valorCierre === null ? null : Math.round(valorCierre * 1e4) / 1e4, Number(r.id),
      ],
    });
  }

  if (dryRun) { console.log(`--dry-run: se habrían liquidado ${stmts.length} apuestas.`); return; }
  await runBatch(client, stmts, 'liquidaciones');
  console.log(`Apuestas liquidadas: ${stmts.length}`);
}

async function resumen(client: ReturnType<typeof db>) {
  const r = (await client.execute(`
    select count(*) n,
           sum(case when status='open' then 1 else 0 end) abiertas,
           sum(case when status='won' then 1 else 0 end) ganadas,
           sum(case when status='lost' then 1 else 0 end) perdidas,
           round(sum(coalesce(profit,0)),2) beneficio,
           round(sum(case when status in ('won','lost') then stake else 0 end),2) arriesgado,
           round(avg(clv),4) clv_medio,
           sum(case when clv > 0 then 1 else 0 end) clv_positivo,
           sum(case when clv is not null then 1 else 0 end) clv_medidos
    from paper_trades
  `)).rows[0];
  if (!Number(r.n)) { console.log('\nSin apuestas registradas todavía.'); return; }

  console.log('\n── Estado del Paper Trading ──');
  console.log(`  apuestas ${r.n} (abiertas ${r.abiertas}, ganadas ${r.ganadas}, perdidas ${r.perdidas})`);
  const arr = Number(r.arriesgado) || 0;
  console.log(`  beneficio ${r.beneficio} sobre ${arr} arriesgado` +
    (arr > 0 ? `  (ROI ${((Number(r.beneficio) / arr) * 100).toFixed(2)}%)` : ''));
  if (Number(r.clv_medidos) > 0) {
    console.log(`  CLV medio ${r.clv_medio}  ·  positivo en ${r.clv_positivo}/${r.clv_medidos}`);
    console.log('  El CLV es la métrica que vale: detecta ventaja real mucho antes que el beneficio.');
  }
}

async function main() {
  const client = db();
  const dryRun = hasFlag('dry-run');
  if (!hasFlag('settle-only')) await colocar(client, dryRun);
  await liquidar(client, dryRun);
  await resumen(client);
}

main().catch((e) => {
  console.error('Fallo en el paper trading:', e);
  process.exit(1);
});
