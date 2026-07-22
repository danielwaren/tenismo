import type { MatchDetail } from '../lib/queries';
import { surfaceLabel, fmtDate, pct, signedPct } from '../lib/format';

/**
 * Ficha de partido. Explica el pronóstico de dos formas complementarias:
 *   · en palabras (las razones que guardó el modelo),
 *   · en números (la contribución de cada feature al logit).
 * Y lo enfrenta al mercado, sin esconder que el modelo suele perder esa
 * comparación.
 */

const FEATURE_ES: Record<string, string> = {
  eloDiffSurface: 'Elo en la superficie',
  eloDiffOverall: 'Elo global',
  rankLogDiff: 'Ranking oficial',
  pointsLogDiff: 'Puntos de ranking',
  h2h: 'Head-to-head',
  h2hSurface: 'Head-to-head en la superficie',
  loadDiff: 'Carga reciente (nº partidos)',
  intensityDiff: 'Intensidad reciente (desgaste)',
  restDiff: 'Descanso',
  formDiff: 'Forma reciente',
  expDiff: 'Experiencia',
  surfaceExpDiff: 'Experiencia en la superficie',
  bestOf5EloDiff: 'Ventaja al mejor de 5',
};

function ProbSplit({ m }: { m: MatchDetail }) {
  const p1 = m.probP1 ?? 0.5;
  const pctP1 = Math.round(p1 * 100);
  const played = m.status === 'completed';
  const p1Won = m.p1Won === 1;
  return (
    <div>
      <div className="grid grid-cols-2 items-end gap-2">
        <div>
          <div className={`text-lg font-semibold ${played && p1Won ? 'text-court-300' : 'text-slate-100'}`}>
            {m.p1Name}{played && p1Won && ' ✓'}
          </div>
          {m.probP1 !== null && <div className="font-mono text-2xl tabular-nums text-court-400">{pctP1}%</div>}
        </div>
        <div className="text-right">
          <div className={`text-lg font-semibold ${played && !p1Won ? 'text-court-300' : 'text-slate-100'}`}>
            {played && !p1Won && '✓ '}{m.p2Name}
          </div>
          {m.probP1 !== null && <div className="font-mono text-2xl tabular-nums text-slate-300">{100 - pctP1}%</div>}
        </div>
      </div>
      {m.probP1 !== null && (
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-800">
          <div className="bg-court-500" style={{ width: `${pctP1}%` }} />
          <div className="bg-slate-600" style={{ width: `${100 - pctP1}%` }} />
        </div>
      )}
    </div>
  );
}

export default function MatchDetailView({ match }: { match: MatchDetail }) {
  const m = match;
  const maxContribution = Math.max(0.01, ...m.contributions.map((c) => Math.abs(c.contribution)));

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className={`rounded px-1.5 py-0.5 font-medium ${m.tour === 'ATP' ? 'bg-blue-950 text-blue-300' : 'bg-fuchsia-950 text-fuchsia-300'}`}>
            {m.tour}
          </span>
          <span>{m.tournament}</span>
          {m.round && <span>· {m.round}</span>}
          <span>· {surfaceLabel(m.surface)}{m.court ? ` (${m.court})` : ''}</span>
          <span>· {fmtDate(m.playedOn)}</span>
          <span className={`rounded px-1.5 py-0.5 ${m.status === 'scheduled' ? 'bg-court-900 text-court-200' : 'bg-slate-800 text-slate-300'}`}>
            {m.status === 'scheduled' ? 'Programado' : 'Jugado'}
          </span>
        </div>
        <ProbSplit m={m} />
        {m.confidence !== null && (
          <p className="mt-3 text-xs text-slate-500">
            Confianza del pronóstico: {pct(m.confidence, 0)}
            {m.confidence < 0.5 && ' — historial insuficiente, no apto para paper trading.'}
          </p>
        )}
      </div>

      {/* Modelo vs mercado */}
      {m.marketProbP1 !== null && m.probP1 !== null && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Modelo vs mercado</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-slate-500">Modelo</div>
              <div className="font-mono text-lg tabular-nums text-court-400">{pct(m.probP1)}</div>
              <div className="text-xs text-slate-500">para {m.p1Name}</div>
            </div>
            <div>
              <div className="text-slate-500">Mercado (devigado)</div>
              <div className="font-mono text-lg tabular-nums text-slate-300">{pct(m.marketProbP1)}</div>
              <div className="text-xs text-slate-500">para {m.p1Name}</div>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Diferencia: {signedPct(m.probP1 - m.marketProbP1)} respecto al mercado. Recuerda que el
            modelo está peor calibrado que la línea de cierre: una diferencia grande suele indicar
            que se equivoca el modelo, no que haya encontrado value.
          </p>
        </div>
      )}

      {/* Contribución de cada factor */}
      {m.contributions.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">Qué pesa en el pronóstico</h2>
          <p className="mb-4 text-xs text-slate-500">
            Aporte de cada factor. A la derecha (verde) empuja hacia {m.p1Name}; a la izquierda hacia {m.p2Name}.
          </p>
          <div className="space-y-2">
            {m.contributions.filter((c) => Math.abs(c.contribution) > 1e-4).map((c) => {
              const width = (Math.abs(c.contribution) / maxContribution) * 50;
              const toP1 = c.contribution >= 0;
              return (
                <div key={c.name} className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <div className="flex items-center gap-1 text-xs">
                    <div className="relative flex h-4 w-full items-center">
                      <div className="absolute left-1/2 h-full w-px bg-slate-700" />
                      <div
                        className={`absolute h-2.5 rounded-sm ${toP1 ? 'bg-court-500' : 'bg-slate-500'}`}
                        style={toP1
                          ? { left: '50%', width: `${width}%` }
                          : { right: '50%', width: `${width}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-40 shrink-0 text-right text-xs text-slate-400">
                    {FEATURE_ES[c.name] ?? c.name}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Explicación en palabras */}
      {m.reasons.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">En palabras</h2>
          <ul className="space-y-2 text-sm text-slate-300">
            {m.reasons.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-court-500">·</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Cuotas */}
      {m.odds.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Cuotas reales</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1 pr-4 font-medium">Casa</th>
                  <th className="py-1 pr-4 font-medium">{m.p1Name}</th>
                  <th className="py-1 pr-4 font-medium">{m.p2Name}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {Object.entries(
                  m.odds.reduce((acc, o) => {
                    (acc[o.bookmaker] ??= {})[o.selection] = o.odds;
                    return acc;
                  }, {} as Record<string, Record<string, number>>),
                ).map(([book, sels]) => (
                  <tr key={book}>
                    <td className="py-1 pr-4 text-slate-400">{book}</td>
                    <td className="py-1 pr-4 font-mono tabular-nums">{sels.p1?.toFixed(2) ?? '—'}</td>
                    <td className="py-1 pr-4 font-mono tabular-nums">{sels.p2?.toFixed(2) ?? '—'}</td>
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
