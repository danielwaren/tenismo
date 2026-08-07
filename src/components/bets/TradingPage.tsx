import { useState, useEffect, useCallback } from 'react';
import BetForm from './BetForm';
import BetList from './BetList';
import type { BetRecord, BankrollSummary, DailySummary } from './types';
import { money, pct, dateTime, STATUS_LABEL, STATUS_CLASS, odds as fmtOdds } from './format';

type Tab = 'registrar' | 'abiertas' | 'historial' | 'dia';

/**
 * Raíz de "Mis apuestas". Mantiene el estado compartido (banca, apuestas) y
 * lo recarga tras cada operación — nada de estado optimista en la
 * contabilidad: la caja siempre se relee del servidor, que es quien suma las
 * transacciones.
 */
export default function TradingPage({ initialBankrolls }: { initialBankrolls: { id: number; name: string }[] }) {
  const [bankrollId, setBankrollId] = useState<number | null>(initialBankrolls[0]?.id ?? null);
  const [summary, setSummary] = useState<BankrollSummary | null>(null);
  const [openBets, setOpenBets] = useState<BetRecord[]>([]);
  const [history, setHistory] = useState<BetRecord[]>([]);
  const [daily, setDaily] = useState<DailySummary | null>(null);
  const [dailyDate, setDailyDate] = useState(new Date().toISOString().slice(0, 10));
  const [tab, setTab] = useState<Tab>('registrar');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Filtros del historial.
  const [fStatus, setFStatus] = useState('ALL');
  const [fTour, setFTour] = useState('');
  const [fLive, setFLive] = useState('');

  const reload = useCallback(async () => {
    if (bankrollId === null) return;
    setLoading(true);
    setError(null);
    try {
      const [sumRes, openRes] = await Promise.all([
        fetch(`/api/bets/bankroll?view=summary&bankrollId=${bankrollId}`),
        fetch(`/api/bets?bankrollId=${bankrollId}&status=OPEN`),
      ]);
      const sumBody = await sumRes.json();
      const openBody = await openRes.json();
      if (!sumRes.ok) throw new Error(sumBody.error ?? 'No se pudo cargar la banca.');
      if (!openRes.ok) throw new Error(openBody.error ?? 'No se pudieron cargar las apuestas.');
      setSummary(sumBody.summary);
      setOpenBets(openBody.bets);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [bankrollId]);

  useEffect(() => { void reload(); }, [reload]);

  const loadHistory = useCallback(async () => {
    if (bankrollId === null) return;
    const params = new URLSearchParams({ bankrollId: String(bankrollId) });
    if (fStatus !== 'ALL') params.set('status', fStatus);
    if (fTour) params.set('tour', fTour);
    if (fLive) params.set('isLive', fLive);
    try {
      const res = await fetch(`/api/bets?${params}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'No se pudo cargar el historial.');
      setHistory(body.bets);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [bankrollId, fStatus, fTour, fLive]);

  useEffect(() => { if (tab === 'historial') void loadHistory(); }, [tab, loadHistory]);

  const loadDaily = useCallback(async () => {
    if (bankrollId === null) return;
    try {
      const res = await fetch(`/api/bets/bankroll?view=daily&bankrollId=${bankrollId}&date=${dailyDate}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'No se pudo cargar el resumen diario.');
      setDaily(body.daily);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [bankrollId, dailyDate]);

  useEffect(() => { if (tab === 'dia') void loadDaily(); }, [tab, loadDaily]);

  if (bankrollId === null) return <CreateBankroll onCreated={(id) => setBankrollId(id)} />;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'registrar', label: 'Registrar' },
    { key: 'abiertas', label: `Abiertas${summary ? ` (${summary.countOpen})` : ''}` },
    { key: 'historial', label: 'Historial' },
    { key: 'dia', label: 'Día' },
  ];

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg border border-live/40 bg-live/10 p-3 text-sm text-live">{error}</p>}

      {summary && (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Caja actual" value={money(summary.currentBalance, summary.currency)} accent
            hint={`de ${money(summary.initialBalance, summary.currency)} inicial`} />
          <Stat label="Exposición abierta" value={money(summary.openExposure, summary.currency)}
            hint={`${summary.countOpen} apuestas`} />
          <Stat label="Beneficio total" value={money(summary.netProfit, summary.currency)}
            negative={summary.netProfit < 0}
            hint={`hoy ${money(summary.profitToday, summary.currency)}`} />
          <Stat label="ROI / Yield" value={summary.roi === null ? '—' : `${summary.roi >= 0 ? '+' : ''}${summary.roi.toFixed(1)}%`}
            negative={(summary.roi ?? 0) < 0}
            hint={`${summary.countWon}G / ${summary.countLost}P / ${summary.countCashout}CO`} />
        </section>
      )}

      {summary && <BankrollMovement bankrollId={summary.id} currency={summary.currency} onDone={reload} />}
      {summary && <ResetBankroll bankrollId={summary.id} name={summary.name} onDone={reload} />}

      <nav className="flex gap-1 overflow-x-auto" aria-label="Secciones">
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium ${tab === t.key ? 'bg-surface-2 text-court-ink' : 'text-ink-muted'}`}>
            {t.label}
          </button>
        ))}
      </nav>

      {loading && <p className="text-sm text-ink-muted">Cargando…</p>}

      {tab === 'registrar' && summary && <BetForm summary={summary} onCreated={reload} />}
      {tab === 'abiertas' && summary && <BetList bets={openBets} summary={summary} onSettled={reload} />}

      {tab === 'historial' && summary && (
        <section className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}
              className="rounded-lg border border-line bg-surface-2 px-2 py-2 text-2xs text-ink">
              <option value="ALL">Todos</option>
              <option value="OPEN">Abiertas</option>
              <option value="WON">Ganadas</option>
              <option value="LOST">Perdidas</option>
              <option value="VOID">Anuladas</option>
              <option value="CASHOUT">Cashout</option>
            </select>
            <select value={fTour} onChange={(e) => setFTour(e.target.value)}
              className="rounded-lg border border-line bg-surface-2 px-2 py-2 text-2xs text-ink">
              <option value="">Circuito</option>
              <option value="ATP">ATP</option>
              <option value="WTA">WTA</option>
              <option value="Challenger">Challenger</option>
              <option value="ITF">ITF</option>
            </select>
            <select value={fLive} onChange={(e) => setFLive(e.target.value)}
              className="rounded-lg border border-line bg-surface-2 px-2 py-2 text-2xs text-ink">
              <option value="">Todas</option>
              <option value="true">En vivo</option>
              <option value="false">Prepartido</option>
            </select>
          </div>

          {history.length === 0 ? (
            <p className="card p-4 text-sm text-ink-muted">Sin apuestas para estos filtros.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-2xs">
                <thead className="bg-surface-2/50 text-left uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="px-2 py-2 font-medium">Fecha</th>
                    <th className="px-2 py-2 font-medium">Partido</th>
                    <th className="px-2 py-2 font-medium">Selección</th>
                    <th className="px-2 py-2 text-right font-medium">Cuota</th>
                    <th className="px-2 py-2 text-right font-medium">Stake</th>
                    <th className="px-2 py-2 text-right font-medium">Estado</th>
                    <th className="px-2 py-2 text-right font-medium">Beneficio</th>
                    <th className="px-2 py-2 text-right font-medium">ROI</th>
                    <th className="px-2 py-2 text-right font-medium">Modelo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/50">
                  {history.map((b) => (
                    <tr key={b.id}>
                      <td className="whitespace-nowrap px-2 py-2 text-ink-faint">{dateTime(b.placedAt)}</td>
                      <td className="px-2 py-2 text-ink">{b.playerOne} vs {b.playerTwo}</td>
                      <td className="px-2 py-2 text-ink-muted">{b.selection}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{fmtOdds(b.oddsDecimal)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{b.stake.toFixed(2)}</td>
                      <td className="px-2 py-2 text-right">
                        <span className={`chip ${STATUS_CLASS[b.status]}`}>{STATUS_LABEL[b.status]}</span>
                      </td>
                      <td className={`px-2 py-2 text-right font-mono tabular-nums ${(b.profit ?? 0) < 0 ? 'text-live' : b.profit ? 'text-court' : 'text-ink-faint'}`}>
                        {b.profit === null ? '—' : b.profit.toFixed(2)}
                      </td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-muted">
                        {b.profit === null ? '—' : `${((b.profit / b.stake) * 100).toFixed(0)}%`}
                      </td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-muted">{pct(b.modelProbability, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'dia' && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <input type="date" value={dailyDate} onChange={(e) => setDailyDate(e.target.value)}
              className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink" />
            <span className="text-2xs text-ink-faint">La caja no se cierra sola: esto es solo consulta.</span>
          </div>
          {daily && summary && (
            <div className="card p-4">
              <dl className="grid grid-cols-2 gap-3 text-2xs sm:grid-cols-3">
                <Item label="Banca al comenzar" value={money(daily.bankrollAtStart, summary.currency)} />
                <Item label="Entradas" value={money(daily.deposits, summary.currency)} />
                <Item label="Retiros" value={money(daily.withdrawals, summary.currency)} />
                <Item label="Apuestas" value={String(daily.betsPlaced)} />
                <Item label="Stake total" value={money(daily.totalStaked, summary.currency)} />
                <Item label="Verdes / Rojos" value={`${daily.won} / ${daily.lost}`} />
                <Item label="Cashouts / Anuladas" value={`${daily.cashouts} / ${daily.voided}`} />
                <Item label="Beneficio neto" value={money(daily.netProfit, summary.currency)} />
                <Item label="Banca actual" value={money(daily.bankrollNow, summary.currency)} />
                <Item label="Pendientes" value={String(daily.pending)} />
              </dl>
              {daily.pending > 0 && (
                <p className="mt-3 border-t border-line pt-2 text-2xs text-ink-faint">
                  Hay {daily.pending} apuesta(s) abierta(s) de este día: el resultado todavía puede cambiar.
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, hint, accent, negative }: {
  label: string; value: string; hint?: string; accent?: boolean; negative?: boolean;
}) {
  return (
    <div className="card p-3">
      <div className="text-2xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-1 font-mono text-lg tabular-nums ${negative ? 'text-live' : accent ? 'text-court' : 'text-ink'}`}>{value}</div>
      {hint && <div className="mt-0.5 text-2xs text-ink-faint">{hint}</div>}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="mt-0.5 font-mono tabular-nums text-ink">{value}</dd>
    </div>
  );
}

