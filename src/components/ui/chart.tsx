import * as React from 'react';
import * as RechartsPrimitive from 'recharts';
import { cn } from '../../lib/utils';

/**
 * Componente de gráficos de shadcn/ui (`chart.tsx`), adaptado a este proyecto:
 * mismo contrato (`ChartConfig`, `ChartContainer`, `ChartTooltipContent`,
 * `ChartLegendContent`) que la versión oficial de shadcn, pero sin traer el
 * resto del sistema de theming de shadcn (que usa OTROS nombres de variable
 * CSS). Aquí `ChartConfig.color` se escribe directamente como
 * `hsl(var(--court))` etc. — los MISMOS tokens que ya usa toda la app en
 * `global.css`, así el gráfico queda visualmente idéntico al resto de la UI
 * en vez de fragmentar el sistema de diseño con un segundo set de colores.
 *
 * Es dark-only (igual que `global.css`: `color-scheme: dark` fijo), así que
 * se omite la rama light/dark del componente original de shadcn.
 */

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
    color?: string;
  };
};

type ChartContextProps = { config: ChartConfig };
const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) throw new Error('useChart debe usarse dentro de <ChartContainer>');
  return context;
}

function ChartContainer({
  id, className, children, config, ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children'];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, '')}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        className={cn(
          "flex aspect-auto justify-center text-2xs [&_.recharts-cartesian-axis-tick_text]:fill-ink-faint [&_.recharts-cartesian-grid_line]:stroke-line/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-line [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-line/50 [&_.recharts-radial-bar-background-sector]:fill-surface-2 [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-surface-2 [&_.recharts-reference-line_[stroke='#ccc']]:stroke-line [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-sector]:outline-none [&_.recharts-surface]:outline-none",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

/** Escribe `--color-<key>` por serie a partir de `config`, para que las clases `fill-[--color-x]`/`stroke-[--color-x]` resuelvan sin repetir el color en cada componente. */
function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const entries = Object.entries(config).filter(([, cfg]) => cfg.color);
  if (!entries.length) return null;
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `[data-chart=${id}]{${entries.map(([key, cfg]) => `--color-${key}:${cfg.color};`).join('')}}`,
      }}
    />
  );
}

const ChartTooltip = RechartsPrimitive.Tooltip;

/** Una entrada del payload que entrega Recharts al tooltip/leyenda — tipada a mano porque los genéricos de recharts v3 son demasiado rígidos para reusar tal cual en un wrapper. */
interface ChartPayloadItem {
  dataKey?: string | number;
  name?: string | number;
  value?: string | number | Array<string | number>;
  color?: string;
  payload?: Record<string, unknown>;
}

interface ChartTooltipContentProps {
  active?: boolean;
  payload?: ChartPayloadItem[];
  label?: React.ReactNode;
  className?: string;
  hideLabel?: boolean;
  hideIndicator?: boolean;
  indicator?: 'line' | 'dot' | 'dashed';
  nameKey?: string;
  labelKey?: string;
  labelClassName?: string;
  color?: string;
  labelFormatter?: (label: React.ReactNode, payload: ChartPayloadItem[]) => React.ReactNode;
  formatter?: (
    value: ChartPayloadItem['value'], name: ChartPayloadItem['name'], item: ChartPayloadItem, index: number, payload: unknown,
  ) => React.ReactNode;
}

