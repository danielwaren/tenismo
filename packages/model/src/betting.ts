/**
 * "Mis apuestas": matemática pura del registro manual de apuestas reales.
 * Nada aquí toca la base de datos ni ejecuta nada — son funciones puras,
 * fáciles de probar, que separan el cálculo financiero de la persistencia
 * (que vive en src/lib/bets.ts) y de la UI.
 *
 * Distinto del Paper Trading (value.ts/calibration.ts): aquí la apuesta la
 * decide una persona, no el modelo. La app solo hace la contabilidad y
 * compara contra el modelo y un análisis de IA — nunca decide por el usuario.
 */

export type BetStatus = 'OPEN' | 'WON' | 'LOST' | 'VOID' | 'CASHOUT';

export type BankrollTxType =
  | 'INITIAL_BALANCE'
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'STAKE'
  | 'WIN_RETURN'
  | 'VOID_RETURN'
  | 'CASHOUT_RETURN'
  | 'ADJUSTMENT';

/** Probabilidad implícita CRUDA de una cuota decimal (sin quitar el margen de la casa). */
export function impliedProbability(oddsDecimal: number): number {
  if (!(oddsDecimal > 1)) return NaN;
  return 1 / oddsDecimal;
}

/** Cuota que haría justa una probabilidad dada. */
export function fairOdds(probability: number): number {
  if (!(probability > 0) || probability > 1) return NaN;
  return 1 / probability;
}

/** Valor esperado por unidad apostada: p·cuota − 1. Positivo = value. */
export function expectedValue(probability: number, oddsDecimal: number): number {
  return probability * oddsDecimal - 1;
}

/** Ventaja en puntos de probabilidad frente a lo que exige la cuota tomada (sin devig). */
export function edgeProbability(probability: number, oddsDecimal: number): number {
  return probability - impliedProbability(oddsDecimal);
}

export function potentialReturn(stake: number, oddsDecimal: number): number {
  return stake * oddsDecimal;
}

export function potentialProfit(stake: number, oddsDecimal: number): number {
  return potentialReturn(stake, oddsDecimal) - stake;
}

/**
 * Redondeo a centavos. Todo cálculo monetario pasa por aquí antes de
 * guardarse: sumar floats sin redondear deriva en 9.999999999999998 tras
 * suficientes movimientos, y eso se nota en la banca mostrada.
 */
export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

export interface SettleWon {
  outcome: 'WON';
  stake: number;
  oddsDecimal: number;
}
export interface SettleLost {
  outcome: 'LOST';
  stake: number;
}
export interface SettleVoid {
  outcome: 'VOID';
  stake: number;
}
export interface SettleCashout {
  outcome: 'CASHOUT';
  stake: number;
  cashoutAmount: number;
}
export type SettleInput = SettleWon | SettleLost | SettleVoid | SettleCashout;

export interface SettleResult {
  status: BetStatus;
  /** Importe de la transacción de retorno a crear. null = no se crea transacción (perdida). */
  returnAmount: number | null;
  returnType: Extract<BankrollTxType, 'WIN_RETURN' | 'VOID_RETURN' | 'CASHOUT_RETURN'> | null;
  payout: number | null;
  profit: number;
}

/**
 * Resuelve la liquidación de una apuesta a las cifras exactas que hay que
 * escribir: la fila `bets` (status/payout/profit) y, si corresponde, la
 * transacción de retorno en `bankroll_transactions`. Reglas del proyecto:
 *
 *   ganada    → retorno = stake × cuota; beneficio = retorno − stake
 *   perdida   → sin retorno; beneficio = −stake
 *   anulada   → retorno = stake completo; beneficio = 0
 *   cashout   → retorno = importe real recibido; beneficio = cashout − stake
 */
export function resolveSettlement(input: SettleInput): SettleResult {
  switch (input.outcome) {
    case 'WON': {
      const payout = round2(potentialReturn(input.stake, input.oddsDecimal));
      return {
        status: 'WON',
        returnAmount: payout,
        returnType: 'WIN_RETURN',
        payout,
        profit: round2(payout - input.stake),
      };
    }
    case 'LOST':
      return { status: 'LOST', returnAmount: null, returnType: null, payout: 0, profit: round2(-input.stake) };
    case 'VOID':
      return {
        status: 'VOID',
        returnAmount: round2(input.stake),
        returnType: 'VOID_RETURN',
        payout: round2(input.stake),
        profit: 0,
      };
    case 'CASHOUT': {
      const payout = round2(input.cashoutAmount);
      return {
        status: 'CASHOUT',
        returnAmount: payout,
        returnType: 'CASHOUT_RETURN',
        payout,
        profit: round2(payout - input.stake),
      };
    }
  }
}

