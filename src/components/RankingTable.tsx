import { useState } from 'react';
import type { RankingRow } from '../lib/queries';

export type Tour = 'ATP' | 'WTA';
export type Scope = 'all' | 'hard' | 'clay' | 'grass';

const SCOPES: { key: Scope; label: string; dot: string }[] = [
  { key: 'all', label: 'Global', dot: 'bg-ink-faint' },
  { key: 'hard', label: 'Dura', dot: 'bg-hard' },
  { key: 'clay', label: 'Arcilla', dot: 'bg-clay' },
  { key: 'grass', label: 'Hierba', dot: 'bg-grass' },
];

/**
 * Ranking Elo con pestañas de circuito y superficie. Datos ya resueltos en el
 * servidor: la isla no habla con la base.
 */
export default function RankingTable({ data }: { data: Record<string, RankingRow[]> }) {
  const [tour, setTour] = useState<Tour>('ATP');
  const [scope, setScope] = useState<Scope>('all');
  const rows = data[`${tour}:${scope}`] ?? [];
  const topElo = rows[0]?.elo ?? 0;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line p-0.5">
          {(['ATP', 'WTA'] as Tour[]).map((t) => (
            <button
              key={t}
              onClick={() => setTour(t)}
              aria-pressed={tour === t}
              className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                tour === t ? 'bg-court text-bg' : 'text-ink-muted hover:text-ink'
              }`}
            >{t}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              onClick={() => setScope(s.key)}
              aria-pressed={scope === s.key}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1 text-sm transition ${
                scope === s.key ? 'border-court/50 bg-court/10 text-court-ink' : 'border-line text-ink-muted hover:text-ink'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${s.dot}`} />
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="card p-4 text-sm text-ink-muted">Sin ratings para esta combinación.</p>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-2/50 text-left text-2xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-4 py-2.5 font-medium">#</th>
                <th className="px-4 py-2.5 font-medium">Jugador</th>
                <th className="px-4 py-2.5 text-right font-medium">Elo</th>
                <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Partidos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {rows.map((r, i) => (
                <tr key={r.playerId} className="transition hover:bg-surface-2/40">
                  <td className="px-4 py-2 tabular-nums text-ink-faint">{i + 1}</td>
                  <td className="px-4 py-2">
                    <div className="font-medium text-ink">{r.name}</div>
                    <div className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-court/70" style={{ width: `${topElo ? (r.elo / topElo) * 100 : 0}%` }} />
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-ink">{r.elo.toFixed(0)}</td>
                  <td className="hidden px-4 py-2 text-right font-mono tabular-nums text-ink-muted sm:table-cell">{r.matches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-2xs leading-relaxed text-ink-faint">
        Mínimo 20 partidos computados. El Elo de ATP y el de WTA son escalas independientes: nunca se
        enfrentan, así que no son comparables. El rating por superficie se encoge hacia el global
        cuando hay poca muestra.
      </p>
    </section>
  );
}
