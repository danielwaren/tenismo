import type { CalibrationReport } from '../lib/queries';

/**
 * Diagrama de fiabilidad en SVG, sin librería de charts.
 * La diagonal es la calibración perfecta: predicho = observado. Los puntos por
 * encima de la diagonal son partidos donde el modelo se quedó corto (ocurrió más
 * de lo que dijo); por debajo, donde fue demasiado confiado.
 */
export default function ReliabilityDiagram({ report }: { report: CalibrationReport }) {
  const size = 320;
  const pad = 34;
  const inner = size - pad * 2;
  const x = (p: number) => pad + p * inner;
  const y = (p: number) => size - pad - p * inner;

  const pts = report.bins.filter((b) => b.count > 0);
  const maxCount = Math.max(1, ...pts.map((b) => b.count));

  return (
    <div>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-sm" role="img" aria-label="Diagrama de fiabilidad">
        {/* marco */}
        <rect x={pad} y={pad} width={inner} height={inner} fill="none" stroke="#1e293b" />
        {/* rejilla */}
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g}>
            <line x1={x(g)} y1={pad} x2={x(g)} y2={size - pad} stroke="#1e293b" strokeDasharray="2 3" />
            <line x1={pad} y1={y(g)} x2={size - pad} y2={y(g)} stroke="#1e293b" strokeDasharray="2 3" />
          </g>
        ))}
        {/* diagonal = calibración perfecta */}
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="#475569" strokeDasharray="4 3" />
        {/* línea del modelo */}
        <polyline
          points={pts.map((b) => `${x(b.meanPredicted)},${y(b.observed)}`).join(' ')}
          fill="none"
          stroke="#22c55e"
          strokeWidth={2}
        />
        {/* puntos, tamaño segun nº de partidos */}
        {pts.map((b, i) => (
          <circle
            key={i}
            cx={x(b.meanPredicted)}
            cy={y(b.observed)}
            r={3 + (b.count / maxCount) * 5}
            fill="#22c55e"
            fillOpacity={0.7}
          />
        ))}
        {/* etiquetas */}
        <text x={pad} y={size - 10} fill="#64748b" fontSize="10">0</text>
        <text x={size - pad - 6} y={size - 10} fill="#64748b" fontSize="10">1</text>
        <text x={size / 2 - 40} y={size - 6} fill="#64748b" fontSize="10">probabilidad predicha</text>
        <text x={8} y={pad + 8} fill="#64748b" fontSize="10">1</text>
        <text x={8} y={size - pad} fill="#64748b" fontSize="10">0</text>
      </svg>
      <p className="mt-1 text-xs text-slate-500">
        Verde = modelo. Diagonal = calibración perfecta. El tamaño del punto refleja cuántos
        partidos caen en cada tramo.
      </p>
    </div>
  );
}