/**
 * Depósito / retiro sobre la banca activa. Es la única forma de mover la caja
 * después de crearla: `initialBalance` en CreateBankroll solo pone el arranque.
 * Escribe en `bankroll_transactions` vía POST /api/bets/bankroll (action
 * 'movement'), que ya existía en el backend — addBankrollMovement() en
 * src/lib/bets.ts — sin ningún control en esta pantalla hasta ahora.
 */
function BankrollMovement({ bankrollId, currency, onDone }: { bankrollId: number; currency: string; onDone: () => void }) {
  const [open, setOpen] = useState<'DEPOSIT' | 'WITHDRAWAL' | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNum = Number(amount);
  const valid = Number.isFinite(amountNum) && amountNum > 0;

  async function submit() {
    if (!open) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/bets/bankroll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'movement', bankrollId, type: open, amount: amountNum, description: description || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'No se pudo registrar el movimiento.');
      setAmount(''); setDescription(''); setOpen(null);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <section className="flex gap-2">
        <button type="button" onClick={() => setOpen('DEPOSIT')}
          className="flex-1 rounded-lg border border-court/40 bg-court/5 px-3 py-2 text-sm font-medium text-court">
          + Depositar
        </button>
        <button type="button" onClick={() => setOpen('WITHDRAWAL')}
          className="flex-1 rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-muted">
          − Retirar
        </button>
      </section>
    );
  }

  const input = 'w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink';
  return (
    <section className="card space-y-3 p-4">
      <h3 className="text-sm font-semibold text-ink">
        {open === 'DEPOSIT' ? 'Depositar en la banca' : 'Retirar de la banca'}
      </h3>
      <p className="text-2xs leading-relaxed text-ink-faint">
        {open === 'DEPOSIT'
          ? 'Registra el dinero que metiste a la casa de apuestas. No mueve nada real, solo lleva la cuenta.'
          : 'Registra el dinero que sacaste de la casa de apuestas.'}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-2xs uppercase tracking-wide text-ink-muted" htmlFor="mv-amount">
            Importe ({currency})
          </label>
          <input id="mv-amount" className={input} inputMode="decimal" value={amount}
            onChange={(e) => setAmount(e.target.value)} placeholder="50" autoFocus />
        </div>
        <div>
          <label className="mb-1 block text-2xs uppercase tracking-wide text-ink-muted" htmlFor="mv-desc">
            Nota (opcional)
          </label>
          <input id="mv-desc" className={input} value={description}
            onChange={(e) => setDescription(e.target.value)} placeholder="Bet365" />
        </div>
      </div>
      {error && <p className="text-2xs text-live">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => { setOpen(null); setError(null); }}
          className="rounded-lg border border-line px-4 py-2.5 text-sm text-ink-muted">
          Cancelar
        </button>
        <button type="button" disabled={busy || !valid} onClick={submit}
          className="rounded-lg bg-court px-4 py-2.5 text-sm font-semibold text-bg disabled:opacity-40">
          {busy ? 'Guardando…' : open === 'DEPOSIT' ? 'Confirmar depósito' : 'Confirmar retiro'}
        </button>
      </div>
    </section>
  );
}

