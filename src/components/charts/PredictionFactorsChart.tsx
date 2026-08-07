import { BarChart, Bar, XAxis, YAxis, ReferenceLine, Cell } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../ui/chart';
import { chartColor, fmtSigned, ChartEmpty } from './theme';

export interface FactorDatum {
  name: string;
  label: string;
  pp: number;
}

const chartConfig = {
  pp: { label: 'Impacto' },
} satisfies ChartConfig;

/**
 * "Qué pesa en el pronóstico", en puntos porcentuales — gráfico divergente
 * (izquierda=p2, derecha=p1) con el número exacto de cada barra. Los `pp`
 * vienen del waterfall de `explain.ts`: su suma + 50% reconcilia exactamente
 * con la probabilidad final.
 */
export default function PredictionFactorsChart({
  factors, p1Name, p2Name,
}: { factors: FactorDatum[]; p1Name: string; p2Name: string }) {
  if (!factors.length) return <ChartEmpty message="Sin factores con peso suficiente para mostrar." />;

  const data = [...factors].sort((a, b) => Math.abs(b.pp) - Math.abs(a.pp));
  const height = Math.max(120, data.length * 34);

  return (
    <div>
      <div className="mb-1.5 flex justify-between text-2xs text-ink-faint">
        <span>← {p2Name}</span>
        <span>{p1Name} →</span>
      </div>
      <ChartContainer config={chartConfig} className="w-full" style={{ height }}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category" dataKey="label" width={140}
            tick={{ fill: chartColor.inkMuted, fontSize: 11 }}
            axisLine={false} tickLine={false}
          />
          <ReferenceLine x={0} stroke={chartColor.line} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                hideLabel
                formatter={(v) => [`${fmtSigned(Number(v))} pp`, ' Impacto']}
              />
            }
            cursor={{ fill: chartColor.surface2, opacity: 0.4 }}
          />
          <Bar dataKey="pp" radius={3} maxBarSize={16}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.pp >= 0 ? chartColor.p1 : chartColor.p2} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}
