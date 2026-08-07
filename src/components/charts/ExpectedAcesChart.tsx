import { BarChart, Bar, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, type ChartConfig } from '../ui/chart';
import { chartColor, fmtPct, ChartEmpty } from './theme';

export interface AcePlayerDatum {
  name: string;
  expected: number;
  atLeast3: number | null;
  atLeast5: number | null;
  atLeast7: number | null;
}

/**
 * Comparativa de aces esperados. "Esperados" es la ESTIMACIÓN Tenismo
 * (proyección ajustada por rival); las probabilidades 3+/5+/7+ vienen de
 * `acesAtLeastBreakdown` (Poisson sobre esa misma media) — nunca se muestran
 * si la muestra no es fiable (ver `reliable` en el llamador).
 */
export default function ExpectedAcesChart({ p1, p2 }: { p1: AcePlayerDatum; p2: AcePlayerDatum }) {
  const hasThresholds = p1.atLeast3 !== null && p2.atLeast3 !== null;
  const expectedConfig = {
    expected: { label: 'Aces esperados', color: chartColor.p1 },
  } satisfies ChartConfig;
  const thresholdConfig = {
    [p1.name]: { label: p1.name, color: chartColor.p1 },
    [p2.name]: { label: p2.name, color: chartColor.p2 },
  } satisfies ChartConfig;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <p className="mb-1 text-2xs uppercase tracking-wide text-ink-faint">Aces esperados</p>
        <ChartContainer config={expectedConfig} className="w-full" style={{ height: 96 }}>
          <BarChart data={[p1, p2]} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={90} tick={{ fill: chartColor.inkMuted, fontSize: 11 }} axisLine={false} tickLine={false} />
            <ChartTooltip content={<ChartTooltipContent hideLabel formatter={(v) => [Number(v).toFixed(1), ' Esperados']} />} cursor={{ fill: chartColor.surface2, opacity: 0.4 }} />
            <Bar dataKey="expected" radius={3} maxBarSize={22} fill={chartColor.p1} />
          </BarChart>
        </ChartContainer>
      </div>

      {hasThresholds ? (
        <div>
          <p className="mb-1 text-2xs uppercase tracking-wide text-ink-faint">P(al menos N aces)</p>
          <ChartContainer config={thresholdConfig} className="w-full" style={{ height: 96 }}>
            <BarChart
              data={[
                { threshold: '3+', [p1.name]: p1.atLeast3, [p2.name]: p2.atLeast3 },
                { threshold: '5+', [p1.name]: p1.atLeast5, [p2.name]: p2.atLeast5 },
                { threshold: '7+', [p1.name]: p1.atLeast7, [p2.name]: p2.atLeast7 },
              ]}
              margin={{ top: 4, right: 8, bottom: 0, left: -20 }}
            >
              <XAxis dataKey="threshold" tick={{ fill: chartColor.inkMuted, fontSize: 11 }} axisLine={{ stroke: chartColor.line }} tickLine={false} />
              <YAxis tickFormatter={(v: number) => fmtPct(v)} tick={{ fill: chartColor.inkFaint, fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
              <ChartTooltip content={<ChartTooltipContent formatter={(v) => fmtPct(Number(v), 1)} />} cursor={{ fill: chartColor.surface2, opacity: 0.4 }} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey={p1.name} fill={chartColor.p1} radius={[3, 3, 0, 0]} maxBarSize={14} />
              <Bar dataKey={p2.name} fill={chartColor.p2} radius={[3, 3, 0, 0]} maxBarSize={14} />
            </BarChart>
          </ChartContainer>
        </div>
      ) : (
        <ChartEmpty message="Muestra insuficiente para probabilidades por umbral (estimación Tenismo)." />
      )}
    </div>
  );
}
