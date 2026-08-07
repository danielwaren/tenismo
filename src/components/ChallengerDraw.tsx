import { useState } from 'react';
import PlayerAvatar from './PlayerAvatar';

interface DrawMatch {
  round: string;
  winner: string | null;
  loser: string | null;
  score: string | null;
  sourceId: string | null;
}

/**
 * Cuadro completo del torneo, por pestañas de ronda.
 *
 * Antes de esto solo se veían los partidos de HOY, en una lista que crecía
 * sin límite según pasaban los días de torneo. Aquí cada ronda es su propia
 * pestaña — nada de scroll largo — y se navega hasta la final según se vaya
 * jugando (las rondas sin resultado todavía no aparecen: ver
 * scripts/lib/tennis-explorer-draw.ts, que no inventa partidos futuros).
 */
export default function ChallengerDraw({ rounds, matches }: { rounds: string[]; matches: DrawMatch[] }) {
  const rondasConDatos = rounds.filter((r) => matches.some((m) => m.round === r));
  const [ronda, setRonda] = useState(rondasConDatos[rondasConDatos.length - 1] ?? null);

  if (!rondasConDatos.length) {
    return (
      <p className="card p-4 text-sm text-ink-muted">
        Todavía no hay ninguna ronda completa — vuelve cuando se resuelva la primera.
      </p>
    );
  }

  const activa = ronda && rondasConDatos.includes(ronda) ? ronda : rondasConDatos[rondasConDatos.length - 1];
  const delaRonda = matches.filter((m) => m.round === activa);

  return (
    <div>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Ronda">
        {rondasConDatos.map((r) => (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={r === activa}
            onClick={() => setRonda(r)}
            className={`shrink-0 rounded-xl border px-3.5 py-2 text-sm font-medium capitalize transition ${
              r === activa
                ? 'border-court bg-court text-bg'
                : 'border-line bg-surface text-ink-muted hover:border-court/40 hover:text-ink'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {delaRonda.map((m, i) => (
          <li key={m.sourceId ?? i}>
            <article className="card p-3">
              <div className="flex items-center gap-2.5 text-sm">
                <PlayerAvatar name={m.winner ?? '?'} size="sm" />
                <span className="min-w-0 flex-1 truncate font-semibold text-ink">{m.winner ?? 'Sin identificar'}</span>
                <span className="shrink-0 text-court" title="Ganó">●</span>
              </div>
              <div className="flex items-center gap-2 py-1 pl-1" aria-hidden="true">
                <span className="h-px flex-1 bg-line/60" />
              </div>
              <div className="flex items-center gap-2.5 text-sm">
                <PlayerAvatar name={m.loser ?? '?'} size="sm" />
                <span className="min-w-0 flex-1 truncate text-ink-muted">{m.loser ?? 'Rival sin identificar'}</span>
                <span className="shrink-0 text-ink-faint" title="Perdió">○</span>
              </div>
              {m.score && (
                <p className="mt-2 border-t border-line pt-2 font-mono text-xs tabular-nums text-ink-muted">
                  {m.score}
                </p>
              )}
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}
