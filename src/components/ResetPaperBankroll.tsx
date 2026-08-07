import { useState } from 'react';

/**
 * Reinicia la banca simulada de Paper Trading: borra el historial de
 * apuestas ficticias y, si se indica, cambia la banca inicial. No toca dinero
 * real — esta banca la mueve sola el cron diario sobre cuota real, en modo
 * auditoría (ver la nota de arriba de la página).
 */
export default function ResetPaperBankroll({ initialBankroll }: { initialBankroll: number }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(initialBankroll));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si el campo tiene texto pero no es un número (p. ej. coma decimal en vez
  // de punto), antes se ignoraba en silencio y la banca se reiniciaba
  // manteniendo el valor VIEJO sin avisar de que lo escrito no se usó.
  const amountValido = Number.isFinite(Number(amount)) && Number(amount) > 0;

  async function reset() {
    if (!amountValido) { setError('La banca inicial debe ser un número mayor que 0 (usa punto decimal, no coma).'); return; }
    setBusy(true);
    setError(null);
    try {
      const n = Number(amount);
      const res = await fetch('/api/paper-trading/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initialBankroll: n }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'No se pudo reiniciar la banca.');
      // Recarga completa: la página es SSR y no vale la pena duplicar aquí
      // toda la lógica de getPaperSummary/getPaperTrades/getPaperMarketBreakdown.
      window.location.href = '/paper-trading';
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-muted hover:border-live/40 hover:text-live"
      >
        Reiniciar banca
      </button>
    );
  }

  return (
    <div className="card border-live/30 p-4">
      <p className="text-sm font-semibold text-ink">¿Reiniciar la banca simulada?</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-faint">
        Borra el historial de apuestas ficticias. El cron diario volverá a acumular desde cero. No
        afecta ningún dinero real ni a "Mis apuestas".
      </p>
      <div className="mt-3">
        <label className="mb-1 block text-2xs uppercase tracking-wide text-ink-muted" htmlFor="rb-amount">
          Banca inicial
        </label>
        <input
          id="rb-amount"
          className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        {amount.trim() !== '' && !amountValido && (
          <p className="mt-1 text-2xs text-live">Usa punto decimal, no coma: "{amount}" no es un número válido.</p>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-live">{error}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          className="rounded-lg border border-line px-3 py-2 text-sm text-ink-muted"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={busy || !amountValido}
          onClick={reset}
          className="rounded-lg bg-live px-3 py-2 text-sm font-semibold text-bg disabled:opacity-40"
        >
          {busy ? 'Reiniciando…' : 'Confirmar reinicio'}
        </button>
      </div>
    </div>
  );
}
