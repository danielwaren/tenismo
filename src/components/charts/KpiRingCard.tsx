import { RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts';
import { ChartContainer, type ChartConfig } from '../ui/chart';
import { chartColor } from './theme';

const config = { value: { label: 'valor' } } satisfies ChartConfig;

/**
 * Tarjeta KPI compacta: anillo (0-100, dato realmente acotado — probabilidad
 * o confianza, nunca una cifra sin tope disfrazada de %) + número grande +
 * etiqueta. Mismo patrón que las tarjetas superiores de un dashboard
 * "densidad alta": todo visible sin scroll, un vistazo por tarjeta.
 */
export default function KpiRingCard({
  ringPct, color, big, label,
}: { ringPct: number; color: string; big: string; label: string }) {
  const data = [{ value: ringPct, fill: color }];
  return (
    <div className="card flex items-center gap-3 p-3.5">
      <ChartContainer config={config} className="aspect-square w-14 shrink-0">
        <RadialBarChart data={data} innerRadius="70%" outerRadius="100%" startAngle={90} endAngle={-270} barSize={7}>
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar dataKey="value" background={{ fill: chartColor.surface2 }} cornerRadius={8} />
          <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" style={{ fill: color, fontSize: 13, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace' }}>
            {Math.round(ringPct)}%
          </text>
        </RadialBarChart>
      </ChartContainer>
      <div className="min-w-0">
        <div className="truncate font-display text-lg font-semibold leading-tight text-ink">{big}</div>
        <div className="truncate text-2xs text-ink-faint">{label}</div>
      </div>
    </div>
  );
}
