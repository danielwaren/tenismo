import type { MatchRow, MatchAces } from '../lib/queries';
import { SURFACE_ES, SURFACE_DOT, fmtDate, tourChip } from '../lib/format';
import { matchPath, playerPath } from '../lib/urls';
import PlayerAvatar from './PlayerAvatar';

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

/**
 * Aces proyectados. Solo aparece si hay muestra en los dos jugadores: la
 * consulta ya descarta el resto, así que aquí basta con que exista la entrada.
 * Es un valor esperado (promedio ajustado por rival y superficie), NO una
 * probabilidad de over/under — por eso se rotula "esperados" y con un decimal.
 */
function Aces({ est, p1, p2 }: { est: MatchAces; p1: string; p2: string }) {
  const n = (x: number) => x.toFixed(1).replace('.', ',');
  return (
    <div className="mt-2 border-t border-line pt-2">
      <div className="flex items-baseline justify-between text-2xs text-ink-faint">
        <span className="uppercase tracking-wide">
          Aces esperados
          {!est.bySurface && (
            <span
              className="ml-1 normal-case tracking-normal"
              title="Calculado con el histórico global de cada jugador: la fuente del calendario no publica la superficie de este partido, y la tasa de aces cambia mucho entre arcilla (0,34 por juego al saque) y hierba (0,63)."
            >
              (sin superficie)
            </span>
          )}
        </span>
        <span className="font-mono tabular-nums text-ink-muted">total {n(est.total)}</span>
      </div>
      <div className="mt-1 flex gap-3 text-2xs text-ink-muted">
        <span className="min-w-0 flex-1 truncate">
          <span className="font-mono tabular-nums text-court">{n(est.p1.expected)}</span>
          {' '}{p1.split(' ')[0]}
        </span>
        <span className="min-w-0 flex-1 truncate text-right">
          {p2.split(' ')[0]}{' '}
          <span className="font-mono tabular-nums text-court">{n(est.p2.expected)}</span>
        </span>
      </div>
    </div>
  );
}

export default function MatchList({
  matches,
  aces,
}: {
  matches: MatchRow[];
  /** Proyección de aces por id de partido. Ausente = no se pinta. */
  aces?: Record<number, MatchAces>;
}) {
  if (!matches.length) {
    return (
      <p className="card p-4 text-sm text-ink-muted">No hay partidos que mostrar.</p>
    );
  }

  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {matches.map((m) => {
        const played = m.status === 'completed';
        const p1Won = m.p1Won === 1;
        return (
          <li key={m.id}>
            <article className="card-hover group flex h-full flex-col overflow-hidden p-4">
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

              {/* La cara identifica el partido más rápido que el nombre
                  abreviado ("Alcaraz C."), que es lo único que da la fuente. */}
              <div className="mt-4 space-y-2">
                <div className={`flex items-center gap-2.5 text-sm ${played && p1Won ? 'font-semibold text-ink' : 'text-ink'}`}>
                  <PlayerAvatar name={m.p1Name} playerId={m.p1Id} hasPhoto={m.p1Photo} size="sm" />
                  <a href={playerPath(m.p1Id, m.p1Slug)} className="min-w-0 flex-1 truncate text-inherit underline-offset-2 hover:text-court hover:underline">
                    {m.p1Name}
                  </a>
                  {played && (p1Won
                    ? <span className="shrink-0 text-court" title="Ganó">●</span>
                    : <span className="shrink-0 text-ink-faint" title="Perdió">○</span>)}
                </div>
                <div className="flex items-center gap-2 pl-1" aria-hidden="true"><span className="h-px flex-1 bg-line/60" /><span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-faint">vs</span><span className="h-px flex-1 bg-line/60" /></div>
                <div className={`flex items-center gap-2.5 text-sm ${played && !p1Won ? 'font-semibold text-ink' : 'text-ink'}`}>
                  <PlayerAvatar name={m.p2Name} playerId={m.p2Id} hasPhoto={m.p2Photo} size="sm" />
                  <a href={playerPath(m.p2Id, m.p2Slug)} className="min-w-0 flex-1 truncate text-inherit underline-offset-2 hover:text-court hover:underline">
                    {m.p2Name}
                  </a>
                  {played && (!p1Won
                    ? <span className="shrink-0 text-court" title="Ganó">●</span>
                    : <span className="shrink-0 text-ink-faint" title="Perdió">○</span>)}
                </div>
              </div>

              <div className="mt-auto pt-2">
              {m.probP1 !== null
                ? <ProbBar probP1={m.probP1} />
                : <p className="mt-2 text-2xs text-ink-faint">Sin pronóstico del modelo.</p>}

              {aces?.[m.id] && <Aces est={aces[m.id]} p1={m.p1Name} p2={m.p2Name} />}
              <a href={matchPath(m)} className="mt-3 flex items-center justify-between rounded-lg border border-line/70 bg-bg/35 px-3 py-2 text-xs font-medium text-ink-muted no-underline group-hover:border-court/30 group-hover:text-court-ink">
                <span>Ficha completa</span><span aria-hidden="true">→</span>
              </a>
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
