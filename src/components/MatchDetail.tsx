import type { MatchDetail, PlayerStats } from '../lib/queries';
import { surfaceLabel, fmtDate, pct, signedPct, SURFACE_ES, tourChip } from '../lib/format';

/**
 * Ficha de partido. Reúne todo lo que la fuente da de verdad: marcador set por
 * set, comparativa de los dos jugadores (Elo, ranking, forma, % por superficie),
 * head-to-head, y la explicación del pronóstico (en números y en palabras),
 * enfrentado al mercado sin esconder que el modelo suele perder esa comparación.
 *
 * Nota honesta: aces, dobles faltas y errores no forzados NO están en ninguna
 * fuente disponible (tennis-data no los trae y ESPN los devuelve vacíos), así
 * que no se muestran cifras inventadas de eso.
 */

const FEATURE_ES: Record<string, string> = {
  eloDiffSurface: 'Elo en la superficie', eloDiffOverall: 'Elo global',
  rankLogDiff: 'Ranking oficial', pointsLogDiff: 'Puntos de ranking',
  h2h: 'Head-to-head', h2hSurface: 'Head-to-head en la superficie',
  loadDiff: 'Carga reciente (nº partidos)', intensityDiff: 'Intensidad reciente (desgaste)',
  restDiff: 'Descanso', formDiff: 'Forma reciente', expDiff: 'Experiencia',
  surfaceExpDiff: 'Experiencia en la superficie', bestOf5EloDiff: 'Ventaja al mejor de 5',
};

function FormDots({ form }: { form: ('W' | 'L')[] }) {
  if (!form.length) return <span className="text-2xs text-ink-faint">sin datos</span>;
  return (
    <span className="flex gap-1" aria-label={`Forma: ${form.join(' ')}`}>
      {form.map((r, i) => (
        <span
          key={i}
          title={r === 'W' ? 'Victoria' : 'Derrota'}
          className={`grid h-4 w-4 place-items-center rounded-[4px] text-[9px] font-bold ${
            r === 'W' ? 'bg-court/20 text-court-ink' : 'bg-live/20 text-live'
          }`}
        >{r}</span>
      ))}
    </span>
  );
}

function StatRow({ label, a, b, aBetter, bBetter }: {
  label: string; a: string; b: string; aBetter?: boolean; bBetter?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-1.5">
      <span className={`text-right font-mono text-sm tabular-nums ${aBetter ? 'font-semibold text-court-ink' : 'text-ink'}`}>{a}</span>
      <span className="text-center text-2xs uppercase tracking-wide text-ink-faint">{label}</span>
      <span className={`font-mono text-sm tabular-nums ${bBetter ? 'font-semibold text-court-ink' : 'text-ink'}`}>{b}</span>
    </div>
  );
}

function num(x: number | null, d = 0): string { return x === null ? '—' : x.toFixed(d); }
function rate(x: number | null): string { return x === null ? '—' : `${Math.round(x * 100)}%`; }

