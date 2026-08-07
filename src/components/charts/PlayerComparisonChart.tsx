import { BarChart, Bar, XAxis, YAxis, LabelList } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, type ChartConfig } from '../ui/chart';
import { chartColor, ChartEmpty } from './theme';

export interface ComparisonMetric {
  label: string;
  p1: number | null;
  p2: number | null;
  /** true cuando un valor MENOR es mejor (ranking): se invierte antes de repartir. */
  lowerIsBetter?: boolean;
  /** Valor ya formateado para mostrar dentro de la barra ("#11", "2111", "64%"). */
  p1Text: string;
  p2Text: string;
}

/**
 * Comparativa de jugadores como "tira y afloja": una barra apilada por
 * métrica, partida en el punto que le corresponde a cada jugador.
 *
 * QUÉ SIGNIFICA LA BARRA — y qué NO. El reparto es la proporción que cada
 * jugador ocupa del total del par en esa métrica (`v1 / (v1 + v2)`; para el
 * ranking se invierte primero, porque ahí menos es mejor). Es una AYUDA
 * VISUAL para ver de un vistazo quién domina cada fila: no es una
 * probabilidad, ni la ventaja real que el modelo le asigna a esa variable.
 * Por eso el número crudo va SIEMPRE impreso dentro de la barra — el dato
 * exacto nunca depende de interpretar una longitud.
 *
 * Sustituye a la lista de filas de texto que había antes: misma información,
 * pero comparable de un vistazo en vez de leyendo pares de cifras.
 */
export default function PlayerComparisonChart({
  metrics, p1Name, p2Name,
}: { metrics: ComparisonMetric[]; p1Name: string; p2Name: string }) {
  // Sin los dos valores no se puede repartir nada: esa fila no se pinta (no
  // se inventa un 50/50 ni se trata el hueco como un cero).
  const usable = metrics.filter((x) => x.p1 !== null && x.p2 !== null);
  if (!usable.length) return <ChartEmpty message="Sin datos suficientes para comparar a los dos jugadores." />;

  const config = {
    [p1Name]: { label: p1Name, color: chartColor.p1 },
    [p2Name]: { label: p2Name, color: chartColor.p2 },
  } satisfies ChartConfig;

  const data = usable.map((x) => {
    const a = x.lowerIsBetter ? 1 / Math.max(x.p1!, 1) : Math.max(x.p1!, 0);
    const b = x.lowerIsBetter ? 1 / Math.max(x.p2!, 1) : Math.max(x.p2!, 0);
    const total = a + b;
    const share = total > 0 ? (a / total) * 100 : 50;
    return {
      label: x.label,
      [p1Name]: share,
      [p2Name]: 100 - share,
      p1Text: x.p1Text,
      p2Text: x.p2Text,
    };
  });

  return (
    // `flex-1` + `minHeight`: cuando la tarjeta se estira para igualar a su
    // vecina de fila, las barras reparten ese alto extra en vez de dejar un
    // hueco muerto debajo del gráfico.
    <ChartContainer config={config} className="w-full flex-1" style={{ minHeight: Math.max(110, data.length * 26 + 28) }}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 4, bottom: 0, left: 4 }} barCategoryGap="22%">
        <XAxis type="number" domain={[0, 100]} hide />
        <YAxis
          type="category" dataKey="label" width={128}
          tick={{ fill: chartColor.inkMuted, fontSize: 10 }}
          axisLine={false} tickLine={false}
        />
        <ChartTooltip
          content={<ChartTooltipContent formatter={(v, n) => [`${Math.round(Number(v))}% del par`, ` ${n}`]} />}
          cursor={{ fill: chartColor.surface2, opacity: 0.35 }}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey={p1Name} stackId="cmp" fill={chartColor.p1} radius={[3, 0, 0, 3]} maxBarSize={18}>
          <LabelList dataKey="p1Text" position="insideLeft" fill="hsl(var(--bg))" fontSize={10} fontWeight={600} offset={7} />
        </Bar>
        <Bar dataKey={p2Name} stackId="cmp" fill={chartColor.p2} radius={[0, 3, 3, 0]} maxBarSize={18}>
          <LabelList dataKey="p2Text" position="insideRight" fill="hsl(var(--bg))" fontSize={10} fontWeight={600} offset={7} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
