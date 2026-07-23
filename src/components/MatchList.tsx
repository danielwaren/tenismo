import type { MatchRow } from '../lib/queries';
import { SURFACE_ES, SURFACE_DOT, fmtDate, tourChip } from '../lib/format';

/**
 * Lista de partidos, reutilizada en el panel, el buscador y los cuadros.
 * Cada fila enlaza a la ficha. Muestra el pronóstico como barra p1/p2 y, en los
 * jugados, quién ganó. Datos ya resueltos en el servidor.
 */
function ProbBar({ probP1 }: { probP1: number }) {
  const p = Math.round(probP1 * 100);
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="w-8 text-2xs tabular-nums text-ink-faint">{p}%</span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div className="absolute inset-y-0 left-0 rounded-full bg-court" style={{ width: `${p}%` }} />
      </div>
      <span className="w-8 text-right text-2xs tabular-nums text-ink-faint">{100 - p}%</span>
    </div>
  );
}

export default function MatchList({ matches }: { matches: MatchRow[] }) {
  if (!matches.length) {
    return (
      <p className="card p-4 text-sm text-ink-muted">No hay partidos que mostrar.</p>
    );
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {matches.map((m) => {
        const played = m.status === 'completed';
        const p1Won = m.p1Won === 1;
        return (
          <li key={m.id}>
            <a href={`/match/${m.id}`} className="card-hover block p-3.5 no-underline">
              <div className="flex items-center justify-between gap-3 text-2xs text-ink-faint">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={`chip ${tourChip(m.tour)}`}>{m.tour}</span>
                  {m.surface && (
                    <span className="flex items-center gap-1">
                      <span className={`h-1.5 w-1.5 rounded-full ${SURFACE_DOT[m.surface] ?? 'bg-ink-faint'}`} />
                      {SURFACE_ES[m.surface] ?? m.surface}
                    </span>
                  )}
                  <span className="truncate">{m.tournament}{m.round ? ` · ${m.round}` : ''}</span>
                </span>
                <span className="shrink-0">
                  {played
                    ? fmtDate(m.playedOn)
                    : <span className="chip bg-court/15 text-court-ink">{fmtDate(m.playedOn)}</span>}
                </span>
              </div>

              <div className="mt-2.5 space-y-1">
                <div className={`flex items-center gap-2 text-sm ${played && p1Won ? 'font-semibold text-ink' : 'text-ink'}`}>
                  {played && (p1Won
                    ? <span className="text-court">●</span>
                    : <span className="text-ink-faint">○</span>)}
                  <span className="truncate">{m.p1Name}</span>
                </div>
                <div className={`flex items-center gap-2 text-sm ${played && !p1Won ? 'font-semibold text-ink' : 'text-ink'}`}>
                  {played && (!p1Won
                    ? <span className="text-court">●</span>
                    : <span className="text-ink-faint">○</span>)}
                  <span className="truncate">{m.p2Name}</span>
                </div>
              </div>

              {m.probP1 !== null
                ? <ProbBar probP1={m.probP1} />
                : <p className="mt-2 text-2xs text-ink-faint">Sin pronóstico del modelo.</p>}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
