import { useMemo, useState } from 'react';
import type { MatchRow, MatchAces } from '../lib/queries';
import { tourChip } from '../lib/format';
import MatchList from './MatchList';

/**
 * Agenda de próximos partidos: primero se elige el DÍA, y dentro del día los
 * partidos van agrupados por TORNEO.
 *
 * POR QUÉ. Antes era una rejilla plana de 40 tarjetas ordenada por fecha y
 * ronda. Con dos Masters 1000 solapados eso son treinta y tantas primeras
 * rondas seguidas del mismo cuadro, y encontrar "qué se juega mañana" o "qué
 * queda del torneo que me interesa" obligaba a recorrerlas todas. Los dos ejes
 * por los que se busca de verdad son el día y el torneo, así que son los dos
 * que estructuran la vista.
 *
 * Todo el filtrado es en memoria: los partidos ya vienen resueltos del
 * servidor y son pocas decenas.
 */

/** "2026-08-06" → { corta: "mié 6 ago", larga: "miércoles, 6 de agosto" } */
function nombresDeDia(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { corta: iso, larga: iso };
  return {
    corta: d.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }),
    larga: d.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
  };
}

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function MatchBoard({
  matches,
  aces,
}: {
  matches: MatchRow[];
  aces?: Record<number, MatchAces>;
}) {
  // Días presentes, en orden, con su recuento.
  const dias = useMemo(() => {
    const porDia = new Map<string, number>();
    for (const m of matches) porDia.set(m.playedOn, (porDia.get(m.playedOn) ?? 0) + 1);
    return [...porDia.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([iso, n]) => ({ iso, n }));
  }, [matches]);

  // Arranca en HOY si hay partidos hoy; si no, en el primer día futuro. Nunca
  // en el primero de la lista a secas: la consulta incluye el día anterior
  // (para no perder partidos sin reconciliar), y abrir en "ayer" cuando hoy
  // hay 19 partidos es justo lo contrario de lo que se viene a ver.
  const inicial = useMemo(() => {
    const hoy = hoyISO();
    return dias.find((d) => d.iso === hoy)?.iso
      ?? dias.find((d) => d.iso > hoy)?.iso
      ?? dias[0]?.iso
      ?? null;
  }, [dias]);

  const [dia, setDia] = useState<string | null>(null);
  const elegido = dia ?? inicial;
  const activo = elegido && dias.some((d) => d.iso === elegido) ? elegido : inicial;

  // Dentro del día, agrupados por torneo conservando el orden de llegada (el
  // servidor ya ordena por ronda: finales antes que primeras rondas).
  const grupos = useMemo(() => {
    const out = new Map<string, MatchRow[]>();
    for (const m of matches) {
      if (m.playedOn !== activo) continue;
      const arr = out.get(m.tournament);
      if (arr) arr.push(m);
      else out.set(m.tournament, [m]);
    }
    return [...out.entries()];
  }, [matches, activo]);

  if (!matches.length) {
    return <p className="card p-4 text-sm text-ink-muted">No hay partidos que mostrar.</p>;
  }

  const hoy = hoyISO();

  return (
    <div>
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Día">
        {dias.map((d) => {
          const esActivo = d.iso === activo;
          const { corta, larga } = nombresDeDia(d.iso);
          return (
            <button
              key={d.iso}
              type="button"
              role="tab"
              aria-selected={esActivo}
              onClick={() => setDia(d.iso)}
              className={`flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition ${
                esActivo
                  ? 'border-court bg-court text-bg'
                  : 'border-line bg-surface text-ink-muted hover:border-court/40 hover:text-ink'
              }`}
            >
              <span className="capitalize">{d.iso === hoy ? 'Hoy' : corta}</span>
              <span className={`rounded-md px-1.5 py-0.5 font-mono text-2xs tabular-nums ${esActivo ? 'bg-bg/15' : 'bg-surface-2 text-ink-faint'}`}>
                {d.n}
              </span>
              <span className="sr-only">{larga}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-8">
        {grupos.map(([torneo, delTorneo]) => (
          <section key={torneo}>
            <div className="mb-3 flex items-center gap-3">
              <span className={`chip shrink-0 ${tourChip(delTorneo[0].tour)}`}>{delTorneo[0].tour}</span>
              <h3 className="min-w-0 flex-1 truncate font-display text-base font-semibold text-ink">{torneo}</h3>
              <span className="shrink-0 font-mono text-2xs tabular-nums text-ink-faint">
                {delTorneo.length} {delTorneo.length === 1 ? 'partido' : 'partidos'}
              </span>
            </div>
            <MatchList matches={delTorneo} aces={aces} />
          </section>
        ))}
      </div>
    </div>
  );
}
