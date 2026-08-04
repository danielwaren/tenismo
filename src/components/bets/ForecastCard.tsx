import type { ForecastResponse } from './types';
import { pct, signedPct, odds } from './format';
import { CONSENSUS_LABEL } from '../../lib/forecast-compare';

/**
 * Card "Mi pronóstico": modelo de Tenismo, análisis de IA y comparación
 * contra la cuota del mercado, en tres bloques. Nunca presenta nada como
 * certeza — muestra las tres lecturas y su grado de acuerdo.
 */
export default function ForecastCard({
  data,
  loading,
  error,
}: {
  data: ForecastResponse | null;
  loading: boolean;
  error: string | null;
}) {
  const consensusClass: Record<string, string> = {
    AGREE: 'bg-court/15 text-court-ink',
    PARTIAL: 'bg-hard/15 text-hard',
    DISAGREE: 'bg-live/15 text-live',
    INSUFFICIENT: 'bg-surface-2 text-ink-faint',
  };

  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-ink">Mi pronóstico</h2>
        {data && (
          <span className={`chip ${consensusClass[data.comparison.consensus]}`}>
            {CONSENSUS_LABEL[data.comparison.consensus]}
          </span>
        )}
      </div>

      {loading && <p className="text-sm text-ink-muted">Consultando modelo…</p>}
      {error && <p className="text-sm text-live">{error}</p>}
      {!loading && !error && !data && (
        <p className="text-sm leading-relaxed text-ink-faint">
          Completa jugadores, mercado y cuota para ver el contraste entre el modelo de Tenismo,
          el análisis de IA y lo que exige el mercado.
        </p>
      )}

      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          {/* A. Modelo Tenismo */}
          <div className="rounded-lg border border-line bg-surface-2/40 p-3">
            <h3 className="mb-2 text-2xs uppercase tracking-wide text-ink-muted">Modelo Tenismo</h3>
            {data.model.available ? (
              <>
                <div className="font-mono text-xl tabular-nums text-court">{pct(data.model.probability)}</div>
                <dl className="mt-2 space-y-1 text-2xs text-ink-muted">
                  <div className="flex justify-between gap-2">
                    <dt>Cuota justa</dt><dd className="font-mono tabular-nums">{odds(data.model.fairOdds)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>EV</dt>
                    <dd className={`font-mono tabular-nums ${(data.comparison.modelEv ?? 0) >= 0 ? 'text-court' : 'text-live'}`}>
                      {signedPct(data.comparison.modelEv)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Confianza</dt><dd className="font-mono tabular-nums">{pct(data.model.confidence, 0)}</dd>
                  </div>
                  {data.model.suggestedSelection && (
                    <div className="flex justify-between gap-2">
                      <dt>Sugiere</dt><dd className="truncate text-right text-ink">{data.model.suggestedSelection}</dd>
                    </div>
                  )}
                </dl>
                {data.model.reasons && data.model.reasons.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-line pt-2 text-2xs leading-relaxed text-ink-faint">
                    {data.model.reasons.slice(0, 3).map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-2xs leading-relaxed text-ink-faint">
                {data.model.unavailableReason ?? 'Modelo no disponible para este mercado.'}
              </p>
            )}
          </div>

          {/* B. Análisis IA */}
          <div className="rounded-lg border border-line bg-surface-2/40 p-3">
            <h3 className="mb-2 text-2xs uppercase tracking-wide text-ink-muted">Análisis IA</h3>
            {data.aiConfigured ? (
              <>
                <div className="font-mono text-xl tabular-nums text-court">{pct(data.ai.estimatedProbability)}</div>
                <dl className="mt-2 space-y-1 text-2xs text-ink-muted">
                  <div className="flex justify-between gap-2">
                    <dt>Cuota justa</dt><dd className="font-mono tabular-nums">{odds(data.ai.fairOdds)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>EV</dt>
                    <dd className={`font-mono tabular-nums ${(data.comparison.aiEv ?? 0) >= 0 ? 'text-court' : 'text-live'}`}>
                      {signedPct(data.comparison.aiEv)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Acción</dt><dd className="text-ink">{data.ai.action}</dd>
                  </div>
                </dl>
                {data.ai.reasoning && (
                  <p className="mt-2 border-t border-line pt-2 text-2xs leading-relaxed text-ink-faint">{data.ai.reasoning}</p>
                )}
                {data.ai.risks.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-2xs text-ink-faint">
                    {data.ai.risks.map((r, i) => <li key={i}>· {r}</li>)}
                  </ul>
                )}
              </>
            ) : (
              <div className="text-2xs leading-relaxed text-ink-faint">
                <p className="mb-1 text-ink-muted">IA no configurada.</p>
                <p>
                  No hay proveedor de IA conectado en este despliegue. La página funciona igual: el
                  modelo de Tenismo y la comparación con el mercado siguen activos.
                </p>
              </div>
            )}
            {data.ai.updatedAt && (
              <p className="mt-2 text-2xs text-ink-faint">
                Actualizado: {new Date(data.ai.updatedAt).toLocaleTimeString('es-CL')}
              </p>
            )}
          </div>

          {/* C. Comparación */}
          <div className="rounded-lg border border-line bg-surface-2/40 p-3">
            <h3 className="mb-2 text-2xs uppercase tracking-wide text-ink-muted">Comparación</h3>
            <dl className="space-y-1 text-2xs text-ink-muted">
              <div className="flex justify-between gap-2">
                <dt>Cuota mercado</dt>
                <dd className="font-mono tabular-nums text-ink">{odds(data.comparison.marketOdds)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Prob. implícita</dt>
                <dd className="font-mono tabular-nums">{pct(data.comparison.impliedProbability)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Prob. modelo</dt><dd className="font-mono tabular-nums">{pct(data.comparison.modelProbability)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Prob. IA</dt><dd className="font-mono tabular-nums">{pct(data.comparison.aiProbability)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Diferencia</dt><dd className="font-mono tabular-nums">{pct(data.comparison.difference)}</dd>
              </div>
            </dl>
            <p className="mt-2 border-t border-line pt-2 text-2xs leading-relaxed text-ink-faint">
              {data.comparison.explanation}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
