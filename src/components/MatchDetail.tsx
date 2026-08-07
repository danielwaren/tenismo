import type { MatchDetail } from '../lib/queries';
import { surfaceLabel, fmtDate, pct, signedPct, SURFACE_ES, tourChip } from '../lib/format';
import { playerPath } from '../lib/urls';
import PredictionFactorsChart from './charts/PredictionFactorsChart';
import PlayerComparisonChart from './charts/PlayerComparisonChart';
import ExpectedGamesChart from './charts/ExpectedGamesChart';
import ExpectedAcesChart from './charts/ExpectedAcesChart';
import ServeReturnComparisonChart from './charts/ServeReturnComparisonChart';
import ServeReturnRadarChart from './charts/ServeReturnRadarChart';
import KpiRingCard from './charts/KpiRingCard';
import KpiStatCard from './charts/KpiStatCard';
import { chartColor, ChartEmpty } from './charts/theme';

/**
 * Ficha de partido — pantalla de inteligencia de tenis.
 *
 * Layout de dashboard denso, en tres bandas de lectura:
 *   1. Tira de KPIs (favorito, confianza, cuota justa, edge, juegos, aces).
 *   2. Cabecera del partido + comparativa de jugadores + mercado.
 *   3. Los tres análisis del modelo (factores, juegos, aces) en una fila, y
 *      saque/resto + head-to-head en otra.
 *
 * Todos los gráficos usan ChartContainer/ChartConfig de shadcn/ui
 * (src/components/ui/chart.tsx) sobre Recharts — ninguno es CSS/SVG a mano.
 * En pantallas chicas todo se apila a ancho completo: no se elimina
 * información para que quepa, solo se reparte el espacio.
 *
 * Todo lo etiquetado "Estimación Tenismo" sale de un cálculo propio (Elo,
 * motor punto a punto, Poisson sobre una media ajustada); lo demás viene de
 * datos observados (Tennis Abstract, ranking oficial, cuotas reales).
 */

