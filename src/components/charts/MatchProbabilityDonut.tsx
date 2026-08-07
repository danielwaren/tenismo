import { PieChart, Pie, Cell } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../ui/chart';
import { chartColor } from './theme';

/**
 * Dona de probabilidad — la MISMA cifra que ya muestra el texto grande
 * ("43% / 57%"), en un tipo de gráfico distinto al resto de la página
 * (circular, no barras) para que la lectura del pronóstico principal sea
 * inmediata de un vistazo.
 */
export default function MatchProbabilityDonut({
  p1Name, p2Name, probP1,
}: { p1Name: string; p2Name: string; probP1: number }) {
  const pctP1 = Math.round(probP1 * 100);
  const pctP2 = 100 - pctP1;
  const data = [
    { name: p1Name, value: pctP1, fill: chartColor.p1 },
    { name: p2Name, value: pctP2, fill: chartColor.p2 },
  ];
  const config = {
    [p1Name]: { label: p1Name, color: chartColor.p1 },
    [p2Name]: { label: p2Name, color: chartColor.p2 },
  } satisfies ChartConfig;
  const favorito = pctP1 >= pctP2 ? p1Name : p2Name;
  const favoritoColor = pctP1 >= pctP2 ? chartColor.p1 : chartColor.p2;

  return (
    <ChartContainer config={config} className="mx-auto aspect-square w-full max-w-[9rem]">
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent hideLabel formatter={(v, n) => [`${v}%`, ` ${n}`]} />} />
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="100%" startAngle={90} endAngle={-270} strokeWidth={2} stroke={chartColor.surface2}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.fill} />
          ))}
        </Pie>
        {/* Cifra central: mismo patrón que usa shadcn para "texto dentro de la dona". */}
        <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" style={{ fill: favoritoColor, fontSize: 22, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace' }}>
          {Math.max(pctP1, pctP2)}%
        </text>
        <text x="50%" y="63%" textAnchor="middle" dominantBaseline="middle" style={{ fill: chartColor.inkFaint, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {favorito.split(' ')[0]}
        </text>
      </PieChart>
    </ChartContainer>
  );
}
