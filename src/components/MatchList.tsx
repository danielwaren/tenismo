import type { MatchRow } from '../lib/queries';
import { SURFACE_ES, SURFACE_DOT, fmtDate } from '../lib/format';

/**
 * Lista de partidos, reutilizada en el dashboard y en el buscador.
 * Cada fila enlaza a la ficha. Muestra el pronóstico del modelo como una barra
 * p1 / p2 y, en los jugados, quién ganó.
 *
 * Datos ya resueltos en el servidor; esta isla no toca la base.
 */
function ProbBar({ probP1, p1, p2 }: { probP1: number; p1: string; p2: string }) {
  const pctP1 = Math.round(probP1 * 100);
  return (
    <div className="mt-1">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className="bg-court-500" style={{ width: `${pctP1}%` }} />
        <div className="bg-slate-600" style={{ width: `${100 - pctP1}%` }} />
      </div>
      <div className="mt-0.5 flex justify-between text-[11px] text-slate-500">
        <span>{pctP1}%</span>
        <span>{100 - pctP1}%</span>
      </div>
    </div>
  );
}

export default function MatchList({ matches }: { matches: MatchRow[] }) {
  if (!matches.length) {
    return (
      <p className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
        No hay partidos que mostrar.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {matches.map((m) => {
        const played = m.status === 'completed';
        const p1Won = m.p1Won === 1;
        return (
          <li key={m.id}>
            <a
              href={`/match/${m.id}`}
              className="block rounded-lg border border-slate-800 bg-slate-900/40 p-3 no-underline transition hover:border-slate-700 hover:bg-slate-900/70"
            >
              <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className={`inline-block rounded px-1.5 py-0.5 font-medium ${m.tour === 'ATP' ? 'bg-blue-950 text-blue-300' : 'bg-fuchsia-950 text-fuchsia-300'}`}>
                    {m.tour}
                  </span>
                  {m.surface && (
                    <span className="flex items-center gap-1">
                      <span className={`h-2 w-2 rounded-full ${SURFACE_DOT[m.surface] ?? 'bg-slate-400'}`} />
                      {SURFACE_ES[m.surface] ?? m.surface}
                    </span>
                  )}
                  <span className="truncate">{m.tournament}{m.round ? ` · ${m.round}` : ''}</span>
                </span>
                <span className="shrink-0">
                  {played ? fmtDate(m.playedOn) : (
                    <span className="rounded bg-court-900 px-1.5 py-0.5 font-medium text-court-200">
                      {fmtDate(m.playedOn)}
                    </span>
                  )}
                </span>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <span className={`font-medium ${played && p1Won ? 'text-court-300' : 'text-slate-200'}`}>
                  {played && p1Won && '✓ '}{m.p1Name}
                </span>
                <span className={`text-right font-medium ${played && !p1Won ? 'text-court-300' : 'text-slate-200'}`}>
                  {m.p2Name}{played && !p1Won && ' ✓'}
                </span>
              </div>

              {m.probP1 !== null ? (
                <ProbBar probP1={m.probP1} p1={m.p1Name} p2={m.p2Name} />
              ) : (
                <p className="mt-1 text-[11px] text-slate-600">Sin pronóstico del modelo.</p>
              )}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
