/** Etiquetas y colores compartidos por el frontend. */

export const SURFACE_ES: Record<string, string> = {
  hard: 'Dura',
  clay: 'Arcilla',
  grass: 'Hierba',
  carpet: 'Moqueta',
};

/** Clase de color de fondo por superficie, para las etiquetas. */
export const SURFACE_DOT: Record<string, string> = {
  hard: 'bg-hard',
  clay: 'bg-clay',
  grass: 'bg-grass',
  carpet: 'bg-slate-400',
};

export function surfaceLabel(s: string | null | undefined): string {
  return s ? (SURFACE_ES[s] ?? s) : '—';
}

/** Fecha ISO 'YYYY-MM-DD' a formato local corto. */
export function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function signedPct(x: number, digits = 1): string {
  return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(digits)}%`;
}
