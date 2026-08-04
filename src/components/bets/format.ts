/** Formateo compartido por los componentes de "Mis apuestas". */

export function money(amount: number, currency: string): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}${currency === 'USD' ? '$' : ''}${Math.abs(amount).toFixed(2)}${currency === 'USD' ? '' : ` ${currency}`}`;
}

export function signedMoney(amount: number, currency: string): string {
  return `${amount >= 0 ? '+' : ''}${money(amount, currency).replace('-', '-')}`;
}

export function pct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

export function signedPct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(digits)}%`;
}

export function odds(x: number | null | undefined): string {
  return x === null || x === undefined || Number.isNaN(x) ? '—' : x.toFixed(2);
}

export function dateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Abierta', WON: 'Ganada', LOST: 'Perdida', VOID: 'Anulada', CASHOUT: 'Cashout',
};

export const STATUS_CLASS: Record<string, string> = {
  OPEN: 'bg-surface-2 text-ink-muted',
  WON: 'bg-court/15 text-court-ink',
  LOST: 'bg-live/15 text-live',
  VOID: 'bg-surface-2 text-ink-faint',
  CASHOUT: 'bg-hard/15 text-hard',
};
