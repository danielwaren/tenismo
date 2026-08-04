import { db } from './db';
import {
  computeBankrollTotals, resolveSettlement, canPlaceStake, canSettle, round2,
  type BetStatus, type BankrollTxType, type SettleInput,
} from '@tti/model';

/**
 * "Mis apuestas": repositorio de banca/apuestas/transacciones. Registro
 * MANUAL de apuestas reales (dinero fuera de esta app) — distinto del Paper
 * Trading (src/lib/queries.ts getPaperTrades), que simula lo que el modelo
 * habría apostado con dinero ficticio.
 *
 * REGLA: la banca nunca se lee de un campo editable. Toda cifra de caja sale
 * de sumar `bankroll_transactions` (ver computeBankrollTotals en
 * @tti/model/betting.ts) — así "cuánto tengo" no depende de la memoria de
 * una conversación ni de lo que muestre la casa de apuestas.
 *
 * No hay tabla de usuarios en este proyecto (ver src/lib/db.ts: sin RLS, un
 * solo operador), así que no hay user_id ni verificación de propiedad — si el
 * proyecto gana autenticación multiusuario, este módulo es el que hay que
 * revisar primero.
 */

export interface Bankroll {
  id: number;
  name: string;
  currency: string;
  initialBalance: number;
  createdAt: string;
  updatedAt: string;
}

export interface BankrollSummary extends Bankroll {
  currentBalance: number;
  availableBalance: number;
  openExposure: number;
  netProfit: number;
  totalStakedSettled: number;
  roi: number | null;
  yieldPct: number | null;
  countOpen: number;
  countWon: number;
  countLost: number;
  countVoid: number;
  countCashout: number;
  /** Beneficio de HOY (apuestas liquidadas hoy, zona horaria del servidor en UTC). */
  profitToday: number;
}

