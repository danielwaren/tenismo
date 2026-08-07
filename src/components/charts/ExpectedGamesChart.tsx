import { AreaChart, Area, XAxis, YAxis, ReferenceLine, ReferenceArea } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../ui/chart';
import { chartColor, fmtPct, ChartEmpty } from './theme';
import type { ExpectedGamesDistribution } from '@tti/model';

const chartConfig = {
  probability: { label: 'Probabilidad', color: chartColor.p1 },
} satisfies ChartConfig;

/**
 * Distribución de juegos totales del partido — de una simulación Monte Carlo
 * real (`simulateMatch`, motor punto a punto), no un número inventado. Área
 * en vez de barras: se lee mejor como "distribución" continua, con el rango
 * principal (percentil 25-75) resaltado y la media marcada.
 */
export default function ExpectedGamesChart({ dist }: { dist: ExpectedGamesDistribution | null }) {
  if (!dist) return <ChartEmpty message="Sin estadísticas de saque suficientes para simular el partido." />;

  const { histogram, meanGames, rangeLow, rangeHigh } = dist;
  const relevant = histogram.filter((h) => h.probability >= 0.003);

  return (
    <ChartContainer config={chartConfig} className="w-full" style={{ height: 200 }}>
      <AreaChart data={relevant} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
        <defs>
          <linearGradient id="gamesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={chartColor.p1} stopOpacity={0.5} />
            <stop offset="95%" stopColor={chartColor.p1} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="games" tick={{ fill: chartColor.inkMuted, fontSize: 11 }}
          axisLine={{ stroke: chartColor.line }} tickLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => fmtPct(v)}
          tick={{ fill: chartColor.inkFaint, fontSize: 10 }}
          axisLine={false} tickLine={false} width={40}
        />
        <ReferenceArea x1={rangeLow} x2={rangeHigh} fill={chartColor.p1} fillOpacity={0.08} strokeOpacity={0} />
        <ReferenceLine x={Math.round(meanGames)} stroke={chartColor.p1} strokeDasharray="3 3" />
        <ChartTooltip
          content={<ChartTooltipContent labelFormatter={(l) => `${l} juegos`} formatter={(v) => [fmtPct(Number(v), 1), ' Probabilidad']} />}
          cursor={{ stroke: chartColor.line }}
        />
        <Area type="monotone" dataKey="probability" stroke={chartColor.p1} strokeWidth={2} fill="url(#gamesFill)" />
      </AreaChart>
    </ChartContainer>
  );
}