function ChartTooltipContent({
  active, payload, className, indicator = 'dot', hideLabel = false, hideIndicator = false,
  label, labelFormatter, labelClassName, formatter, color, nameKey, labelKey,
}: ChartTooltipContentProps) {
  const { config } = useChart();

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) return null;
    const [item] = payload;
    const key = `${labelKey || item?.dataKey || item?.name || 'value'}`;
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    const value = !labelKey && typeof label === 'string' ? (config[label as keyof typeof config]?.label ?? label) : itemConfig?.label;
    if (labelFormatter) return <div className={cn('font-medium text-ink', labelClassName)}>{labelFormatter(value, payload)}</div>;
    if (!value) return null;
    return <div className={cn('font-medium text-ink', labelClassName)}>{value}</div>;
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

  if (!active || !payload?.length) return null;

  const nestLabel = payload.length === 1 && indicator !== 'dot';

  return (
    <div
      className={cn(
        'grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-2xs shadow-xl',
        className,
      )}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1">
        {payload.map((item, index) => {
          const key = `${nameKey || item.name || item.dataKey || 'value'}`;
          const itemConfig = getPayloadConfigFromPayload(config, item, key);
          const indicatorColor = color || (item.payload as { fill?: string } | undefined)?.fill || item.color;
          return (
            <div
              key={item.dataKey ?? index}
              className="flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-ink-faint"
            >
              {formatter && item?.value !== undefined && item.name ? (
                formatter(item.value, item.name, item, index, item.payload)
              ) : (
                <>
                  {!hideIndicator && (
                    <div
                      className={cn('shrink-0 rounded-[2px] border-[var(--color-border)] bg-[var(--color-bg)]', {
                        'h-2.5 w-2.5': indicator === 'dot',
                        'w-1': indicator === 'line',
                        'w-0 border-[1.5px] border-dashed bg-transparent': indicator === 'dashed',
                        'my-0.5': nestLabel && indicator === 'dashed',
                      })}
                      style={{ ['--color-bg' as string]: indicatorColor, ['--color-border' as string]: indicatorColor }}
                    />
                  )}
                  <div className={cn('flex flex-1 justify-between leading-none', nestLabel ? 'items-end' : 'items-center')}>
                    <div className="grid gap-1.5">
                      {nestLabel ? tooltipLabel : null}
                      <span className="text-ink-muted">{itemConfig?.label || item.name}</span>
                    </div>
                    {item.value !== undefined && (
                      <span className="font-mono font-medium tabular-nums text-ink">
                        {typeof item.value === 'number' ? item.value.toLocaleString('es-CL') : item.value}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const ChartLegend = RechartsPrimitive.Legend;

interface ChartLegendContentProps {
  className?: string;
  hideIcon?: boolean;
  nameKey?: string;
  verticalAlign?: 'top' | 'bottom' | 'middle';
  payload?: ChartPayloadItem[];
}

function ChartLegendContent({
  className, hideIcon = false, payload, verticalAlign = 'bottom', nameKey,
}: ChartLegendContentProps) {
  const { config } = useChart();
  if (!payload?.length) return null;

  return (
    <div className={cn('flex items-center justify-center gap-4', verticalAlign === 'top' ? 'pb-3' : 'pt-3', className)}>
      {payload.map((item) => {
        const key = `${nameKey || item.dataKey || 'value'}`;
        const itemConfig = getPayloadConfigFromPayload(config, item, key);
        return (
          <div key={String(item.dataKey ?? item.name ?? key)} className="flex items-center gap-1.5 text-2xs text-ink-muted [&>svg]:h-3 [&>svg]:w-3">
            {itemConfig?.icon && !hideIcon ? (
              <itemConfig.icon />
            ) : (
              <div className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
            )}
            {itemConfig?.label}
          </div>
        );
      })}
    </div>
  );
}

function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const payloadPayload =
    'payload' in payload && typeof (payload as { payload?: unknown }).payload === 'object' && (payload as { payload?: unknown }).payload !== null
      ? (payload as { payload: Record<string, unknown> }).payload
      : undefined;

  let configLabelKey = key;
  const p = payload as Record<string, unknown>;
  if (key in p && typeof p[key] === 'string') configLabelKey = p[key] as string;
  else if (payloadPayload && key in payloadPayload && typeof payloadPayload[key] === 'string') configLabelKey = payloadPayload[key] as string;

  return configLabelKey in config ? config[configLabelKey] : config[key as keyof typeof config];
}

export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, ChartStyle };
