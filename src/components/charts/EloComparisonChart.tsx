import { BarChart, Bar, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, type ChartConfig } from '../ui/chart';
import { chartColor, ChartEmpty } from './theme';

export interface EloRow {
  label: string;
  p1: number | null;
  p2: number | null;
}

/**
 * Comparativa de Elo (global / superficie / últimos 2 años) entre los dos
 * jugadores. Mismos números que ya muestra "Pronóstico Tenismo" en texto —
 * este gráfico es un complemento visual.
 */
export default function EloComparisonChart({ rows, p1Name, p2Name }: { rows: EloRow[]; p1Name: string; p2Name: string }) {
  const data = rows.filter((r) => r.p1 !== null || r.p2 !== null);
  if (!data.length) return <ChartEmpty message="Sin datos de Elo para comparar." />;

  const config = {
    [p1Name]: { label: p1Name, color: chartColor.p1 },
    [p2Name]: { label: p2Name, color: chartColor.p2 },
  } satisfies ChartConfig;
  const renamed = data.map((r) => ({ label: r.label, [p1Name]: r.p1, [p2Name]: r.p2 }));

  return (
    <ChartContainer config={config} className="w-full" style={{ height: Math.max(72, data.length * 30) }}>
      <BarChart data={renamed} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
        <XAxis type="number" domain={['dataMin - 40', 'dataMax + 40']} hide />
        <YAxis type="category" dataKey="label" width={110} tick={{ fill: chartColor.inkMuted, fontSize: 11 }} axisLine={false} tickLine={false} />
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => Math.round(Number(v))} />} cursor={{ fill: chartColor.surface2, opacity: 0.4 }} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey={p1Name} fill={chartColor.p1} radius={[0, 3, 3, 0]} maxBarSize={14} />
        <Bar dataKey={p2Name} fill={chartColor.p2} radius={[0, 3, 3, 0]} maxBarSize={14} />
      </BarChart>
    </ChartContainer>
  );
}
