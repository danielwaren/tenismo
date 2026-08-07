import type { MatchDetail } from '../lib/queries';
import { surfaceLabel, fmtDate, pct, signedPct, SURFACE_ES, tourChip } from '../lib/format';
import { playerPath } from '../lib/urls';
import PredictionFactorsChart from './charts/PredictionFactorsChart';
import ExpectedGamesChart from './charts/ExpectedGamesChart';
import ExpectedAcesChart from './charts/ExpectedAcesChart';
import EloComparisonChart from './charts/EloComparisonChart';
import ServeReturnComparisonChart from './charts/ServeReturnComparisonChart';
import ServeReturnRadarChart from './charts/ServeReturnRadarChart';
import KpiRingCard from './charts/KpiRingCard';
import KpiStatCard from './charts/KpiStatCard';
import { chartColor, ChartEmpty } from './charts/theme';

/**
 * Ficha de partido — pantalla de inteligencia de tenis.
 *
 * Layout tipo dashboard denso: una tira de tarjetas KPI compactas arriba
 * (lectura inmediata, sin scroll) y el resto en una cuadrícula de 12
 * columnas en pantallas ≥lg — pedido explícito: "no quiero tanto scroll,
 * llenar de info al usuario de inmediato". Todos los gráficos usan
 * ChartContainer/ChartConfig de shadcn/ui (src/components/ui/chart.tsx)
 * sobre Recharts — ninguno es CSS/SVG a mano. En mobile/tablet cada sección
 * sigue apilada a ancho completo — nunca se elimina información para que
 * quepa, solo se comprime el tamaño de los gráficos y el padding.
 *
 * Orden de lectura: KPIs → cabecera → pronóstico Tenismo + mercado (misma
 * fila) → por qué ese % + juegos probables + aces probables (misma fila,
 * 3 columnas) → saque/resto → head-to-head.
 *
 * Todo lo etiquetado "Estimación Tenismo" sale de un cálculo propio (Elo,
 * motor punto a punto, Poisson sobre una media ajustada); todo lo que no dice
 * eso viene de datos observados (Tennis Abstract, ranking oficial, cuotas
 * reales). Ver el informe de auditoría para el detalle de cada fuente.
 */

const FEATURE_ES: Record<string, string> = {
  eloDiffSurface: 'Elo en la superficie', eloDiffOverall: 'Elo global',
  rankLogDiff: 'Ranking oficial', pointsLogDiff: 'Puntos de ranking',
  h2h: 'Head-to-head', h2hSurface: 'Head-to-head en la superficie',
  loadDiff: 'Carga reciente (nº partidos)', intensityDiff: 'Intensidad reciente (desgaste)',
  restDiff: 'Descanso', formDiff: 'Forma reciente', expDiff: 'Experiencia',
  surfaceExpDiff: 'Experiencia en la superficie', bestOf5EloDiff: 'Ventaja al mejor de 5',
  markovLogit: 'Motor punto a punto (saque/resto)',
};

const CONFIDENCE_STYLE: Record<'ALTA' | 'MEDIA' | 'BAJA', string> = {
  ALTA: 'bg-court/15 text-court-ink', MEDIA: 'bg-surface-2 text-ink-muted', BAJA: 'bg-live/15 text-live',
};

