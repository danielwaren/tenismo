import { RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts';
import { ChartContainer, type ChartConfig } from '../ui/chart';
import { chartColor } from './theme';
import type { ConfidenceBand } from '@tti/model';

const BAND_COLOR: Record<ConfidenceBand, string> = {
  ALTA: chartColor.p1, MEDIA: chartColor.inkMuted, BAJA: chartColor.live,
};

const config = { score: { label: 'Confianza' } } satisfies ChartConfig;

/** Medidor semicircular 0-100 — mismo número que el chip "Confianza: X/100", en formato de gauge. */
export default function ConfidenceGauge({ score, band }: { score: number; band: ConfidenceBand }) {
  const data = [{ name: 'score', value: score, fill: BAND_COLOR[band] }];
  return (
    <ChartContainer config={config} className="mx-auto aspect-[2/1.2] w-full max-w-[7rem]">
      <RadialBarChart data={data} innerRadius="70%" outerRadius="130%" startAngle={180} endAngle={0} barSize={10}>
        <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
        <RadialBar dataKey="value" background={{ fill: chartColor.surface2 }} cornerRadius={6} />
        <text x="50%" y="88%" textAnchor="middle" style={{ fill: BAND_COLOR[band], fontSize: 20, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace' }}>
          {score}
        </text>
      </RadialBarChart>
    </ChartContainer>
  );
}
