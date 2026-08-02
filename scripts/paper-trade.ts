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
import { getMarkovInputs } from '../src/lib/queries';
import { decideBet, devigTwoWay, settleProfit, clv, simulateMatch, type StakeRules } from '@tti/model';

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

  const stmts: { sql: string; args: unknown[] }[] = [];
  let colocadas = 0;

  const colocarUna = (
    matchId: number, playedOn: string, market: 'ML' | 'TOTAL_GAMES' | 'GAMES_HCP',
    line: number | null, candidatos: { sel: 'p1' | 'p2' | 'over' | 'under'; modelProb: number; odds: number; devigedProb: number; book: string }[],
    confidence: number,
  ): void => {
    let mejor: (typeof candidatos)[number] & { d: ReturnType<typeof decideBet> } | null = null;
    for (const c of candidatos) {
      const d = decideBet({ ...c, confidence }, rules);
      if (d.place && (!mejor || d.edge > mejor.d.edge)) mejor = { ...c, d };
    }
    if (!mejor) return;
    const stake = Math.round(bankroll * mejor.d.stakeFraction * 100) / 100;
    if (!(stake > 0.01)) return;

    stmts.push({
      sql: `insert or ignore into paper_trades
            (match_id, market, selection, line, bookmaker, odds_taken, implied_prob, model_prob, edge,
             confidence, stake, bankroll_before, model_version)
            values (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        matchId, market, mejor.sel, line, mejor.book, mejor.odds,
        Math.round(mejor.devigedProb * 1e4) / 1e4, Math.round(mejor.modelProb * 1e4) / 1e4,
        Math.round(mejor.d.edge * 1e4) / 1e4, confidence, stake, Math.round(bankroll * 100) / 100, version,
      ],
    });
    bankroll -= stake;
    colocadas++;
    console.log(`  ${playedOn}  partido ${matchId}  ${market}${line !== null ? ` (${line})` : ''}  ${mejor.sel} @ ${mejor.odds}  stake ${stake}  (${mejor.d.reason})`);
  };

  // ── Ganador (ML) ────────────────────────────────────────────────────────────
  const rowsMl = (await client.execute({
    sql: `
      select m.id, m.played_on, mo.prob_p1, mo.confidence,
             fair1.odds as fair_p1, fair2.odds as fair_p2,
             ex1.odds as exec_p1, ex2.odds as exec_p2, ex1.bookmaker as book
      from matches m
      join model_outputs mo on mo.match_id = m.id and mo.model_version = ?
      join odds fair1 on fair1.match_id = m.id and fair1.selection='p1' and fair1.bookmaker like ? and fair1.market='match_winner'
      join odds fair2 on fair2.match_id = m.id and fair2.selection='p2' and fair2.bookmaker like ? and fair2.market='match_winner'
      join odds ex1 on ex1.match_id = m.id and ex1.selection='p1' and ex1.bookmaker = ? and ex1.market='match_winner'
      join odds ex2 on ex2.match_id = m.id and ex2.selection='p2' and ex2.bookmaker = ? and ex2.market='match_winner'
      left join paper_trades pt on pt.match_id = m.id and pt.market = 'ML'
      where m.status = 'scheduled' and pt.id is null
      group by m.id
      order by m.played_on
    `,
    args: [version, FAIR_BOOK_LIKE, FAIR_BOOK_LIKE, EXEC_BOOK, EXEC_BOOK],
  })).rows;
  console.log(`Candidatos Ganador: ${rowsMl.length}`);
  for (const r of rowsMl) {
    const fair = devigTwoWay(Number(r.fair_p1), Number(r.fair_p2));
    if (!fair) continue;
    const probP1 = Number(r.prob_p1);
    const confidence = r.confidence === null ? 0 : Number(r.confidence);
    colocarUna(Number(r.id), String(r.played_on), 'ML', null, [
      { sel: 'p1', modelProb: probP1, odds: Number(r.exec_p1), devigedProb: fair.p1, book: String(r.book) },
      { sel: 'p2', modelProb: 1 - probP1, odds: Number(r.exec_p2), devigedProb: fair.p2, book: String(r.book) },
    ], confidence);
  }

  // ── Total de Juegos y Hándicap de Juegos ────────────────────────────────────
  // Estos dos usan el motor punto a punto (packages/model/src/markov.ts), no el
  // modelo logístico oficial: el logístico solo predice quién gana, no tiene
  // ninguna noción de "cuántos juegos". El motor Markov es la única fuente que
  // da una distribución de juegos, así que es la única posible aquí — normal
  // que su P(gana el partido) implícita no coincida exactamente con la del
  // modelo oficial, que combina 14 señales y no solo saque/resto.
  const rowsJuegos = (await client.execute({
    sql: `
      select m.id, m.played_on, m.best_of, mo.confidence,
             tf1.odds fair_over, tf2.odds fair_under, tf1.line t_line,
             tx1.odds ex_over, tx2.odds ex_under, tx1.bookmaker t_book,
             hf1.odds fair_p1_h, hf2.odds fair_p2_h, hf1.line h_line,
             hx1.odds ex_p1_h, hx2.odds ex_p2_h, hx1.bookmaker h_book,
             ptt.id ptt_id, pth.id pth_id
      from matches m
      join model_outputs mo on mo.match_id = m.id and mo.model_version = ?
      left join odds tf1 on tf1.match_id=m.id and tf1.market='total_games' and tf1.selection='over'  and tf1.bookmaker like ?
      left join odds tf2 on tf2.match_id=m.id and tf2.market='total_games' and tf2.selection='under' and tf2.bookmaker like ? and tf2.line=tf1.line
      left join odds tx1 on tx1.match_id=m.id and tx1.market='total_games' and tx1.selection='over'  and tx1.bookmaker=? and tx1.line=tf1.line
      left join odds tx2 on tx2.match_id=m.id and tx2.market='total_games' and tx2.selection='under' and tx2.bookmaker=? and tx2.line=tf1.line
      left join odds hf1 on hf1.match_id=m.id and hf1.market='games_hcp' and hf1.selection='p1' and hf1.bookmaker like ?
      left join odds hf2 on hf2.match_id=m.id and hf2.market='games_hcp' and hf2.selection='p2' and hf2.bookmaker like ? and hf2.line=-hf1.line
      left join odds hx1 on hx1.match_id=m.id and hx1.market='games_hcp' and hx1.selection='p1' and hx1.bookmaker=? and hx1.line=hf1.line
      left join odds hx2 on hx2.match_id=m.id and hx2.market='games_hcp' and hx2.selection='p2' and hx2.bookmaker=? and hx2.line=-hf1.line
      left join paper_trades ptt on ptt.match_id = m.id and ptt.market = 'TOTAL_GAMES'
      left join paper_trades pth on pth.match_id = m.id and pth.market = 'GAMES_HCP'
      where m.status = 'scheduled' and (tf1.id is not null or hf1.id is not null)
        and (ptt.id is null or pth.id is null)
      group by m.id
      order by m.played_on
    `,
    args: [version, FAIR_BOOK_LIKE, FAIR_BOOK_LIKE, EXEC_BOOK, EXEC_BOOK, FAIR_BOOK_LIKE, FAIR_BOOK_LIKE, EXEC_BOOK, EXEC_BOOK],
  })).rows;
  console.log(`Candidatos Juegos (total/hándicap): ${rowsJuegos.length}`);

  const markovByMatch = await getMarkovInputs(rowsJuegos.map((r) => Number(r.id)));
  for (const r of rowsJuegos) {
    const matchId = Number(r.id);
    const mi = markovByMatch.get(matchId);
    if (!mi) continue; // sin match_stats de ninguno de los dos: no hay con qué proyectar
    const confidence = r.confidence === null ? 0 : Number(r.confidence);
    const bestOf = mi.bestOf ?? (Number(r.best_of) || null);
    const sim = simulateMatch(mi.pa, mi.pb, bestOf);

    if (r.ptt_id === null && r.t_line !== null && r.fair_over !== null) {
      const fair = devigTwoWay(Number(r.fair_over), Number(r.fair_under));
      if (fair) {
        const line = Number(r.t_line);
        const pOver = sim.probOver(line);
        colocarUna(matchId, String(r.played_on), 'TOTAL_GAMES', line, [
          { sel: 'over', modelProb: pOver, odds: Number(r.ex_over), devigedProb: fair.p1, book: String(r.t_book) },
          { sel: 'under', modelProb: 1 - pOver, odds: Number(r.ex_under), devigedProb: fair.p2, book: String(r.t_book) },
        ], confidence);
      }
    }
    if (r.pth_id === null && r.h_line !== null && r.fair_p1_h !== null) {
      const fair = devigTwoWay(Number(r.fair_p1_h), Number(r.fair_p2_h));
      if (fair) {
        const line = Number(r.h_line); // orientada a p1: positivo = p1 recibe juegos
        // La apuesta "p1 + line" gana si el margen final de p1 supera -line.
        const pP1 = sim.probMarginOver(-line);
        colocarUna(matchId, String(r.played_on), 'GAMES_HCP', line, [
          { sel: 'p1', modelProb: pP1, odds: Number(r.ex_p1_h), devigedProb: fair.p1, book: String(r.h_book) },
          { sel: 'p2', modelProb: 1 - pP1, odds: Number(r.ex_p2_h), devigedProb: fair.p2, book: String(r.h_book) },
        ], confidence);
      }
    }
  }

  if (dryRun) { console.log(`\n--dry-run: se habrían colocado ${colocadas} apuestas.`); return; }
  await runBatch(client, stmts, 'apuestas');
  console.log(`Apuestas simuladas colocadas: ${colocadas}`);
}

/** Marcador set por set, de perspectiva ganador (como se guarda) a p1/p2. Ver el mismo cálculo en getMatchDetail (src/lib/queries.ts). */
function gamesPorLado(setsJson: string | null, p1Won: number | null): { gamesP1: number; gamesP2: number } | null {
  if (!setsJson || p1Won === null) return null;
  try {
    const raw = JSON.parse(setsJson) as [number, number][];
    const p1IsWinner = p1Won === 1;
    let gamesP1 = 0, gamesP2 = 0;
    for (const [wg, lg] of raw) { gamesP1 += p1IsWinner ? wg : lg; gamesP2 += p1IsWinner ? lg : wg; }
    return { gamesP1, gamesP2 };
  } catch {
    return null;
  }
}

async function liquidar(client: ReturnType<typeof db>, dryRun: boolean) {
  // Un partido programado se resuelve cuando la reconciliación lo ha fusionado
  // con su versión jugada de tennis-data (ver scripts/reconcile.ts).
  const rows = (await client.execute(`
    select pt.id, pt.match_id, pt.market, pt.selection, pt.line, pt.odds_taken, pt.stake,
           m.p1_won, m.sets_json, m.status match_status
    from paper_trades pt
    join matches m on m.id = pt.match_id
    where pt.status = 'open' and m.status = 'completed' and m.p1_won is not null
  `)).rows;

  if (!rows.length) { console.log('Nada que liquidar.'); return; }

  const stmts: { sql: string; args: unknown[] }[] = [];
  let voids = 0;
  for (const r of rows) {
    const market = String(r.market);
    const selection = String(r.selection);
    const stake = Number(r.stake);
    const oddsTaken = Number(r.odds_taken);
    const p1Won = r.p1_won === null ? null : Number(r.p1_won);

    // `won === null` señala un PUSH (empate exacto en la línea): se anula la
    // apuesta y se devuelve el stake, no se cuenta como ganada ni perdida. Solo
    // puede pasar con líneas enteras (una línea .5 nunca empata con un total
    // de juegos, que siempre es entero).
    let won: boolean | null;
    if (market === 'ML') {
      won = selection === 'p1' ? p1Won === 1 : p1Won === 0;
    } else {
      const g = gamesPorLado(r.sets_json as string | null, p1Won);
      if (!g) { won = false; } // sin marcador legible: no se puede liquidar a favor, se cuenta perdida por seguridad
      else if (market === 'TOTAL_GAMES') {
        const total = g.gamesP1 + g.gamesP2;
        const line = Number(r.line);
        won = total === line ? null : (selection === 'over' ? total > line : total < line);
      } else { // GAMES_HCP — `line` ya viene orientada a esta selección (p1 o p2).
        const margenPropio = selection === 'p1' ? g.gamesP1 - g.gamesP2 : g.gamesP2 - g.gamesP1;
        const linea = Number(r.line);
        won = margenPropio + linea === 0 ? null : margenPropio + linea > 0;
      }
    }

    let profit: number;
    let status: 'won' | 'lost' | 'void';
    if (won === null) { profit = 0; status = 'void'; voids++; }
    else { profit = settleProfit(stake, oddsTaken, won); status = won ? 'won' : 'lost'; }

    // Cuota de cierre: la de tennis-data (Pinnacle) es la de cierre REAL para
    // ML; para TOTAL_GAMES/GAMES_HCP tennis-data no tiene esos mercados, así
    // que el CLV solo se mide contra la última captura de The Odds API.
    const cierre = (await client.execute({
      sql: `select odds from odds
            where match_id = ? and market = ? and selection = ? and (line is ? or ? is null)
              and (bookmaker = 'pinnacle' or source = 'the-odds-api')
            order by case when bookmaker = 'pinnacle' then 0 else 1 end, captured_at desc
            limit 1`,
      args: [
        Number(r.match_id), market === 'ML' ? 'match_winner' : market === 'TOTAL_GAMES' ? 'total_games' : 'games_hcp',
        selection, r.line, r.line,
      ],
    })).rows[0];
    const closing = cierre ? Number(cierre.odds) : null;
    const valorCierre = closing !== null && status !== 'void' ? clv(oddsTaken, closing) : null;

    stmts.push({
      sql: `update paper_trades set status = ?, profit = ?, closing_odds = ?, clv = ?,
            settled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = ?`,
      args: [
        status, Math.round(profit * 100) / 100, closing,
        valorCierre === null ? null : Math.round(valorCierre * 1e4) / 1e4, Number(r.id),
      ],
    });
  }

  if (dryRun) { console.log(`--dry-run: se habrían liquidado ${stmts.length} apuestas (${voids} push).`); return; }
  await runBatch(client, stmts, 'liquidaciones');
  console.log(`Apuestas liquidadas: ${stmts.length}${voids ? ` (${voids} push)` : ''}`);
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

  const porMercado = (await client.execute(`
    select market, count(*) n,
           sum(case when status='open' then 1 else 0 end) abiertas,
           sum(case when status='won' then 1 else 0 end) ganadas,
           sum(case when status='lost' then 1 else 0 end) perdidas,
           sum(case when status='void' then 1 else 0 end) push,
           round(sum(coalesce(profit,0)),2) beneficio,
           round(avg(clv),4) clv_medio
    from paper_trades group by market order by market
  `)).rows;
  if (porMercado.length > 1) {
    console.log('\n  Por mercado:');
    for (const m of porMercado) {
      console.log(
        `    ${String(m.market).padEnd(11)} ${String(m.n).padStart(4)} apuestas` +
          `  (${m.ganadas}G/${m.perdidas}P/${m.push}push, ${m.abiertas} abiertas)` +
          `  beneficio ${m.beneficio}` + (m.clv_medio !== null ? `  CLV ${m.clv_medio}` : ''),
      );
    }
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