export interface BetRecord {
  id: number;
  bankrollId: number;
  tournament: string;
  tour: string;
  surface: string | null;
  playerOne: string;
  playerTwo: string;
  eventName: string | null;
  market: string;
  selection: string;
  line: number | null;
  scope: string;
  oddsDecimal: number;
  stake: number;
  status: BetStatus;
  placedAt: string;
  settledAt: string | null;
  payout: number | null;
  profit: number | null;
  cashoutAmount: number | null;
  bookmaker: string | null;
  isLive: boolean;
  liveScoreAtEntry: string | null;
  serverAtEntry: string | null;
  modelProbability: number | null;
  modelFairOdds: number | null;
  aiProbability: number | null;
  aiFairOdds: number | null;
  impliedProbability: number;
  edge: number | null;
  expectedValue: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BankrollTransactionRecord {
  id: number;
  bankrollId: number;
  betId: number | null;
  type: BankrollTxType;
  amount: number;
  description: string | null;
  createdAt: string;
}

function mapBet(r: Record<string, unknown>): BetRecord {
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    id: Number(r.id),
    bankrollId: Number(r.bankroll_id),
    tournament: String(r.tournament),
    tour: String(r.tour),
    surface: (r.surface as string | null) ?? null,
    playerOne: String(r.player_one),
    playerTwo: String(r.player_two),
    eventName: (r.event_name as string | null) ?? null,
    market: String(r.market),
    selection: String(r.selection),
    line: num(r.line),
    scope: String(r.scope),
    oddsDecimal: Number(r.odds_decimal),
    stake: Number(r.stake),
    status: String(r.status) as BetStatus,
    placedAt: String(r.placed_at),
    settledAt: (r.settled_at as string | null) ?? null,
    payout: num(r.payout),
    profit: num(r.profit),
    cashoutAmount: num(r.cashout_amount),
    bookmaker: (r.bookmaker as string | null) ?? null,
    isLive: Number(r.is_live) === 1,
    liveScoreAtEntry: (r.live_score_at_entry as string | null) ?? null,
    serverAtEntry: (r.server_at_entry as string | null) ?? null,
    modelProbability: num(r.model_probability),
    modelFairOdds: num(r.model_fair_odds),
    aiProbability: num(r.ai_probability),
    aiFairOdds: num(r.ai_fair_odds),
    impliedProbability: Number(r.implied_probability),
    edge: num(r.edge),
    expectedValue: num(r.expected_value),
    notes: (r.notes as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

// ── Bankrolls ────────────────────────────────────────────────────────────────

export async function listBankrolls(): Promise<Bankroll[]> {
  const c = db();
  const res = await c.execute('select * from bankrolls order by id asc');
  return res.rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    currency: String(r.currency),
    initialBalance: Number(r.initial_balance),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

export async function createBankroll(input: {
  name: string;
  currency: string;
  initialBalance: number;
}): Promise<number> {
  if (!input.name.trim()) throw new Error('El nombre de la banca no puede estar vacío.');
  if (!(input.initialBalance >= 0)) throw new Error('La banca inicial no puede ser negativa.');

  const c = db();
  const tx = await c.transaction('write');
  try {
    const ins = await tx.execute({
      sql: 'insert into bankrolls (name, currency, initial_balance) values (?, ?, ?)',
      args: [input.name.trim(), input.currency, round2(input.initialBalance)],
    });
    const bankrollId = Number(ins.lastInsertRowid);
    await tx.execute({
      sql: `insert into bankroll_transactions (bankroll_id, type, amount, description)
            values (?, 'INITIAL_BALANCE', ?, 'Banca inicial')`,
      args: [bankrollId, round2(input.initialBalance)],
    });
    await tx.commit();
    return bankrollId;
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

export async function addBankrollMovement(input: {
  bankrollId: number;
  type: Extract<BankrollTxType, 'DEPOSIT' | 'WITHDRAWAL' | 'ADJUSTMENT'>;
  amount: number;
  description?: string;
}): Promise<void> {
  if (!(input.amount > 0)) throw new Error('El importe debe ser mayor que 0.');
  // Convenio de signo: DEPOSIT suma, WITHDRAWAL resta — el llamador siempre
  // pasa una magnitud positiva, aquí se decide el signo según el tipo.
  const signed = input.type === 'WITHDRAWAL' ? -round2(input.amount) : round2(input.amount);
  const c = db();
  await c.execute({
    sql: `insert into bankroll_transactions (bankroll_id, type, amount, description) values (?, ?, ?, ?)`,
    args: [input.bankrollId, input.type, signed, input.description ?? null],
  });
}

async function getTransactions(bankrollId: number): Promise<{ type: BankrollTxType; amount: number }[]> {
  const c = db();
  const res = await c.execute({
    sql: 'select type, amount from bankroll_transactions where bankroll_id = ?',
    args: [bankrollId],
  });
  return res.rows.map((r) => ({ type: String(r.type) as BankrollTxType, amount: Number(r.amount) }));
}

export async function getBankrollSummary(bankrollId: number): Promise<BankrollSummary | null> {
  const c = db();
  const bankrollRow = (
    await c.execute({ sql: 'select * from bankrolls where id = ?', args: [bankrollId] })
  ).rows[0];
  if (!bankrollRow) return null;

  const [transactions, betsRes, countsRes, todayRes] = await Promise.all([
    getTransactions(bankrollId),
    c.execute({ sql: 'select stake, status, profit from bets where bankroll_id = ?', args: [bankrollId] }),
    c.execute({
      sql: `select status, count(*) n from bets where bankroll_id = ? group by status`,
      args: [bankrollId],
    }),
    // "Hoy" en UTC (played_on/placed_at ya se guardan en UTC en todo el proyecto).
    c.execute({
      sql: `select coalesce(sum(profit), 0) p from bets
            where bankroll_id = ? and status <> 'OPEN' and settled_at >= date('now')`,
      args: [bankrollId],
    }),
  ]);

  const bets = betsRes.rows.map((r) => ({
    stake: Number(r.stake),
    status: String(r.status) as BetStatus,
    profit: r.profit === null ? null : Number(r.profit),
  }));

  const initialBalance = Number(bankrollRow.initial_balance);
  const totals = computeBankrollTotals(transactions, bets, initialBalance);

  const counts: Record<string, number> = {};
  for (const r of countsRes.rows) counts[String(r.status)] = Number(r.n);

  return {
    id: Number(bankrollRow.id),
    name: String(bankrollRow.name),
    currency: String(bankrollRow.currency),
    initialBalance,
    createdAt: String(bankrollRow.created_at),
    updatedAt: String(bankrollRow.updated_at),
    ...totals,
    countOpen: counts.OPEN ?? 0,
    countWon: counts.WON ?? 0,
    countLost: counts.LOST ?? 0,
    countVoid: counts.VOID ?? 0,
    countCashout: counts.CASHOUT ?? 0,
    profitToday: round2(Number(todayRes.rows[0]?.p ?? 0)),
  };
}

// ── Apuestas ─────────────────────────────────────────────────────────────────

export interface NewBetInput {
  bankrollId: number;
  tournament: string;
  tour: string;
  surface?: string | null;
  playerOne: string;
  playerTwo: string;
  eventName?: string | null;
  market: string;
  selection: string;
  line?: number | null;
  scope: string;
  oddsDecimal: number;
  stake: number;
  bookmaker?: string | null;
  isLive: boolean;
  liveScoreAtEntry?: string | null;
  serverAtEntry?: string | null;
  modelProbability?: number | null;
  modelFairOdds?: number | null;
  aiProbability?: number | null;
  aiFairOdds?: number | null;
  impliedProbability: number;
  edge?: number | null;
  expectedValue?: number | null;
  notes?: string | null;
}

export class BetValidationError extends Error {}

/** Crea la apuesta y su transacción STAKE en una sola operación atómica. */
export async function createBet(input: NewBetInput): Promise<number> {
  if (!input.selection.trim()) throw new BetValidationError('Falta la selección.');
  if (!input.market.trim()) throw new BetValidationError('Falta el mercado.');
  if (!(input.oddsDecimal > 1)) throw new BetValidationError('La cuota debe ser mayor que 1.');
  if (!(input.stake > 0)) throw new BetValidationError('El stake debe ser mayor que 0.');
  if (!input.scope.trim()) throw new BetValidationError('Falta el alcance del mercado (partido/set).');
  if (!input.playerOne.trim() || !input.playerTwo.trim()) {
    throw new BetValidationError('Faltan los nombres de los dos jugadores.');
  }

  const c = db();
  const tx = await c.transaction('write');
  try {
    const summaryRow = (
      await tx.execute({
        sql: `select coalesce(sum(amount), 0) b from bankroll_transactions where bankroll_id = ?`,
        args: [input.bankrollId],
      })
    ).rows[0];
    const available = round2(Number(summaryRow?.b ?? 0));
    const guard = canPlaceStake(round2(input.stake), available);
    if (!guard.ok) throw new BetValidationError(guard.reason);

    const ins = await tx.execute({
      sql: `insert into bets (
              bankroll_id, tournament, tour, surface, player_one, player_two, event_name,
              market, selection, line, scope, odds_decimal, stake, status,
              bookmaker, is_live, live_score_at_entry, server_at_entry,
              model_probability, model_fair_odds, ai_probability, ai_fair_odds,
              implied_probability, edge, expected_value, notes
            ) values (?,?,?,?,?,?,?, ?,?,?,?,?,?,'OPEN', ?,?,?,?, ?,?,?,?, ?,?,?,?)`,
      args: [
        input.bankrollId, input.tournament.trim(), input.tour, input.surface ?? null,
        input.playerOne.trim(), input.playerTwo.trim(), input.eventName ?? null,
        input.market.trim(), input.selection.trim(), input.line ?? null, input.scope,
        round2(input.oddsDecimal), round2(input.stake),
        input.bookmaker ?? null, input.isLive ? 1 : 0, input.liveScoreAtEntry ?? null, input.serverAtEntry ?? null,
        input.modelProbability ?? null, input.modelFairOdds ?? null, input.aiProbability ?? null, input.aiFairOdds ?? null,
        Math.round(input.impliedProbability * 1e4) / 1e4, input.edge ?? null, input.expectedValue ?? null,
        input.notes ?? null,
      ],
    });
    const betId = Number(ins.lastInsertRowid);

    await tx.execute({
      sql: `insert into bankroll_transactions (bankroll_id, bet_id, type, amount, description)
            values (?, ?, 'STAKE', ?, ?)`,
      args: [input.bankrollId, betId, -round2(input.stake), `Stake: ${input.playerOne} vs ${input.playerTwo} — ${input.market}`],
    });

    await tx.commit();
    return betId;
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

export interface ListBetsFilters {
  bankrollId: number;
  status?: BetStatus | 'ALL';
  tour?: string;
  tournament?: string;
  market?: string;
  bookmaker?: string;
  isLive?: boolean;
  from?: string;
  to?: string;
  limit?: number;
}

export async function listBets(filters: ListBetsFilters): Promise<BetRecord[]> {
  const c = db();
  const clauses = ['bankroll_id = ?'];
  // Tipo concreto (no unknown[]): libSQL solo acepta InValue en `args`, y con
  // unknown[] TypeScript no puede comprobar que lo que se empuja encaja.
  const args: (string | number)[] = [filters.bankrollId];

  if (filters.status && filters.status !== 'ALL') { clauses.push('status = ?'); args.push(filters.status); }
  if (filters.tour) { clauses.push('tour = ?'); args.push(filters.tour); }
  if (filters.tournament) { clauses.push('tournament like ?'); args.push(`%${filters.tournament}%`); }
  if (filters.market) { clauses.push('market like ?'); args.push(`%${filters.market}%`); }
  if (filters.bookmaker) { clauses.push('bookmaker = ?'); args.push(filters.bookmaker); }
  if (filters.isLive !== undefined) { clauses.push('is_live = ?'); args.push(filters.isLive ? 1 : 0); }
  if (filters.from) { clauses.push('placed_at >= ?'); args.push(filters.from); }
  if (filters.to) { clauses.push('placed_at <= ?'); args.push(filters.to); }

  const limit = Math.min(filters.limit ?? 200, 500);
  const res = await c.execute({
    sql: `select * from bets where ${clauses.join(' and ')} order by placed_at desc limit ?`,
    args: [...args, limit],
  });
  return res.rows.map(mapBet);
}

export async function getBet(id: number): Promise<BetRecord | null> {
  const c = db();
  const row = (await c.execute({ sql: 'select * from bets where id = ?', args: [id] })).rows[0];
  return row ? mapBet(row) : null;
}

export async function updateBetNotes(id: number, notes: string): Promise<void> {
  const c = db();
  await c.execute({
    sql: `update bets set notes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = ?`,
    args: [notes, id],
  });
}

export class AlreadySettledError extends Error {}

/**
 * Liquida una apuesta: ganada, perdida, anulada o cashout. Atómico y a
 * prueba de doble liquidación — el UPDATE lleva `where status = 'OPEN'` y si
 * no afecta ninguna fila (ya estaba liquidada, o carrera entre dos
 * peticiones) se aborta con AlreadySettledError. No es "comprobar y luego
 * escribir" (con ventana de carrera): comprobar y escribir son la MISMA
 * sentencia SQL.
 */
export async function settleBet(
  id: number,
  outcome: 'WON' | 'LOST' | 'VOID' | 'CASHOUT',
  extra?: { cashoutAmount?: number },
): Promise<BetRecord> {
  const c = db();
  const tx = await c.transaction('write');
  try {
    const row = (await tx.execute({ sql: 'select * from bets where id = ?', args: [id] })).rows[0];
    if (!row) throw new BetValidationError(`No existe la apuesta ${id}.`);
    const bet = mapBet(row);

    const guard = canSettle(bet.status);
    if (!guard.ok) throw new AlreadySettledError(guard.reason);

    let input: SettleInput;
    if (outcome === 'WON') input = { outcome: 'WON', stake: bet.stake, oddsDecimal: bet.oddsDecimal };
    else if (outcome === 'LOST') input = { outcome: 'LOST', stake: bet.stake };
    else if (outcome === 'VOID') input = { outcome: 'VOID', stake: bet.stake };
    else {
      const amount = extra?.cashoutAmount;
      if (amount === undefined || !(amount >= 0)) {
        throw new BetValidationError('Falta el importe recibido en el cashout.');
      }
      input = { outcome: 'CASHOUT', stake: bet.stake, cashoutAmount: amount };
    }
    const result = resolveSettlement(input);

    // El WHERE status='OPEN' es la protección real contra doble liquidación:
    // si otra petición ya liquidó esta apuesta entre el SELECT de arriba y
    // este UPDATE, rowsAffected sale en 0 y se aborta.
    const upd = await tx.execute({
      sql: `update bets set status = ?, settled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              payout = ?, profit = ?, cashout_amount = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
            where id = ? and status = 'OPEN'`,
      args: [result.status, result.payout, result.profit, outcome === 'CASHOUT' ? extra!.cashoutAmount! : null, id],
    });
    if (upd.rowsAffected === 0) throw new AlreadySettledError('La apuesta ya se liquidó en otra petición.');

    if (result.returnAmount !== null && result.returnType) {
      await tx.execute({
        sql: `insert into bankroll_transactions (bankroll_id, bet_id, type, amount, description)
              values (?, ?, ?, ?, ?)`,
        args: [
          bet.bankrollId, id, result.returnType, round2(result.returnAmount),
          `${result.returnType}: ${bet.playerOne} vs ${bet.playerTwo}`,
        ],
      });
    }

    await tx.commit();
    return { ...bet, status: result.status, payout: result.payout, profit: result.profit };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

// ── Transacciones y resumen diario ────────────────────────────────────────────

export async function listTransactions(bankrollId: number, limit = 200): Promise<BankrollTransactionRecord[]> {
  const c = db();
  const res = await c.execute({
    sql: `select * from bankroll_transactions where bankroll_id = ? order by created_at desc limit ?`,
    args: [bankrollId, Math.min(limit, 500)],
  });
  return res.rows.map((r) => ({
    id: Number(r.id),
    bankrollId: Number(r.bankroll_id),
    betId: r.bet_id === null ? null : Number(r.bet_id),
    type: String(r.type) as BankrollTxType,
    amount: Number(r.amount),
    description: (r.description as string | null) ?? null,
    createdAt: String(r.created_at),
  }));
}

export interface DailySummary {
  date: string;
  bankrollAtStart: number;
  deposits: number;
  withdrawals: number;
  betsPlaced: number;
  totalStaked: number;
  won: number;
  lost: number;
  voided: number;
  cashouts: number;
  netProfit: number;
  bankrollNow: number;
  pending: number;
}

/**
 * Resumen de un día CONCRETO, a demanda — nunca se "cierra" la caja sola por
 * cambio de fecha. Si el usuario quiere un cierre explícito, es una acción
 * aparte (botón), no un efecto automático de este resumen.
 */
export async function getDailySummary(bankrollId: number, date: string): Promise<DailySummary> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BetValidationError('Fecha inválida (se espera YYYY-MM-DD).');
  const c = db();

  const [beforeRow, movRes, betsRes, currentRow] = await Promise.all([
    c.execute({
      sql: `select coalesce(sum(amount), 0) b from bankroll_transactions
            where bankroll_id = ? and created_at < ?`,
      args: [bankrollId, `${date}T00:00:00.000Z`],
    }),
    c.execute({
      sql: `select type, sum(amount) s from bankroll_transactions
            where bankroll_id = ? and created_at >= ? and created_at < date(?, '+1 day')
            group by type`,
      args: [bankrollId, `${date}T00:00:00.000Z`, date],
    }),
    c.execute({
      sql: `select status, count(*) n, coalesce(sum(stake),0) stake, coalesce(sum(profit),0) profit
            from bets where bankroll_id = ? and placed_at >= ? and placed_at < date(?, '+1 day')
            group by status`,
      args: [bankrollId, `${date}T00:00:00.000Z`, date],
    }),
    c.execute({
      sql: `select coalesce(sum(amount), 0) b from bankroll_transactions where bankroll_id = ?`,
      args: [bankrollId],
    }),
  ]);

  const mov: Record<string, number> = {};
  for (const r of movRes.rows) mov[String(r.type)] = Number(r.s);

  let betsPlaced = 0, totalStaked = 0, won = 0, lost = 0, voided = 0, cashouts = 0, netProfit = 0;
  for (const r of betsRes.rows) {
    const status = String(r.status);
    const n = Number(r.n);
    betsPlaced += n;
    totalStaked += Number(r.stake);
    netProfit += Number(r.profit);
    if (status === 'WON') won = n;
    else if (status === 'LOST') lost = n;
    else if (status === 'VOID') voided = n;
    else if (status === 'CASHOUT') cashouts = n;
  }
  const pendingRow = (
    await c.execute({
      sql: `select count(*) n from bets where bankroll_id = ? and status = 'OPEN'
            and placed_at >= ? and placed_at < date(?, '+1 day')`,
      args: [bankrollId, `${date}T00:00:00.000Z`, date],
    })
  ).rows[0];

  return {
    date,
    bankrollAtStart: round2(Number(beforeRow.rows[0]?.b ?? 0)),
    deposits: round2(mov.DEPOSIT ?? 0),
    withdrawals: round2(Math.abs(mov.WITHDRAWAL ?? 0)),
    betsPlaced,
    totalStaked: round2(totalStaked),
    won, lost, voided, cashouts,
    netProfit: round2(netProfit),
    bankrollNow: round2(Number(currentRow.rows[0]?.b ?? 0)),
    pending: Number(pendingRow?.n ?? 0),
  };
}