const FEATURE_ES: Record<string, string> = {
  eloDiffSurface: 'Elo en la superficie', eloDiffOverall: 'Elo global',
  rankLogDiff: 'Ranking oficial', pointsLogDiff: 'Puntos de ranking',
  h2h: 'Head-to-head', h2hSurface: 'H2H en la superficie',
  loadDiff: 'Carga reciente', intensityDiff: 'Intensidad reciente',
  restDiff: 'Descanso', formDiff: 'Forma reciente', expDiff: 'Experiencia',
  surfaceExpDiff: 'Experiencia en superficie', bestOf5EloDiff: 'Ventaja al mejor de 5',
  markovLogit: 'Motor punto a punto',
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

/** Celda compacta etiqueta+valor, el patrón de dato suelto de toda la ficha. */
function Metric({ label, value, tone = 'text-ink' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className={`truncate font-mono text-base tabular-nums ${tone}`}>{value}</div>
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
  const surfaceEs = m.surface ? (SURFACE_ES[m.surface]?.toLowerCase() ?? m.surface) : null;

  const serveMetrics = [
    { label: '1er saque dentro', p1: m.serveReturnP1.firstServeIn, p2: m.serveReturnP2.firstServeIn },
    { label: 'Gana con 1er saque', p1: m.serveReturnP1.firstServeWon, p2: m.serveReturnP2.firstServeWon },
    { label: 'Gana con 2º saque', p1: m.serveReturnP1.secondServeWon, p2: m.serveReturnP2.secondServeWon },
    { label: 'BP salvados', p1: m.serveReturnP1.breakPointsSaved, p2: m.serveReturnP2.breakPointsSaved },
  ];
  const haySaque = serveMetrics.some((x) => x.p1 !== null || x.p2 !== null);

  return (
    <div>
      <a href="/" className="mb-3 inline-flex items-center gap-1 text-sm text-court-ink no-underline hover:text-court">← Volver</a>

      {/* ── KPIs: lectura inmediata, sin bajar la página ─────────────────────
          Anillo solo donde la métrica está realmente acotada a 0-100
          (probabilidad, confianza). Cuota, edge, juegos y aces no tienen tope
          natural: darles un anillo de "progreso" inventaría una proporción
          que el dato no tiene, así que van como tarjeta plana. */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {pctP1 !== null && favoriteName && (
          <KpiRingCard
            ringPct={Math.max(pctP1, 100 - pctP1)}
            color={chartColor.p1}
            big={favoriteName.split(' ')[0]}
            label="Favorito"
          />
        )}
        {m.confidenceDetail && (
          <KpiRingCard
            ringPct={m.confidenceDetail.score}
            color={m.confidenceDetail.band === 'BAJA' ? chartColor.live : chartColor.p1}
            big={m.confidenceDetail.band}
            label="Confianza"
          />
        )}
        <KpiStatCard big={odds2(m.market?.fairOddsModel ?? null)} label="Cuota justa" accent="bg-court" />
        <KpiStatCard
          big={m.market?.edgePp != null ? signedPct(m.market.edgePp / 100) : '—'}
          label={m.market?.tierLabel ?? 'Edge'}
          accent={(m.market?.edgePp ?? 0) > 0 ? 'bg-court' : 'bg-ink-faint'}
        />
        <KpiStatCard big={m.expectedGames ? m.expectedGames.meanGames.toFixed(1) : '—'} label="Juegos esperados" accent="bg-hard" />
        <KpiStatCard big={m.expectedAces ? m.expectedAces.totalExpected.toFixed(1) : '—'} label="Aces esperados" accent="bg-clay" />
      </div>

      {/* Sin `items-start`: las tarjetas de una misma fila se estiran a la
          misma altura. Con alturas naturales, una sección sin datos (aces sin
          muestra, p. ej.) dejaba la fila con la base dentada. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* ── Cabecera del partido ──────────────────────────────────────── */}
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
            {[{ id: m.p1Id, slug: m.p1Slug, name: m.p1Name, won: played && p1Won, sets: m.sets.map((s) => s.p1), prob: pctP1, mine: true },
              { id: m.p2Id, slug: m.p2Slug, name: m.p2Name, won: played && !p1Won, sets: m.sets.map((s) => s.p2), prob: pctP1 === null ? null : 100 - pctP1, mine: false }]
              .map((row, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-1">
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
                  {row.prob !== null && (
                    <span className={`w-11 text-right font-mono text-sm tabular-nums ${row.mine ? 'text-court' : 'text-ink-muted'}`}>{row.prob}%</span>
                  )}
                </div>
              </div>
            ))}
            {pctP1 !== null && (
              <div className="mt-1.5 flex h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                <div className="bg-court" style={{ width: `${pctP1}%` }} />
              </div>
            )}
          </div>
        </div>

        {/* ── Comparativa de jugadores (gráfico, no lista) ──────────────── */}
        <div className="card flex flex-col p-4 lg:col-span-8">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-sm font-semibold text-ink">Comparativa de jugadores</h2>
            <span className="text-2xs text-ink-faint">Reparto visual del par en cada métrica; el valor real va dentro de la barra.</span>
          </div>
          <PlayerComparisonChart
            p1Name={m.p1Name} p2Name={m.p2Name}
            metrics={[
              { label: 'Ranking', p1: s1.ranking, p2: s2.ranking, lowerIsBetter: true, p1Text: s1.ranking === null ? '—' : `#${s1.ranking}`, p2Text: s2.ranking === null ? '—' : `#${s2.ranking}` },
              { label: 'Elo global', p1: s1.eloOverall, p2: s2.eloOverall, p1Text: num(s1.eloOverall), p2Text: num(s2.eloOverall) },
              ...(m.surface ? [{ label: `Elo en ${surfaceEs}`, p1: s1.eloSurface, p2: s2.eloSurface, p1Text: num(s1.eloSurface), p2Text: num(s2.eloSurface) }] : []),
              { label: 'Elo últimos 2 años', p1: s1.eloRecent, p2: s2.eloRecent, p1Text: num(s1.eloRecent), p2Text: num(s2.eloRecent) },
              { label: 'Partidos jugados', p1: s1.matches, p2: s2.matches, p1Text: num(s1.matches), p2Text: num(s2.matches) },
              { label: '% victorias', p1: s1.winRate, p2: s2.winRate, p1Text: rate(s1.winRate), p2Text: rate(s2.winRate) },
              ...(m.surface ? [{ label: `% en ${surfaceEs}`, p1: s1.winRateSurface, p2: s2.winRateSurface, p1Text: rate(s1.winRateSurface), p2Text: rate(s2.winRateSurface) }] : []),
              ...(played ? [{ label: 'Juegos ganados', p1: m.gamesP1, p2: m.gamesP2, p1Text: String(m.gamesP1), p2Text: String(m.gamesP2) }] : []),
            ]}
          />
          {(s1.rankingDate || s2.rankingDate) && (
            <p
              className="mt-2 truncate text-center text-[10px] text-ink-faint"
              title={`Ranking oficial más reciente disponible: ${s1.rankingDate ? `${s1.name} al ${fmtDate(s1.rankingDate)}` : `${s1.name} sin dato`} · ${s2.rankingDate ? `${s2.name} al ${fmtDate(s2.rankingDate)}` : `${s2.name} sin dato`}.`}
            >
              Ranking al {s1.rankingDate ? fmtDate(s1.rankingDate) : '—'} / {s2.rankingDate ? fmtDate(s2.rankingDate) : '—'}
            </p>
          )}
        </div>

        {/* ── Mercado + forma + cuotas reales ───────────────────────────── */}
        <div className="flex flex-col gap-4 lg:col-span-4">
          <div className="card p-4">
            <h2 className="mb-2 font-display text-sm font-semibold text-ink">Forma reciente</h2>
            <div className="space-y-1.5">
              {[{ s: s1, name: m.p1Name }, { s: s2, name: m.p2Name }].map(({ s, name }) => (
                <div key={name} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-2xs text-ink-muted">{name}</span>
                  <FormDots form={s.recentForm} />
                </div>
              ))}
            </div>
          </div>

          {m.market && (
            <div className="card p-4">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-sm font-semibold text-ink">Mercado</h2>
                <span className={`chip ${VALUE_TIER_STYLE[m.market.tier] ?? 'bg-surface-2 text-ink-muted'}`}>{m.market.tierLabel}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                <Metric label="Tenismo" value={pctP1 !== null ? `${pctP1}%` : '—'} tone="text-court" />
                <Metric label="Cuota justa" value={odds2(m.market.fairOddsModel)} />
                <Metric label="Mercado sin vig" value={m.market.noVigProb !== null ? pct(m.market.noVigProb) : '—'} />
                <Metric
                  label="Edge"
                  value={m.market.edgePp !== null ? signedPct(m.market.edgePp / 100) : '—'}
                  tone={(m.market.edgePp ?? 0) > 0 ? 'text-court' : 'text-ink-muted'}
                />
              </div>
              <p className="mt-2.5 border-t border-line/50 pt-2.5 text-[10px] leading-relaxed text-ink-faint">
                {m.market.ev !== null ? (
                  <>EV {(m.market.ev * 100).toFixed(1)}% sobre la mejor cuota de {m.p1Name}. El modelo suele estar peor
                  calibrado que el cierre de mercado: un edge grande es más señal de error del modelo que de value real.</>
                ) : (
                  <>Sin cuota de {m.p1Name} disponible: solo se muestra la cuota justa que implica el modelo.</>
                )}
              </p>
            </div>
          )}

          {m.odds.length > 0 && (
            <div className="card p-4">
              <h2 className="mb-2 font-display text-sm font-semibold text-ink">Cuotas reales</h2>
              <table className="w-full text-2xs">
                <thead className="text-left text-[10px] uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th className="pb-1 pr-2 font-medium">Casa</th>
                    <th className="pb-1 pr-2 text-right font-medium">{m.p1Name.split(' ')[0]}</th>
                    <th className="pb-1 text-right font-medium">{m.p2Name.split(' ')[0]}</th>
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
                      <td className="truncate py-1 pr-2 text-ink-muted">{book}</td>
                      <td className="py-1 pr-2 text-right font-mono tabular-nums text-ink">{sels.p1?.toFixed(2) ?? '—'}</td>
                      <td className="py-1 text-right font-mono tabular-nums text-ink">{sels.p2?.toFixed(2) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Qué pesa en el pronóstico ─────────────────────────────────── */}
        {m.waterfall && m.waterfall.steps.length > 0 ? (
          <div className="card flex flex-col p-4 lg:col-span-4">
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
              <ul className="mt-2.5 space-y-1 border-t border-line/50 pt-2.5 text-2xs text-ink-muted">
                {m.reasons.slice(0, 4).map((r, i) => (
                  <li key={i} className="flex gap-1.5"><span className="text-court">·</span><span>{r}</span></li>
                ))}
              </ul>
            )}
          </div>
        ) : m.reasons.length > 0 ? (
          <div className="card flex flex-col p-4 lg:col-span-4">
            <h2 className="mb-2 font-display text-sm font-semibold text-ink">En palabras</h2>
            <ul className="space-y-1.5 text-2xs text-ink-muted">
              {m.reasons.map((r, i) => (
                <li key={i} className="flex gap-2"><span className="text-court">·</span><span>{r}</span></li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* ── Juegos probables ──────────────────────────────────────────── */}
        <div className="card flex flex-col p-4 lg:col-span-4">
          <h2 className="mb-1 font-display text-sm font-semibold text-ink">Juegos probables</h2>
          {m.expectedGames ? (
            <>
              <p className="mb-1.5 text-2xs leading-relaxed text-ink-faint">
                Media <span className="font-mono text-ink">{m.expectedGames.meanGames.toFixed(1)}</span> (±{m.expectedGames.sdGames.toFixed(1)}),
                rango <span className="font-mono text-ink">{m.expectedGames.rangeLow}–{m.expectedGames.rangeHigh}</span>. Estimación Tenismo.
              </p>
              <ExpectedGamesChart dist={m.expectedGames} />
              <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]">
                {m.expectedGames.overUnder.map((row) => (
                  <div key={row.line} className="flex items-center justify-between rounded-md bg-surface-2/50 px-1.5 py-1">
                    <span className="text-ink-faint">+{row.line}</span>
                    <span className="font-mono tabular-nums text-ink">{pct(row.over, 0)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <ChartEmpty message="Sin estadísticas de saque suficientes para simular el partido." />
          )}
        </div>

        {/* ── Aces probables ────────────────────────────────────────────── */}
        <div className="card flex flex-col p-4 lg:col-span-4">
          <h2 className="mb-1 font-display text-sm font-semibold text-ink">Aces probables</h2>
          {m.expectedAces ? (
            <>
              <p className="mb-1.5 text-2xs leading-relaxed text-ink-faint">
                Histórica: {m.p1Name.split(' ')[0]} {pct(m.expectedAces.historicalRateP1.value ?? 0, 1)} · {m.p2Name.split(' ')[0]} {pct(m.expectedAces.historicalRateP2.value ?? 0, 1)} por juego.
                Total esperado <span className="font-mono text-ink">{m.expectedAces.totalExpected.toFixed(1)}</span> (estimación).
              </p>
              <ExpectedAcesChart
                p1={{ name: m.p1Name, expected: m.expectedAces.p1.expected, atLeast3: m.expectedAces.p1.atLeast3, atLeast5: m.expectedAces.p1.atLeast5, atLeast7: m.expectedAces.p1.atLeast7 }}
                p2={{ name: m.p2Name, expected: m.expectedAces.p2.expected, atLeast3: m.expectedAces.p2.atLeast3, atLeast5: m.expectedAces.p2.atLeast5, atLeast7: m.expectedAces.p2.atLeast7 }}
              />
              <div className="mt-2 grid grid-cols-4 gap-1 text-[10px]">
                {m.expectedAces.totalOverUnder.map((row) => (
                  <div key={row.line} className="flex items-center justify-between rounded-md bg-surface-2/50 px-1.5 py-1">
                    <span className="text-ink-faint">+{row.line}</span>
                    <span className="font-mono tabular-nums text-ink">{pct(row.over, 0)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <ChartEmpty message="Sin muestra de saque suficiente: alguno de los dos no llega al mínimo de juegos al saque registrados." />
          )}
        </div>

        {/* ── Saque y resto ─────────────────────────────────────────────── */}
        <div className="card flex flex-col p-4 lg:col-span-6">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-sm font-semibold text-ink">Saque y resto</h2>
            <span className="text-[10px] text-ink-faint">Global de carrera · Tennis Abstract</span>
          </div>
          {haySaque ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <ServeReturnRadarChart p1Name={m.p1Name} p2Name={m.p2Name} metrics={serveMetrics} />
              <ServeReturnComparisonChart
                p1Name={m.p1Name} p2Name={m.p2Name}
                rows={[
                  { label: 'Aces / partido', p1: m.serveReturnP1.acesPerMatch, p2: m.serveReturnP2.acesPerMatch, isRate: false },
                  { label: 'Dobles faltas / partido', p1: m.serveReturnP1.doubleFaultsPerMatch, p2: m.serveReturnP2.doubleFaultsPerMatch, isRate: false },
                  ...serveMetrics.map((x) => ({ ...x, isRate: true })),
                ]}
              />
            </div>
          ) : (
            <ChartEmpty message="Ninguno de los dos tiene estadísticas de saque y resto registradas en Tennis Abstract." />
          )}
        </div>

        {/* ── Head-to-head ──────────────────────────────────────────────── */}
        <div className="card flex flex-col p-4 lg:col-span-6">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-sm font-semibold text-ink">Head-to-head</h2>
            {(m.h2hP1Wins + m.h2hP2Wins) > 0 && (
              <span className="font-mono text-2xs tabular-nums text-ink-muted">
                <span className="text-court">{m.h2hP1Wins}</span>–{m.h2hP2Wins} · {m.h2hP1Wins + m.h2hP2Wins} {m.h2hP1Wins + m.h2hP2Wins === 1 ? 'duelo' : 'duelos'}
              </span>
            )}
          </div>

          {(m.h2hP1Wins + m.h2hP2Wins) === 0 ? (
            <ChartEmpty message="Estos dos jugadores no se han enfrentado antes en los registros de Tenismo." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                {m.surface && m.h2h.some((meet) => meet.surface && meet.surface !== m.surface) && (
                  <p className="mb-2 rounded-md border border-line/60 bg-surface-2/40 px-2 py-1.5 text-[10px] leading-relaxed text-ink-faint">
                    No todos estos duelos fueron en {surfaceEs}: un historial en otra superficie no se traslada igual.
                  </p>
                )}
                <ul className="divide-y divide-line/50 text-2xs">
                  {m.h2h.slice(0, 5).map((meet) => {
                    const fila = (
                      <>
                        <span className="text-ink">{meet.winnerName}</span>
                        <span className="text-ink-faint">
                          {' · '}{meet.tournament} {meet.playedOn.slice(0, 4)}
                          {meet.surface ? ` · ${SURFACE_ES[meet.surface] ?? meet.surface}` : ''}
                          {meet.matchId === null && ' · histórico'}
                        </span>
                      </>
                    );
                    return (
                      <li key={meet.key} className="flex items-center justify-between gap-2 py-1">
                        {meet.matchId !== null ? (
                          <a href={`/match/${meet.matchId}`} className="min-w-0 truncate text-ink-muted no-underline hover:text-court-ink">{fila}</a>
                        ) : (
                          <span className="min-w-0 truncate text-ink-muted">{fila}</span>
                        )}
                        <span className="shrink-0 font-mono tabular-nums text-ink-muted">{meet.score}</span>
                      </li>
                    );
                  })}
                </ul>
                {m.h2h.length > 5 && (
                  <p className="mt-1 text-right text-[10px] text-ink-faint">+{m.h2h.length - 5} duelos anteriores</p>
                )}
              </div>

              {m.h2hStats && (
                <div className="rounded-lg border border-line bg-surface-2/40 p-2.5">
                  <div className="mb-1.5 flex items-baseline justify-between text-[10px] text-ink-faint">
                    <span className="uppercase tracking-wide">Cómo juegan entre ellos</span>
                    <span>{m.h2hStats.withStats} con datos</span>
                  </div>
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="text-ink-faint">
                        <th className="w-1/2 text-left font-normal" />
                        <th className="text-right font-normal">{m.p1Name.split(' ')[0]}</th>
                        <th className="text-right font-normal">{m.p2Name.split(' ')[0]}</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tabular-nums">
                      {([
                        ['Aces / partido', 'acesPerMatch', (x: number) => x.toFixed(1)],
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
                            <td className="py-0.5 font-sans text-ink-muted">{etiqueta}</td>
                            <td className={`py-0.5 text-right ${a > b ? 'font-semibold text-court' : 'text-ink-muted'}`}>{fmt(a)}</td>
                            <td className={`py-0.5 text-right ${b > a ? 'font-semibold text-court' : 'text-ink-muted'}`}>{fmt(b)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
