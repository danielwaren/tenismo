import { describe, it, expect } from 'vitest';
import {
  impliedProbability, fairOdds, expectedValue, edgeProbability,
  potentialReturn, potentialProfit, resolveSettlement, computeBankrollTotals,
  canPlaceStake, canSettle, round2,
} from '../src/betting';

describe('probabilidad implícita y cuota justa', () => {
  it('impliedProbability = 1/cuota', () => {
    expect(impliedProbability(2)).toBeCloseTo(0.5, 10);
    expect(impliedProbability(4)).toBeCloseTo(0.25, 10);
  });

  it('fairOdds = 1/probabilidad, inversa de impliedProbability', () => {
    expect(fairOdds(0.5)).toBeCloseTo(2, 10);
    expect(fairOdds(impliedProbability(2.4))).toBeCloseTo(2.4, 10);
  });

  it('cuota inválida (≤1) da NaN, no un número inventado', () => {
    expect(impliedProbability(1)).toBeNaN();
    expect(impliedProbability(0.5)).toBeNaN();
  });
});

describe('EV y ventaja', () => {
  it('expectedValue positivo cuando la probabilidad supera la implícita', () => {
    // 50% real contra cuota 2.40 (impl. 41.7%): EV = 0.5*2.4 - 1 = 0.2
    expect(expectedValue(0.5, 2.4)).toBeCloseTo(0.2, 10);
  });

  it('edgeProbability = probabilidad - implícita', () => {
    expect(edgeProbability(0.5, 2.4)).toBeCloseTo(0.5 - impliedProbability(2.4), 10);
  });

  it('retorno y beneficio potencial', () => {
    expect(potentialReturn(10, 2.5)).toBe(25);
    expect(potentialProfit(10, 2.5)).toBe(15);
  });
});

describe('resolveSettlement — apuesta ganada', () => {
  it('retorno = stake × cuota, beneficio = retorno - stake', () => {
    const r = resolveSettlement({ outcome: 'WON', stake: 10, oddsDecimal: 2.5 });
    expect(r.status).toBe('WON');
    expect(r.payout).toBe(25);
    expect(r.profit).toBe(15);
    expect(r.returnAmount).toBe(25);
    expect(r.returnType).toBe('WIN_RETURN');
  });
});

describe('resolveSettlement — apuesta perdida', () => {
  it('sin retorno, beneficio = -stake', () => {
    const r = resolveSettlement({ outcome: 'LOST', stake: 10 });
    expect(r.status).toBe('LOST');
    expect(r.payout).toBe(0);
    expect(r.profit).toBe(-10);
    expect(r.returnAmount).toBeNull();
    expect(r.returnType).toBeNull();
  });
});

describe('resolveSettlement — apuesta anulada', () => {
  it('devuelve el stake completo, beneficio = 0', () => {
    const r = resolveSettlement({ outcome: 'VOID', stake: 10 });
    expect(r.status).toBe('VOID');
    expect(r.payout).toBe(10);
    expect(r.profit).toBe(0);
    expect(r.returnAmount).toBe(10);
    expect(r.returnType).toBe('VOID_RETURN');
  });
});

describe('resolveSettlement — cashout', () => {
  it('cashout por debajo del stake: pérdida parcial', () => {
    const r = resolveSettlement({ outcome: 'CASHOUT', stake: 10, cashoutAmount: 6 });
    expect(r.payout).toBe(6);
    expect(r.profit).toBe(-4);
    expect(r.returnAmount).toBe(6);
    expect(r.returnType).toBe('CASHOUT_RETURN');
  });

  it('cashout por encima del stake: beneficio anticipado', () => {
    const r = resolveSettlement({ outcome: 'CASHOUT', stake: 10, cashoutAmount: 14 });
    expect(r.payout).toBe(14);
    expect(r.profit).toBe(4);
  });
});

describe('computeBankrollTotals', () => {
  it('caja actual es la suma de transacciones, no un saldo aparte', () => {
    const totals = computeBankrollTotals(
      [
        { type: 'INITIAL_BALANCE', amount: 100 },
        { type: 'STAKE', amount: -10 },
        { type: 'WIN_RETURN', amount: 25 },
      ],
      [{ stake: 10, status: 'WON', profit: 15 }],
      100,
    );
    expect(totals.currentBalance).toBe(115);
    expect(totals.availableBalance).toBe(115);
    expect(totals.netProfit).toBe(15);
  });

  it('exposición abierta suma solo el stake de apuestas OPEN', () => {
    const totals = computeBankrollTotals(
      [
        { type: 'INITIAL_BALANCE', amount: 100 },
        { type: 'STAKE', amount: -10 },
        { type: 'STAKE', amount: -5 },
      ],
      [
        { stake: 10, status: 'OPEN', profit: null },
        { stake: 5, status: 'OPEN', profit: null },
      ],
      100,
    );
    expect(totals.openExposure).toBe(15);
    // La caja SÍ ya descontó el stake (la transacción STAKE es negativa),
    // aunque la apuesta siga abierta: eso es "caja disponible" correcta.
    expect(totals.currentBalance).toBe(85);
  });

  it('depósitos y retiros no cuentan como beneficio/pérdida de apostar', () => {
    const totals = computeBankrollTotals(
      [
        { type: 'INITIAL_BALANCE', amount: 100 },
        { type: 'DEPOSIT', amount: 50 },
        { type: 'WITHDRAWAL', amount: -20 },
      ],
      [],
      100,
    );
    expect(totals.currentBalance).toBe(130);
    expect(totals.netProfit).toBe(0); // 130 - 100 - 50 + 20 = 0
  });

  it('ROI/yield null sin apuestas liquidadas (evita dividir por cero)', () => {
    const totals = computeBankrollTotals([{ type: 'INITIAL_BALANCE', amount: 100 }], [], 100);
    expect(totals.roi).toBeNull();
    expect(totals.yieldPct).toBeNull();
  });
});

describe('canPlaceStake — rechaza stake superior a la caja', () => {
  it('rechaza cuando el stake supera la caja disponible', () => {
    const g = canPlaceStake(150, 100);
    expect(g.ok).toBe(false);
  });
  it('acepta cuando el stake cabe en la caja', () => {
    expect(canPlaceStake(50, 100).ok).toBe(true);
  });
  it('rechaza stake no positivo', () => {
    expect(canPlaceStake(0, 100).ok).toBe(false);
  });
});

describe('canSettle — rechaza liquidación duplicada', () => {
  it('permite liquidar una apuesta OPEN', () => {
    expect(canSettle('OPEN').ok).toBe(true);
  });
  it('rechaza liquidar una apuesta ya liquidada', () => {
    expect(canSettle('WON').ok).toBe(false);
    expect(canSettle('LOST').ok).toBe(false);
    expect(canSettle('VOID').ok).toBe(false);
    expect(canSettle('CASHOUT').ok).toBe(false);
  });
});

describe('precisión decimal', () => {
  it('round2 evita el arrastre de coma flotante en sumas repetidas', () => {
    let acc = 0;
    for (let i = 0; i < 10; i++) acc += 0.1;
    expect(acc).not.toBe(1); // el float crudo NO da 1 exacto
    expect(round2(acc)).toBe(1);
  });

  it('resolveSettlement redondea a centavos', () => {
    const r = resolveSettlement({ outcome: 'WON', stake: 3.33, oddsDecimal: 1.91 });
    // 3.33 * 1.91 = 6.3603 -> 6.36
    expect(r.payout).toBe(6.36);
  });
});
