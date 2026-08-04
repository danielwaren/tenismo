import { useState } from 'react';
import type { BetRecord, BankrollSummary } from './types';
import { money, odds as fmtOdds, pct, signedPct, dateTime, STATUS_LABEL, STATUS_CLASS } from './format';

/** Apuestas abiertas, con acciones rápidas de liquidación pensadas para móvil. */
export default function BetList({
  bets,
  summary,
  onSettled,
}: {
  bets: BetRecord[];
  summary: BankrollSummary;
  onSettled: () => void;
}) {
  const [pending, setPending] = useState<{ bet: BetRecord; outcome: 'WON' | 'LOST' | 'VOID' | 'CASHOUT' } | null>(null);
  const [cashoutAmount, setCashoutAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmSettle() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/bets/settle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: pending.bet.id,
          outcome: pending.outcome,
          cashoutAmount: pending.outcome === 'CASHOUT' ? Number(cashoutAmount) : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'No se pudo liquidar.');
      setPending(null);
      setCashoutAmount('');
      onSettled();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!bets.length) {
    return <p className="card p-4 text-sm text-ink-muted">No hay apuestas abiertas.</p>;
  }

  return (
    <div className="space-y-2">
      {bets.map((b) => (
        <article key={b.id} className="card p-3.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{b.playerOne} vs {b.playerTwo}</p>
              <p className="truncate text-2xs text-ink-faint">
                {b.tour} · {b.tournament}{b.isLive ? ' · EN VIVO' : ''}
              </p>
            </div>
            <span className={`chip shrink-0 ${STATUS_CLASS[b.status]}`}>{STATUS_LABEL[b.status]}</span>
          </div>

          <div className="mt-2 rounded-lg bg-surface-2/50 p-2.5">
            <p className="text-sm text-ink">{b.selection}</p>
            <p className="text-2xs text-ink-muted">
              {b.market}{b.line !== null ? ` · línea ${b.line}` : ''} · {b.scope}
            </p>
          </div>

          <dl className="mt-2 grid grid-cols-3 gap-2 text-2xs">
            <div><dt className="text-ink-faint">Cuota</dt><dd className="font-mono tabular-nums text-ink">{fmtOdds(b.oddsDecimal)}</dd></div>
            <div><dt className="text-ink-faint">Stake</dt><dd className="font-mono tabular-nums text-ink">{money(b.stake, summary.currency)}</dd></div>
            <div><dt className="text-ink-faint">Retorno pot.</dt><dd className="font-mono tabular-nums text-court">{money(b.stake * b.oddsDecimal, summary.currency)}</dd></div>
            <div><dt className="text-ink-faint">Prob. modelo</dt><dd className="font-mono tabular-nums text-ink-muted">{pct(b.modelProbability)}</dd></div>
            <div><dt className="text-ink-faint">Cuota justa</dt><dd className="font-mono tabular-nums text-ink-muted">{fmtOdds(b.modelFairOdds)}</dd></div>
            <div><dt className="text-ink-faint">Ventaja</dt><dd className={`font-mono tabular-nums ${(b.edge ?? 0) >= 0 ? 'text-court' : 'text-live'}`}>{signedPct(b.edge)}</dd></div>
          </dl>

          {(b.liveScoreAtEntry || b.serverAtEntry) && (
            <p className="mt-2 text-2xs text-ink-faint">
              Entrada: {b.liveScoreAtEntry ?? 'sin marcador'}
              {b.serverAtEntry ? ` · saca ${b.serverAtEntry === 'p1' ? b.playerOne : b.playerTwo}` : ' · saque no registrado'}
            </p>
          )}
          <p className="mt-1 text-2xs text-ink-faint">{dateTime(b.placedAt)}</p>

          {b.status === 'OPEN' && (
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              <button type="button" onClick={() => setPending({ bet: b, outcome: 'WON' })}
                className="rounded-lg bg-court/15 px-2 py-3 text-2xs font-semibold text-court-ink">Ganada</button>
              <button type="button" onClick={() => setPending({ bet: b, outcome: 'LOST' })}
                className="rounded-lg bg-live/15 px-2 py-3 text-2xs font-semibold text-live">Perdida</button>
              <button type="button" onClick={() => setPending({ bet: b, outcome: 'VOID' })}
                className="rounded-lg bg-surface-2 px-2 py-3 text-2xs font-semibold text-ink-muted">Anular</button>
              <button type="button" onClick={() => setPending({ bet: b, outcome: 'CASHOUT' })}
                className="rounded-lg bg-hard/15 px-2 py-3 text-2xs font-semibold text-hard">Cashout</button>
            </div>
          )}
        </article>
      ))}

      {pending && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg/80 p-4 sm:items-center">
          <div className="card w-full max-w-sm p-4">
            <h3 className="mb-2 font-display text-base font-semibold">Confirmar liquidación</h3>
            <p className="text-sm text-ink-muted">
              {pending.bet.playerOne} vs {pending.bet.playerTwo}
            </p>
            <p className="mt-1 text-sm text-ink">{pending.bet.selection}</p>
            <dl className="mt-2 space-y-1 text-2xs text-ink-muted">
              <div className="flex justify-between"><dt>Resultado</dt><dd className="text-ink">{STATUS_LABEL[pending.outcome]}</dd></div>
              <div className="flex justify-between"><dt>Cuota</dt><dd className="font-mono tabular-nums text-ink">{fmtOdds(pending.bet.oddsDecimal)}</dd></div>
              <div className="flex justify-between"><dt>Stake</dt><dd className="font-mono tabular-nums text-ink">{money(pending.bet.stake, summary.currency)}</dd></div>
              {pending.outcome === 'WON' && (
                <div className="flex justify-between"><dt>Retorno</dt>
                  <dd className="font-mono tabular-nums text-court">{money(pending.bet.stake * pending.bet.oddsDecimal, summary.currency)}</dd></div>
              )}
              {pending.outcome === 'LOST' && (
                <div className="flex justify-between"><dt>Pérdida</dt>
                  <dd className="font-mono tabular-nums text-live">{money(-pending.bet.stake, summary.currency)}</dd></div>
              )}
              {pending.outcome === 'VOID' && (
                <div className="flex justify-between"><dt>Devolución</dt>
                  <dd className="font-mono tabular-nums text-ink">{money(pending.bet.stake, summary.currency)}</dd></div>
              )}
            </dl>

            {pending.outcome === 'CASHOUT' && (
              <div className="mt-3">
                <label className="mb-1 block text-2xs uppercase tracking-wide text-ink-muted" htmlFor="co">
                  Importe recibido
                </label>
                <input id="co" inputMode="decimal" value={cashoutAmount} onChange={(e) => setCashoutAmount(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink" placeholder="0.00" />
                {cashoutAmount !== '' && Number.isFinite(Number(cashoutAmount)) && (
                  <p className="mt-1 text-2xs text-ink-muted">
                    Beneficio: {money(Number(cashoutAmount) - pending.bet.stake, summary.currency)}
                  </p>
                )}
              </div>
            )}

            {error && <p className="mt-2 text-2xs text-live">{error}</p>}

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => { setPending(null); setError(null); }}
                className="rounded-lg border border-line px-4 py-3 text-sm text-ink-muted">Cancelar</button>
              <button type="button" disabled={busy || (pending.outcome === 'CASHOUT' && !(Number(cashoutAmount) >= 0))}
                onClick={confirmSettle}
                className="rounded-lg bg-court px-4 py-3 text-sm font-semibold text-bg disabled:opacity-40">
                {busy ? 'Guardando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
