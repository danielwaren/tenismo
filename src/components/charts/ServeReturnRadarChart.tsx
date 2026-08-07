import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, type ChartConfig } from '../ui/chart';
import { chartColor, ChartEmpty } from './theme';

export interface RadarMetric {
  label: string;
  /** 0-1. Solo métricas en tasa (comparables en la misma escala) entran al radar — aces/DF por partido no, por estar en otra unidad. */
  p1: number | null;
  p2: number | null;
}

/**
 * "Perfil" de saque y resto en un solo vistazo — el tipo de gráfico correcto
 * para comparar VARIAS métricas a la vez entre dos jugadores (mismo uso que
 * un radar de atributos). Solo entran métricas 0-1 (tasas): mezclar aces/
 * partido (escala 0-15) con % (escala 0-1) en el mismo radar distorsionaría
 * los ejes, así que esas se muestran aparte como cifras.
 */
export default function ServeReturnRadarChart({ metrics, p1Name, p2Name }: { metrics: RadarMetric[]; p1Name: string; p2Name: string }) {
  const data = metrics.filter((m) => m.p1 !== null && m.p2 !== null);
  if (data.length < 3) return <ChartEmpty message="Faltan métricas suficientes para el perfil (mínimo 3)." />;

  const config = {
    [p1Name]: { label: p1Name, color: chartColor.p1 },
    [p2Name]: { label: p2Name, color: chartColor.p2 },
  } satisfies ChartConfig;
  const renamed = data.map((m) => ({ label: m.label, [p1Name]: Math.round((m.p1 ?? 0) * 100), [p2Name]: Math.round((m.p2 ?? 0) * 100) }));

  return (
    <ChartContainer config={config} className="mx-auto w-full max-w-sm" style={{ height: 260 }}>
      <RadarChart data={renamed}>
        <PolarGrid stroke={chartColor.line} />
        <PolarAngleAxis dataKey="label" tick={{ fill: chartColor.inkMuted, fontSize: 10 }} />
        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: chartColor.inkFaint, fontSize: 9 }} axisLine={false} tickCount={3} />
        <Radar name={p1Name} dataKey={p1Name} stroke={chartColor.p1} fill={chartColor.p1} fillOpacity={0.28} strokeWidth={2} />
        <Radar name={p2Name} dataKey={p2Name} stroke={chartColor.p2} fill={chartColor.p2} fillOpacity={0.18} strokeWidth={2} />
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => `${v}%`} />} />
        <ChartLegend content={<ChartLegendContent />} />
      </RadarChart>
    </ChartContainer>
  );
}
