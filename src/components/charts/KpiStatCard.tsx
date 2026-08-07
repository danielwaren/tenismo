/**
 * Tarjeta KPI sin anillo — para cifras SIN tope natural 0-100 (cuota, EV,
 * juegos/aces esperados). Forzar un anillo de "progreso" ahí inventaría una
 * proporción que el dato no tiene; en vez de eso, mismo tamaño/densidad que
 * `KpiRingCard` con una barra de acento de color en vez de un anillo falso.
 */
export default function KpiStatCard({
  big, label, accent = 'bg-line',
}: { big: string; label: string; accent?: string }) {
  return (
    <div className="card flex items-center gap-2.5 p-3">
      <span className={`h-8 w-1 shrink-0 rounded-full ${accent}`} aria-hidden="true" />
      <div className="min-w-0">
        <div className="truncate font-mono text-base font-semibold leading-tight text-ink" title={big}>{big}</div>
        <div className="truncate text-[10px] uppercase tracking-wide text-ink-faint" title={label}>{label}</div>
      </div>
    </div>
  );
}
