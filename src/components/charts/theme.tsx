import type { CSSProperties } from 'react';

/**
 * Tema compartido para los gráficos Recharts de la ficha de análisis.
 *
 * No se instaló shadcn/ui (el proyecto no lo usa en ningún otro sitio: no hay
 * `components.json`, ni Radix, ni CVA — ver informe de auditoría). Añadirlo
 * solo para los gráficos habría metido un segundo sistema de theming (el de
 * shadcn, basado en CSS vars con otro naming) encima del que ya existe en
 * `global.css`. En su lugar: Recharts directo + este wrapper, que lee los
 * MISMOS tokens (`--court`, `--live`, `--ink-muted`, etc.) que ya usa toda la
 * UI. El resultado visual es equivalente a "shadcn charts" (que también son,
 * por debajo, Recharts con un wrapper de tema) sin fragmentar el sistema de
 * diseño existente.
 */

export const chartColor = {
  p1: 'hsl(var(--court))',
  p1Ink: 'hsl(var(--court-ink))',
  p2: 'hsl(var(--ink-muted))',
  live: 'hsl(var(--live))',
  ink: 'hsl(var(--ink))',
  inkMuted: 'hsl(var(--ink-muted))',
  inkFaint: 'hsl(var(--ink-faint))',
  line: 'hsl(var(--line))',
  surface2: 'hsl(var(--surface-2))',
  bg: 'hsl(var(--bg))',
} as const;

export const CHART_FONT = {
  fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
  fontSize: 11,
};

/** Tooltip consistente con las tarjetas (.card) del resto de la app. */
export const tooltipStyle: CSSProperties = {
  background: 'hsl(var(--surface-2))',
  border: '1px solid hsl(var(--line))',
  borderRadius: '0.625rem',
  fontSize: '11px',
  fontFamily: CHART_FONT.fontFamily,
  color: 'hsl(var(--ink))',
  padding: '0.5rem 0.625rem',
};

export function fmtPct(x: number, decimals = 0): string {
  return `${(x * 100).toFixed(decimals)}%`;
}

export function fmtSigned(x: number, decimals = 1): string {
  const s = x >= 0 ? '+' : '';
  return `${s}${x.toFixed(decimals)}`;
}

/**
 * Estado vacío. Deliberadamente BAJO (no reserva el alto del gráfico): un
 * hueco vacío del tamaño de un gráfico deja la pantalla llena de aire y
 * empuja hacia abajo todo lo que sí tiene datos.
 */
export function ChartEmpty({ message }: { message: string }) {
  // `my-auto` centra el mensaje cuando la tarjeta es `flex flex-col` y se ha
  // estirado para igualar a sus vecinas de fila; en una tarjeta normal (flujo
  // de bloque) el margen automático vertical vale 0, así que no estorba.
  return (
    <div className="my-auto rounded-lg border border-dashed border-line/60 px-3 py-2.5 text-2xs leading-relaxed text-ink-faint">
      {message}
    </div>
  );
}

/** Skeleton de carga, mismo alto que el gráfico real para no saltar el layout. */
export function ChartSkeleton({ height = 180 }: { height?: number }) {
  return (
    <div
      className="animate-pulse rounded-lg bg-surface-2/60"
      style={{ height }}
      aria-hidden="true"
    />
  );
}