/**
 * Reinicia la banca: borra TODAS las apuestas y movimientos registrados.
 *
 * A diferencia del reset de Paper Trading, esto es historial REAL que se
 * metió a mano — no dinero ficticio que coloca solo el cron. Por eso pide
 * escribir el NOMBRE exacto de la banca para confirmar, no basta un botón:
 * el mismo criterio que usan las plataformas para borrar una cuenta.
 */
function ResetBankroll({ bankrollId, name, onDone }: { bankrollId: number; name: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [newInitial, setNewInitial] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nombreOk = confirmName.trim() === name;
  // Vacío es válido (mantiene la banca actual); con texto, tiene que ser un
  // número real. Antes esto se validaba solo en el servidor, y una coma
  // decimal ("200,50") llegaba como NaN -> JSON la convierte en null -> el
  // servidor la leía como 0 y reiniciaba la banca a $0 SIN avisar. Validarlo
  // aquí, con el texto original todavía a mano, es la única forma de
  // distinguir "no escribió nada" de "escribió algo que no se entiende".
  const initialTexto = newInitial.trim();
  const initialValido = initialTexto === '' || (Number.isFinite(Number(initialTexto)) && Number(initialTexto) >= 0);
  const puedeConfirmar = nombreOk && initialValido;

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/bets/bankroll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'reset',
          bankrollId,
          confirmName: confirmName.trim(),
          initialBalance: initialTexto === '' ? undefined : Number(initialTexto),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'No se pudo reiniciar la banca.');
      setOpen(false); setConfirmName(''); setNewInitial('');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="text-right">
        <button type="button" onClick={() => setOpen(true)}
          className="text-2xs font-medium text-ink-faint hover:text-live">
          Reiniciar banca
        </button>
      </div>
    );
  }

  const input = 'w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink';
  return (
    <section className="card space-y-3 border-live/30 p-4">
      <h3 className="text-sm font-semibold text-live">Reiniciar "{name}"</h3>
      <p className="text-2xs leading-relaxed text-ink-faint">
        Borra TODAS las apuestas y movimientos de esta banca. No se puede deshacer. Para confirmar,
        escribe el nombre exacto de la banca.
      </p>
      <div>
        <label className="mb-1 block text-2xs uppercase tracking-wide text-ink-muted" htmlFor="rb-name">
          Nombre de la banca ({name})
        </label>
        <input id="rb-name" className={input} value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)} placeholder={name} autoFocus />
        {confirmName !== '' && !nombreOk && (
          <p className="mt-1 text-2xs text-live">No coincide con "{name}".</p>
        )}
      </div>
      <div>
        <label className="mb-1 block text-2xs uppercase tracking-wide text-ink-muted" htmlFor="rb-initial">
          Nueva banca inicial (opcional — deja en blanco para mantener la actual)
        </label>
        <input id="rb-initial" className={input} inputMode="decimal" value={newInitial}
          onChange={(e) => setNewInitial(e.target.value)} placeholder="100" />
        {initialTexto !== '' && !initialValido && (
          <p className="mt-1 text-2xs text-live">Usa punto decimal, no coma: {initialTexto} no es un número válido.</p>
        )}
      </div>
      {error && <p className="text-2xs text-live">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => { setOpen(false); setConfirmName(''); setNewInitial(''); setError(null); }}
          className="rounded-lg border border-line px-4 py-2.5 text-sm text-ink-muted">
          Cancelar
        </button>
        <button type="button" disabled={busy || !puedeConfirmar} onClick={reset}
          className="rounded-lg bg-live px-4 py-2.5 text-sm font-semibold text-bg disabled:opacity-40">
          {busy ? 'Reiniciando…' : 'Borrar todo y reiniciar'}
        </button>
      </div>
    </section>
  );
}