export interface BankrollTotals {
  /** Caja actual = suma de TODAS las transacciones (única fuente de verdad, nunca un campo editable). */
  currentBalance: number;
  /** Exposición: suma de stake de las apuestas abiertas. */
  openExposure: number;
  /** Caja disponible para apostar = caja actual (ya descuenta el stake de lo abierto, porque STAKE ya restó). */
  availableBalance: number;
  /** Beneficio neto real: caja actual − inicial − depósitos + retiros. No cuenta stake abierto como pérdida. */
  netProfit: number;
  /** Total apostado en apuestas YA LIQUIDADAS (para ROI/yield). */
  totalStakedSettled: number;
  roi: number | null;
  /** Yield = beneficio neto / total apostado (histórico habitual en trading deportivo). */
  yieldPct: number | null;
}

export interface LedgerBet {
  stake: number;
  status: BetStatus;
  profit: number | null;
}

/**
 * Totales de banca a partir del libro de transacciones y la lista de
 * apuestas — nunca a partir de un saldo guardado aparte. `transactions` debe
 * incluir la INITIAL_BALANCE.
 */
export function computeBankrollTotals(
  transactions: { type: BankrollTxType; amount: number }[],
  bets: LedgerBet[],
  initialBalance: number,
): BankrollTotals {
  const currentBalance = round2(transactions.reduce((acc, t) => acc + t.amount, 0));
  const deposits = transactions.filter((t) => t.type === 'DEPOSIT').reduce((a, t) => a + t.amount, 0);
  // WITHDRAWAL se guarda en negativo (mismo convenio que STAKE: el signo de
  // `amount` es directamente su efecto en la caja). Para la fórmula de más
  // abajo hace falta la MAGNITUD retirada, no el signo con el que se sumó.
  const withdrawals = Math.abs(
    transactions.filter((t) => t.type === 'WITHDRAWAL').reduce((a, t) => a + t.amount, 0),
  );
  const openExposure = round2(bets.filter((b) => b.status === 'OPEN').reduce((a, b) => a + b.stake, 0));

  const settled = bets.filter((b) => b.status !== 'OPEN');
  const totalStakedSettled = round2(settled.reduce((a, b) => a + b.stake, 0));
  const netProfitSettled = round2(settled.reduce((a, b) => a + (b.profit ?? 0), 0));

  return {
    currentBalance,
    openExposure,
    availableBalance: currentBalance,
    // Withdrawals restan caja pero no son pérdida de apostar, así que se sacan
    // del cálculo de rendimiento real; igual con depósitos, que no son beneficio.
    netProfit: round2(currentBalance - initialBalance - deposits + withdrawals),
    totalStakedSettled,
    // ROI y yield en PORCENTAJE (13.33 = +13,33%), con dos decimales. Ambos
    // son la misma razón aquí — beneficio realizado sobre lo arriesgado en
    // apuestas ya liquidadas — y se exponen por separado porque la página los
    // rotula así; el stake abierto no entra en ninguno, todavía no es
    // resultado.
    roi: totalStakedSettled > 0 ? round2((netProfitSettled / totalStakedSettled) * 100) : null,
    yieldPct: totalStakedSettled > 0 ? round2((netProfitSettled / totalStakedSettled) * 100) : null,
  };
}

export interface GuardOk { ok: true }
export interface GuardFail { ok: false; reason: string }
export type GuardResult = GuardOk | GuardFail;

/** No se puede colocar una apuesta por más de lo que hay disponible en caja. */
export function canPlaceStake(stake: number, availableBalance: number): GuardResult {
  if (!(stake > 0)) return { ok: false, reason: 'El stake debe ser mayor que 0.' };
  if (stake > availableBalance) {
    return {
      ok: false,
      reason: `Stake ${stake.toFixed(2)} supera la caja disponible (${availableBalance.toFixed(2)}).`,
    };
  }
  return { ok: true };
}

/** Solo se liquida una apuesta que sigue OPEN — evita doble liquidación. */
export function canSettle(currentStatus: BetStatus): GuardResult {
  if (currentStatus !== 'OPEN') {
    return { ok: false, reason: `La apuesta ya está liquidada (${currentStatus}).` };
  }
  return { ok: true };
}

export function isValidOdds(oddsDecimal: number): boolean {
  return Number.isFinite(oddsDecimal) && oddsDecimal > 1;
}
