import { BarChart, Bar, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, type ChartConfig } from '../ui/chart';
import { chartColor, fmtPct, ChartEmpty } from './theme';

export interface ServeReturnRow {
  label: string;
  p1: number | null;
  p2: number | null;
  /** true = valor en 0-1 (se formatea como %); false = cifra cruda (p.ej. aces por partido). */
  isRate: boolean;
}

/**
 * Cifras exactas de saque y resto, en barras — complemento del radar (que da
 * la forma general pero recorta a escala 0-100). Todo lo disponible en
 * `match_stats` (Tennis Abstract), global por jugador; `null` cuando no hay
 * muestra, y esa fila simplemente no se pinta.
 */
export default function ServeReturnComparisonChart({ rows, p1Name, p2Name }: { rows: ServeReturnRow[]; p1Name: string; p2Name: string }) {
  const data = rows.filter((r) => r.p1 !== null || r.p2 !== null);
  if (!data.length) return <ChartEmpty message="Sin estadísticas de saque/resto disponibles para ninguno de los dos." />;

  const config = {
    [p1Name]: { label: p1Name, color: chartColor.p1 },
    [p2Name]: { label: p2Name, color: chartColor.p2 },
  } satisfies ChartConfig;
  const renamed = data.map((r) => ({ label: r.label, [p1Name]: r.p1, [p2Name]: r.p2, isRate: r.isRate }));

  return (
    <ChartContainer config={config} className="w-full" style={{ height: Math.max(90, data.length * 24) }}>
      <BarChart data={renamed} layout="vertical" margin={{ top: 4, right: 20, bottom: 4, left: 4 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" width={120} tick={{ fill: chartColor.inkMuted, fontSize: 11 }} axisLine={false} tickLine={false} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(v, _n, entry) => {
                const row = (entry as { payload?: ServeReturnRow })?.payload;
                const num = Number(v);
                return row?.isRate ? fmtPct(num, 1) : num.toFixed(2);
              }}
            />
          }
          cursor={{ fill: chartColor.surface2, opacity: 0.4 }}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey={p1Name} fill={chartColor.p1} radius={[0, 3, 3, 0]} maxBarSize={12} />
        <Bar dataKey={p2Name} fill={chartColor.p2} radius={[0, 3, 3, 0]} maxBarSize={12} />
      </BarChart>
    </ChartContainer>
  );
}