export default function MatchDetailView({ match }: { match: MatchDetail }) {
  const m = match;
  const played = m.status === 'completed';
  const p1Won = m.p1Won === 1;
  const pctP1 = m.probP1 !== null ? Math.round(m.probP1 * 100) : null;
  const maxC = Math.max(0.01, ...m.contributions.map((c) => Math.abs(c.contribution)));
  const s1 = m.statsP1, s2 = m.statsP2;

  return (
    <div className="space-y-4">
      <a href="/" className="inline-flex items-center gap-1 text-sm text-court-ink no-underline hover:text-court">← Volver</a>

      {/* Marcador / cabecera */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 text-2xs text-ink-muted">
          <span className={`chip ${tourChip(m.tour)}`}>{m.tour}</span>
          {m.surface && <span className={`chip ${['bg-hard/15 text-hard','bg-clay/15 text-clay','bg-grass/15 text-grass'][['hard','clay','grass'].indexOf(m.surface)] ?? 'bg-surface-2 text-ink-muted'}`}>{surfaceLabel(m.surface)}</span>}
          <span>{m.tournament}{m.round ? ` · ${m.round}` : ''}</span>
          <span>· {fmtDate(m.playedOn)}</span>
          <span className={`chip ${m.status === 'scheduled' ? 'bg-court/15 text-court-ink' : 'bg-surface-2 text-ink-muted'}`}>
            {m.status === 'scheduled' ? 'Programado' : 'Jugado'}
          </span>
        </div>

        <div className="px-5 py-4">
          {[{ name: m.p1Name, won: played && p1Won, prob: pctP1, sets: m.sets.map((s) => s.p1) },
            { name: m.p2Name, won: played && !p1Won, prob: pctP1 === null ? null : 100 - pctP1, sets: m.sets.map((s) => s.p2) }]
            .map((row, i) => (
            <div key={i} className={`flex items-center justify-between gap-3 py-2 ${i === 0 ? 'border-b border-line/60' : ''}`}>
              <div className="flex min-w-0 items-center gap-2">
                {played && (row.won
                  ? <span className="text-court" aria-label="Ganador">●</span>
                  : <span className="text-ink-faint">○</span>)}
                <span className={`truncate text-lg ${row.won ? 'font-semibold text-ink' : 'text-ink'} font-display`}>{row.name}</span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {row.sets.length > 0 && (
                  <span className="flex gap-1.5 font-mono text-lg tabular-nums">
                    {row.sets.map((g, j) => (
                      <span key={j} className={row.won ? 'text-ink' : 'text-ink-muted'}>{g}</span>
                    ))}
                  </span>
                )}
                {row.prob !== null && (
                  <span className={`w-12 text-right font-mono text-lg tabular-nums ${row.won || (!played && row.prob >= 50) ? 'text-court' : 'text-ink-muted'}`}>{row.prob}%</span>
                )}
              </div>
            </div>
          ))}
          {pctP1 !== null && (
            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="bg-court" style={{ width: `${pctP1}%` }} />
            </div>
          )}
          {m.confidence !== null && m.confidence < 0.5 && (
            <p className="mt-3 text-2xs text-ink-faint">Confianza baja ({pct(m.confidence, 0)}): historial insuficiente, no apto para paper trading.</p>
          )}
        </div>
      </div>

      {/* Comparativa de jugadores */}
      <div className="card p-5">
        <div className="mb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <span className="truncate text-right font-display text-sm font-semibold text-ink">{s1.name}</span>
          <span className="text-2xs uppercase tracking-widest text-ink-faint">vs</span>
          <span className="truncate font-display text-sm font-semibold text-ink">{s2.name}</span>
        </div>
        <div className="divide-y divide-line/50">
          <StatRow label="Elo global" a={num(s1.eloOverall)} b={num(s2.eloOverall)}
            aBetter={(s1.eloOverall ?? 0) > (s2.eloOverall ?? 0)} bBetter={(s2.eloOverall ?? 0) > (s1.eloOverall ?? 0)} />
          {m.surface && (
            <StatRow label={`Elo en ${SURFACE_ES[m.surface]?.toLowerCase() ?? m.surface}`} a={num(s1.eloSurface)} b={num(s2.eloSurface)}
              aBetter={(s1.eloSurface ?? 0) > (s2.eloSurface ?? 0)} bBetter={(s2.eloSurface ?? 0) > (s1.eloSurface ?? 0)} />
          )}
          <StatRow label="Partidos" a={num(s1.matches)} b={num(s2.matches)} />
          <StatRow label="% victorias" a={rate(s1.winRate)} b={rate(s2.winRate)}
            aBetter={(s1.winRate ?? 0) > (s2.winRate ?? 0)} bBetter={(s2.winRate ?? 0) > (s1.winRate ?? 0)} />
          {m.surface && (
            <StatRow label={`% en ${SURFACE_ES[m.surface]?.toLowerCase() ?? m.surface}`} a={rate(s1.winRateSurface)} b={rate(s2.winRateSurface)}
              aBetter={(s1.winRateSurface ?? 0) > (s2.winRateSurface ?? 0)} bBetter={(s2.winRateSurface ?? 0) > (s1.winRateSurface ?? 0)} />
          )}
          {played && (
            <StatRow label="Juegos ganados" a={String(m.gamesP1)} b={String(m.gamesP2)}
              aBetter={m.gamesP1 > m.gamesP2} bBetter={m.gamesP2 > m.gamesP1} />
          )}
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-line/50 pt-3">
          <div className="flex justify-end"><FormDots form={s1.recentForm} /></div>
          <span className="text-2xs uppercase tracking-wide text-ink-faint">Forma</span>
          <div className="flex"><FormDots form={s2.recentForm} /></div>
        </div>
      </div>

      {/* Head-to-head */}
      {(m.h2hP1Wins + m.h2hP2Wins) > 0 && (
        <div className="card p-5">
          <h2 className="mb-3 font-display text-sm font-semibold text-ink">Head-to-head</h2>
          <div className="mb-3 flex items-center justify-center gap-4">
            <span className="font-mono text-2xl tabular-nums text-court">{m.h2hP1Wins}</span>
            <span className="text-2xs uppercase tracking-widest text-ink-faint">enfrentamientos</span>
            <span className="font-mono text-2xl tabular-nums text-ink-muted">{m.h2hP2Wins}</span>
          </div>
          <ul className="divide-y divide-line/50 text-sm">
            {m.h2h.slice(0, 6).map((meet) => (
              <li key={meet.matchId} className="flex items-center justify-between gap-2 py-1.5">
                <a href={`/match/${meet.matchId}`} className="min-w-0 truncate text-ink-muted no-underline hover:text-court-ink">
                  <span className="text-ink">{meet.winnerName}</span>
                  <span className="text-2xs text-ink-faint"> · {meet.tournament} {new Date(meet.playedOn).getUTCFullYear()}{meet.surface ? ` · ${SURFACE_ES[meet.surface] ?? meet.surface}` : ''}</span>
                </a>
                <span className="shrink-0 font-mono text-2xs tabular-nums text-ink-muted">{meet.score}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Modelo vs mercado */}
      {m.marketProbP1 !== null && m.probP1 !== null && (
        <div className="card p-5">
          <h2 className="mb-3 font-display text-sm font-semibold text-ink">Modelo vs mercado</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-2xs uppercase tracking-wide text-ink-faint">Modelo</div>
              <div className="font-mono text-xl tabular-nums text-court">{pct(m.probP1)}</div>
            </div>
            <div>
              <div className="text-2xs uppercase tracking-wide text-ink-faint">Mercado (devigado)</div>
              <div className="font-mono text-xl tabular-nums text-ink">{pct(m.marketProbP1)}</div>
            </div>
          </div>
          <p className="mt-3 text-2xs leading-relaxed text-ink-faint">
            Diferencia {signedPct(m.probP1 - m.marketProbP1)} para {m.p1Name}. El modelo está peor
            calibrado que la línea de cierre: una diferencia grande suele indicar que se equivoca el
            modelo, no que haya value.
          </p>
        </div>
      )}

      {/* Contribución de cada factor */}
      {m.contributions.length > 0 && (
        <div className="card p-5">
          <h2 className="mb-1 font-display text-sm font-semibold text-ink">Qué pesa en el pronóstico</h2>
          <p className="mb-4 text-2xs text-ink-faint">A la derecha empuja hacia {m.p1Name}; a la izquierda hacia {m.p2Name}.</p>
          <div className="space-y-1.5">
            {m.contributions.filter((c) => Math.abs(c.contribution) > 1e-4).map((c) => {
              const w = (Math.abs(c.contribution) / maxC) * 50;
              const toP1 = c.contribution >= 0;
              return (
                <div key={c.name} className="grid grid-cols-[1fr_11rem] items-center gap-3">
                  <div className="relative flex h-4 items-center">
                    <div className="absolute left-1/2 h-full w-px bg-line" />
                    <div className={`absolute h-2 rounded-sm ${toP1 ? 'bg-court' : 'bg-ink-faint'}`}
                      style={toP1 ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }} />
                  </div>
                  <span className="text-2xs text-ink-muted">{FEATURE_ES[c.name] ?? c.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* En palabras */}
      {m.reasons.length > 0 && (
        <div className="card p-5">
          <h2 className="mb-3 font-display text-sm font-semibold text-ink">En palabras</h2>
          <ul className="space-y-2 text-sm text-ink-muted">
            {m.reasons.map((r, i) => (
              <li key={i} className="flex gap-2"><span className="text-court">·</span><span>{r}</span></li>
            ))}
          </ul>
        </div>
      )}

      {/* Cuotas */}
      {m.odds.length > 0 && (
        <div className="card p-5">
          <h2 className="mb-3 font-display text-sm font-semibold text-ink">Cuotas reales</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-2xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="py-1 pr-4 font-medium">Casa</th>
                  <th className="py-1 pr-4 font-medium">{m.p1Name}</th>
                  <th className="py-1 font-medium">{m.p2Name}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {Object.entries(
                  m.odds.reduce((acc, o) => {
                    (acc[o.bookmaker] ??= {})[o.selection] = o.odds;
                    return acc;
                  }, {} as Record<string, Record<string, number>>),
                ).map(([book, sels]) => (
                  <tr key={book}>
                    <td className="py-1.5 pr-4 text-ink-muted">{book}</td>
                    <td className="py-1.5 pr-4 font-mono tabular-nums text-ink">{sels.p1?.toFixed(2) ?? '—'}</td>
                    <td className="py-1.5 font-mono tabular-nums text-ink">{sels.p2?.toFixed(2) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