const VALUE_TIER_STYLE: Record<string, string> = {
  SIN_CUOTA: 'bg-surface-2 text-ink-faint', NO_EVALUABLE: 'bg-surface-2 text-ink-faint',
  SIN_VALUE: 'bg-surface-2 text-ink-muted', VALUE_DEBIL: 'bg-court/10 text-court-ink',
  VALUE: 'bg-court/20 text-court-ink', VALUE_FUERTE: 'bg-court/30 text-court-ink font-semibold',
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
function odds2(x: number | null): string { return x === null || !Number.isFinite(x) ? '—' : x.toFixed(2); }

export default function MatchDetailView({ match }: { match: MatchDetail }) {
  const m = match;
  const played = m.status === 'completed';
  const p1Won = m.p1Won === 1;
  const pctP1 = m.probP1 !== null ? Math.round(m.probP1 * 100) : null;
  const s1 = m.statsP1, s2 = m.statsP2;
  const favoriteName = m.probP1 !== null ? (m.probP1 >= 0.5 ? m.p1Name : m.p2Name) : null;
  const fairOddsP2 = m.probP1 !== null && m.probP1 < 1 ? 1 / (1 - m.probP1) : null;

  return (
    <div>
      <a href="/" className="mb-3 inline-flex items-center gap-1 text-sm text-court-ink no-underline hover:text-court">← Volver</a>

      {/* TIRA DE KPI — lectura inmediata, sin scroll. Anillo solo en métricas
          realmente 0-100 (probabilidad, confianza); el resto son tarjetas
          planas para no inventar un "% de progreso" que el dato no tiene. */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {pctP1 !== null && favoriteName && (
          <KpiRingCard
            ringPct={Math.max(pctP1, 100 - pctP1)}
            color={chartColor.p1}
            big={favoriteName.split(' ')[0]}
            label="Favorito Tenismo"
          />
        )}
        {m.confidenceDetail && (
          <KpiRingCard
            ringPct={m.confidenceDetail.score}
            color={m.confidenceDetail.band === 'BAJA' ? chartColor.live : chartColor.p1}
            big={`${m.confidenceDetail.score}/100`}
            label={`Confianza · ${m.confidenceDetail.band}`}
          />
        )}
        <KpiStatCard big={odds2(m.market?.fairOddsModel ?? null)} label="Cuota justa" accent="bg-court" />
        {m.market && m.market.edgePp !== null && (
          <KpiStatCard
            big={signedPct(m.market.edgePp / 100)}
            label={`Edge · ${m.market.tierLabel}`}
            accent={m.market.edgePp > 0 ? 'bg-court' : 'bg-ink-faint'}
          />
        )}
        {m.expectedGames && (
          <KpiStatCard big={`${m.expectedGames.meanGames.toFixed(1)} juegos`} label="Juegos esperados" accent="bg-hard" />
        )}
        {m.expectedAces && (
          <KpiStatCard big={`${m.expectedAces.totalExpected.toFixed(1)} aces`} label="Aces esperados (total)" accent="bg-clay" />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start">
        {/* MATCH HEADER — ancho completo, compacto */}
        <div className="card overflow-hidden lg:col-span-12">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-2xs text-ink-muted">
            <span className={`chip ${tourChip(m.tour)}`}>{m.tour}</span>
            {m.surface && <span className={`chip ${['bg-hard/15 text-hard','bg-clay/15 text-clay','bg-grass/15 text-grass'][['hard','clay','grass'].indexOf(m.surface)] ?? 'bg-surface-2 text-ink-muted'}`}>{surfaceLabel(m.surface)}</span>}
            <span>{m.tournament}{m.round ? ` · ${m.round}` : ''}</span>
            <span>· {fmtDate(m.playedOn)}</span>
            <span className={`chip ${m.status === 'scheduled' ? 'bg-court/15 text-court-ink' : 'bg-surface-2 text-ink-muted'}`}>
              {m.status === 'scheduled' ? 'Programado' : 'Jugado'}
            </span>
          </div>

          <div className="px-4 py-2.5">
            {[{ id: m.p1Id, slug: m.p1Slug, name: m.p1Name, won: played && p1Won, sets: m.sets.map((s) => s.p1), prob: pctP1 },
              { id: m.p2Id, slug: m.p2Slug, name: m.p2Name, won: played && !p1Won, sets: m.sets.map((s) => s.p2), prob: pctP1 === null ? null : 100 - pctP1 }]
              .map((row, i) => (
              <div key={i} className={`flex items-center justify-between gap-3 py-1 ${i === 0 ? 'border-b border-line/60' : ''}`}>
                <div className="flex min-w-0 items-center gap-2">
                  {played && (row.won
                    ? <span className="text-court" aria-label="Ganador">●</span>
                    : <span className="text-ink-faint">○</span>)}
                  <a href={playerPath(row.id, row.slug)} className={`truncate font-display text-base no-underline hover:text-court hover:underline ${row.won ? 'font-semibold text-ink' : 'text-ink'}`}>{row.name}</a>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {row.sets.length > 0 && (
                    <span className="flex gap-1.5 font-mono tabular-nums">
                      {row.sets.map((g, j) => (
                        <span key={j} className={row.won ? 'text-ink' : 'text-ink-muted'}>{g}</span>
                      ))}
                    </span>
                  )}
                  {row.prob !== null && <span className="w-10 text-right font-mono text-2xs tabular-nums text-ink-faint">{row.prob}%</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* TENISMO PREDICTION — columna ancha (la probabilidad ya está en el KPI de arriba; aquí va la comparativa) */}
        <div className="card p-4 lg:col-span-7">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-sm font-semibold text-ink">Comparativa de jugadores</h2>
            {favoriteName && (
              <span className="text-2xs text-ink-faint">
                Pronóstico: <span className="font-semibold text-ink">{favoriteName}</span>
              </span>
            )}
          </div>

          {/* Comparativa de jugadores. */}
          <div className="divide-y divide-line/50 border-t border-line/50">
            <StatRow label="Ranking (último dato)" a={s1.ranking === null ? '—' : `#${s1.ranking}`} b={s2.ranking === null ? '—' : `#${s2.ranking}`}
              aBetter={s1.ranking !== null && (s2.ranking === null || s1.ranking < s2.ranking)} bBetter={s2.ranking !== null && (s1.ranking === null || s2.ranking < s1.ranking)} />
            <StatRow label="Elo global" a={num(s1.eloOverall)} b={num(s2.eloOverall)}
              aBetter={(s1.eloOverall ?? 0) > (s2.eloOverall ?? 0)} bBetter={(s2.eloOverall ?? 0) > (s1.eloOverall ?? 0)} />
            {m.surface && (
              <StatRow label={`Elo en ${SURFACE_ES[m.surface]?.toLowerCase() ?? m.surface}`} a={num(s1.eloSurface)} b={num(s2.eloSurface)}
                aBetter={(s1.eloSurface ?? 0) > (s2.eloSurface ?? 0)} bBetter={(s2.eloSurface ?? 0) > (s1.eloSurface ?? 0)} />
            )}
            <StatRow label="Elo últimos 2 años" a={num(s1.eloRecent)} b={num(s2.eloRecent)}
              aBetter={(s1.eloRecent ?? 0) > (s2.eloRecent ?? 0)} bBetter={(s2.eloRecent ?? 0) > (s1.eloRecent ?? 0)} />
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
          {(s1.rankingDate || s2.rankingDate) && <p className="mt-2 text-center text-2xs text-ink-faint">Ranking oficial más reciente disponible: {s1.rankingDate ? `${s1.name} al ${fmtDate(s1.rankingDate)}` : `${s1.name} sin dato`} · {s2.rankingDate ? `${s2.name} al ${fmtDate(s2.rankingDate)}` : `${s2.name} sin dato`}.</p>}
          <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-line/50 pt-3">
            <div className="flex justify-end"><FormDots form={s1.recentForm} /></div>
            <span className="text-2xs uppercase tracking-wide text-ink-faint">Forma</span>
            <div className="flex"><FormDots form={s2.recentForm} /></div>
          </div>

          <div className="mt-4 border-t border-line/50 pt-4">
            <EloComparisonChart
              p1Name={m.p1Name} p2Name={m.p2Name}
              rows={[
                { label: 'Global', p1: s1.eloOverall, p2: s2.eloOverall },
                ...(m.surface ? [{ label: SURFACE_ES[m.surface] ?? m.surface, p1: s1.eloSurface, p2: s2.eloSurface }] : []),
                { label: 'Últimos 2 años', p1: s1.eloRecent, p2: s2.eloRecent },
              ]}
            />
          </div>
        </div>

        {/* MARKET + CUOTAS — columna angosta, junto al pronóstico */}
        <div className="flex flex-col gap-4 lg:col-span-5">
          {m.market && (
            <div className="card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-sm font-semibold text-ink">Mercado</h2>
                <span className={`chip ${VALUE_TIER_STYLE[m.market.tier] ?? 'bg-surface-2 text-ink-muted'}`}>{m.market.tierLabel}</span>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-2xs uppercase tracking-wide text-ink-faint">Tenismo</div>
                  <div className="font-mono text-lg tabular-nums text-court">{pctP1 !== null ? `${pctP1}%` : '—'}</div>
                </div>
                <div>
                  <div className="text-2xs uppercase tracking-wide text-ink-faint">Cuota justa</div>
                  <div className="font-mono text-lg tabular-nums text-ink">{odds2(m.market.fairOddsModel)}</div>
                </div>
                <div>
                  <div className="text-2xs uppercase tracking-wide text-ink-faint">Mercado sin vig</div>
                  <div className="font-mono text-lg tabular-nums text-ink">{m.market.noVigProb !== null ? pct(m.market.noVigProb) : '—'}</div>
                </div>
                <div>
                  <div className="text-2xs uppercase tracking-wide text-ink-faint">Edge</div>
                  <div className={`font-mono text-lg tabular-nums ${(m.market.edgePp ?? 0) > 0 ? 'text-court' : 'text-ink-muted'}`}>
                    {m.market.edgePp !== null ? signedPct(m.market.edgePp / 100) : '—'}
                  </div>
                </div>
              </div>
              {m.market.ev !== null && (
                <p className="mt-3 text-2xs leading-relaxed text-ink-faint">
                  EV = {(m.market.ev * 100).toFixed(1)}% sobre la mejor cuota disponible para {m.p1Name}.
                  El modelo suele estar peor calibrado que el cierre de mercado: un edge grande es más señal
                  de error del modelo que de value real — nunca es una recomendación de apuesta.
                </p>
              )}
              {m.market.tier === 'SIN_CUOTA' && (
                <p className="mt-3 text-2xs leading-relaxed text-ink-faint">Sin cuota de {m.p1Name} disponible: solo se muestra la cuota justa del modelo.</p>
              )}
            </div>
          )}

          {m.odds.length > 0 && (
            <div className="card p-4">
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

        {/* WHY X% — un tercio */}
        {m.waterfall && m.waterfall.steps.length > 0 ? (
          <div className="card p-4 lg:col-span-4">
            <h2 className="mb-1 font-display text-sm font-semibold text-ink">Qué pesa en el pronóstico</h2>
            <p className="mb-2 text-2xs text-ink-faint">
              Puntos porcentuales sobre 50%; la suma reconcilia exacto con el {pctP1}% final (waterfall, no aproximación).
            </p>
            <PredictionFactorsChart
              p1Name={m.p1Name} p2Name={m.p2Name}
              factors={m.waterfall.steps
                .filter((s) => Math.abs(s.pp) > 0.05)
                .map((s) => ({ name: s.name, label: FEATURE_ES[s.name] ?? s.name, pp: s.pp }))}
            />
            {m.reasons.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-line/50 pt-3 text-2xs text-ink-muted">
                {m.reasons.slice(0, 4).map((r, i) => (
                  <li key={i} className="flex gap-1.5"><span className="text-court">·</span><span>{r}</span></li>
                ))}
              </ul>
            )}
          </div>
        ) : m.reasons.length > 0 ? (
          <div className="card p-4 lg:col-span-4">
            <h2 className="mb-2 font-display text-sm font-semibold text-ink">En palabras</h2>
            <ul className="space-y-1.5 text-sm text-ink-muted">
              {m.reasons.map((r, i) => (
                <li key={i} className="flex gap-2"><span className="text-court">·</span><span>{r}</span></li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* EXPECTED MATCH — juegos probables, un tercio */}
        <div className="card p-4 lg:col-span-4">
          <h2 className="mb-1 font-display text-sm font-semibold text-ink">Juegos probables</h2>
          {m.expectedGames ? (
            <>
              <p className="mb-2 text-2xs leading-relaxed text-ink-faint">
                Media <span className="font-mono text-ink">{m.expectedGames.meanGames.toFixed(1)}</span> (±{m.expectedGames.sdGames.toFixed(1)}),
                rango <span className="font-mono text-ink">{m.expectedGames.rangeLow}–{m.expectedGames.rangeHigh}</span>. Estimación Tenismo.
              </p>
              <ExpectedGamesChart dist={m.expectedGames} />
              <div className="mt-2 grid grid-cols-3 gap-1 text-2xs">
                {m.expectedGames.overUnder.map((row) => (
                  <div key={row.line} className="flex items-center justify-between rounded-md bg-surface-2/50 px-1.5 py-1">
                    <span className="text-ink-faint">+{row.line}</span>
                    <span className="font-mono tabular-nums text-ink">{pct(row.over)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <ChartEmpty message="Sin datos de saque/resto suficientes para simular el partido." />
          )}
        </div>

        {/* EXPECTED ACES — aces probables, un tercio */}
        <div className="card p-4 lg:col-span-4">
          <h2 className="mb-1 font-display text-sm font-semibold text-ink">Aces probables</h2>
          {m.expectedAces ? (
            <>
              <p className="mb-2 text-2xs leading-relaxed text-ink-faint">
                Histórica: {m.p1Name.split(' ')[0]} {pct(m.expectedAces.historicalRateP1.value ?? 0, 1)} · {m.p2Name.split(' ')[0]} {pct(m.expectedAces.historicalRateP2.value ?? 0, 1)}/juego.
                Total esperado <span className="font-mono text-ink">{m.expectedAces.totalExpected.toFixed(1)}</span> (estimación).
              </p>
              <ExpectedAcesChart
                p1={{ name: m.p1Name, expected: m.expectedAces.p1.expected, atLeast3: m.expectedAces.p1.atLeast3, atLeast5: m.expectedAces.p1.atLeast5, atLeast7: m.expectedAces.p1.atLeast7 }}
                p2={{ name: m.p2Name, expected: m.expectedAces.p2.expected, atLeast3: m.expectedAces.p2.atLeast3, atLeast5: m.expectedAces.p2.atLeast5, atLeast7: m.expectedAces.p2.atLeast7 }}
              />
              <div className="mt-2 grid grid-cols-2 gap-1 text-2xs">
                {m.expectedAces.totalOverUnder.map((row) => (
                  <div key={row.line} className="flex items-center justify-between rounded-md bg-surface-2/50 px-1.5 py-1">
                    <span className="text-ink-faint">+{row.line}</span>
                    <span className="font-mono tabular-nums text-ink">{pct(row.over)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <ChartEmpty message="Sin muestra de saque suficiente (mínimo de juegos al saque no alcanzado por alguno de los dos)." />
          )}
        </div>

        {/* SERVE/RETURN — ancho completo (radar + barras necesitan espacio) */}
        <div className="card p-4 lg:col-span-12">
          <h2 className="mb-1 font-display text-sm font-semibold text-ink">Diagnóstico de saque y resto</h2>
          <p className="mb-3 text-2xs text-ink-faint">Global de carrera (Tennis Abstract), no por superficie.</p>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,17rem)_1fr]">
            <ServeReturnRadarChart
              p1Name={m.p1Name} p2Name={m.p2Name}
              metrics={[
                { label: '1er saque dentro', p1: m.serveReturnP1.firstServeIn, p2: m.serveReturnP2.firstServeIn },
                { label: 'Gana con 1er saque', p1: m.serveReturnP1.firstServeWon, p2: m.serveReturnP2.firstServeWon },
                { label: 'Gana con 2º saque', p1: m.serveReturnP1.secondServeWon, p2: m.serveReturnP2.secondServeWon },
                { label: 'BP salvados', p1: m.serveReturnP1.breakPointsSaved, p2: m.serveReturnP2.breakPointsSaved },
              ]}
            />
            <ServeReturnComparisonChart
              p1Name={m.p1Name} p2Name={m.p2Name}
              rows={[
                { label: 'Aces / partido', p1: m.serveReturnP1.acesPerMatch, p2: m.serveReturnP2.acesPerMatch, isRate: false },
                { label: 'Dobles faltas / partido', p1: m.serveReturnP1.doubleFaultsPerMatch, p2: m.serveReturnP2.doubleFaultsPerMatch, isRate: false },
                { label: '1er saque dentro', p1: m.serveReturnP1.firstServeIn, p2: m.serveReturnP2.firstServeIn, isRate: true },
                { label: 'Gana con 1er saque', p1: m.serveReturnP1.firstServeWon, p2: m.serveReturnP2.firstServeWon, isRate: true },
                { label: 'Gana con 2º saque', p1: m.serveReturnP1.secondServeWon, p2: m.serveReturnP2.secondServeWon, isRate: true },
                { label: 'BP salvados', p1: m.serveReturnP1.breakPointsSaved, p2: m.serveReturnP2.breakPointsSaved, isRate: true },
              ]}
            />
          </div>
        </div>

        {/* Head-to-head — ancho completo */}
        {(m.h2hP1Wins + m.h2hP2Wins) > 0 && (
          <div className="card p-4 lg:col-span-12">
            <h2 className="mb-3 font-display text-sm font-semibold text-ink">Head-to-head</h2>
            <div className="mb-3 flex items-center justify-center gap-4">
              <span className="font-mono text-2xl tabular-nums text-court">{m.h2hP1Wins}</span>
              <span className="text-2xs uppercase tracking-widest text-ink-faint">enfrentamientos</span>
              <span className="font-mono text-2xl tabular-nums text-ink-muted">{m.h2hP2Wins}</span>
            </div>
            {m.surface && (m.h2h.some((meet) => meet.surface && meet.surface !== m.surface)) && (
              <p className="mb-3 rounded-lg border border-line/60 bg-surface-2/40 px-3 py-2 text-2xs text-ink-faint">
                Ojo: no todos estos duelos se jugaron en {SURFACE_ES[m.surface]?.toLowerCase() ?? m.surface}. Un historial
                en otra superficie no se traslada igual a esta.
              </p>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              {m.h2hStats && (
                <div className="rounded-lg border border-line bg-surface-2/40 p-3">
                  <div className="mb-2 flex items-baseline justify-between text-2xs text-ink-faint">
                    <span className="uppercase tracking-wide">Cómo juegan entre ellos</span>
                    <span>{m.h2hStats.withStats} {m.h2hStats.withStats === 1 ? 'duelo' : 'duelos'} con datos</span>
                  </div>
                  <table className="w-full text-2xs">
                    <thead>
                      <tr className="text-ink-faint">
                        <th className="w-1/3 text-left font-normal" />
                        <th className="text-right font-normal">{m.p1Name}</th>
                        <th className="text-right font-normal">{m.p2Name}</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tabular-nums">
                      {([
                        ['Aces por partido', 'acesPerMatch', (x: number) => x.toFixed(1)],
                        ['1er saque dentro', 'firstInPct', (x: number) => `${x.toFixed(0)}%`],
                        ['Gana con 1º', 'firstWonPct', (x: number) => `${x.toFixed(0)}%`],
                        ['Gana con 2º', 'secondWonPct', (x: number) => `${x.toFixed(0)}%`],
                        ['BP salvados', 'bpSavedPct', (x: number) => `${x.toFixed(0)}%`],
                        ['BP convertidos', 'bpConvertedPct', (x: number) => `${x.toFixed(0)}%`],
                      ] as const).map(([etiqueta, campo, fmt]) => {
                        const a = m.h2hStats!.p1[campo];
                        const b = m.h2hStats!.p2[campo];
                        return (
                          <tr key={campo} className="border-t border-line/40">
                            <td className="py-1 font-sans text-ink-muted">{etiqueta}</td>
                            <td className={`py-1 text-right ${a > b ? 'font-semibold text-court' : 'text-ink-muted'}`}>{fmt(a)}</td>
                            <td className={`py-1 text-right ${b > a ? 'font-semibold text-court' : 'text-ink-muted'}`}>{fmt(b)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <ul className="divide-y divide-line/50 text-sm">
                {m.h2h.slice(0, 8).map((meet) => {
                  const fila = (
                    <>
                      <span className="text-ink">{meet.winnerName}</span>
                      <span className="text-2xs text-ink-faint">
                        {' · '}{meet.tournament} {meet.playedOn.slice(0, 4)}
                        {meet.surface ? ` · ${SURFACE_ES[meet.surface] ?? meet.surface}` : ''}
                        {meet.matchId === null && ' · histórico'}
                      </span>
                    </>
                  );
                  return (
                    <li key={meet.key} className="flex items-center justify-between gap-2 py-1.5">
                      {meet.matchId !== null ? (
                        <a href={`/match/${meet.matchId}`} className="min-w-0 truncate text-ink-muted no-underline hover:text-court-ink">{fila}</a>
                      ) : (
                        <span className="min-w-0 truncate text-ink-muted">{fila}</span>
                      )}
                      <span className="shrink-0 font-mono text-2xs tabular-nums text-ink-muted">{meet.score}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