function CreateBankroll({ onCreated }: { onCreated: (id: number) => void }) {
  const [name, setName] = useState('Banca principal');
  const [currency, setCurrency] = useState('USD');
  const [initial, setInitial] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/bets/bankroll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, currency, initialBalance: Number(initial) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'No se pudo crear la banca.');
      onCreated(body.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = 'w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink';
  return (
    <section className="card p-5">
      <h2 className="mb-1 font-display text-base font-semibold">Crear banca</h2>
      <p className="mb-4 text-2xs leading-relaxed text-ink-faint">
        El saldo inicial lo pones tú. No se toma del saldo que muestre ninguna casa de apuestas:
        esta caja es independiente y se lleva por movimientos, para que sea auditable.
      </p>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-2xs uppercase tracking-wide text-ink-muted" htmlFor="bname">Nombre</label>
          <input id="bname" className={input} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-2xs uppercase tracking-wide text-ink-muted" htmlFor="bcur">Moneda</label>
            <input id="bcur" className={input} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
          </div>
          <div>
            <label className="mb-1 block text-2xs uppercase tracking-wide text-ink-muted" htmlFor="binit">Saldo inicial</label>
            <input id="binit" className={input} inputMode="decimal" value={initial} onChange={(e) => setInitial(e.target.value)} placeholder="100" />
          </div>
        </div>
        {error && <p className="text-2xs text-live">{error}</p>}
        <button type="button" disabled={busy || !(Number(initial) >= 0) || !name.trim()} onClick={create}
          className="w-full rounded-lg bg-court px-4 py-3 text-sm font-semibold text-bg disabled:opacity-40">
          {busy ? 'Creando…' : 'Crear banca'}
        </button>
      </div>
    </section>
  );
}
