import { useState } from 'react';
import type { RankingRow } from '../lib/queries';

export type Tour = 'ATP' | 'WTA';
export type Scope = 'all' | 'hard' | 'clay' | 'grass';

const SCOPES: { key: Scope; label: string; dot: string }[] = [
  { key: 'all', label: 'Global', dot: 'bg-slate-400' },
  { key: 'hard', label: 'Dura', dot: 'bg-hard' },
  { key: 'clay', label: 'Arcilla', dot: 'bg-clay' },
  { key: 'grass', label: 'Hierba', dot: 'bg-grass' },
];

/**
 * Ranking Elo con pestañas de circuito y superficie.
 *
 * Los datos llegan ya resueltos desde el servidor (ver src/lib/queries.ts): la
 * isla no habla con la base, porque en Turso no hay RLS que la proteja.
 */
export default function RankingTable({ data }: { data: Record<string, RankingRow[]> }) {
  const [tour, setTour] = useState<Tour>('ATP');
  const [scope, setScope] = useState<Scope>('all');
  const rows = data[`${tour}:${scope}`] ?? [];

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-700 p-0.5">
          {(['ATP', 'WTA'] as Tour[]).map((t) => (
            <button
              key={t}
              onClick={() => setTour(t)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                tour === t ? 'bg-court-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              onClick={() => setScope(s.key)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1 text-sm transition ${
                scope === s.key
                  ? 'border-court-500 bg-court-900/50 text-court-100'
                  : 'border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${s.dot}`} />
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
          Sin ratings para esta combinación. ¿Se ejecutó <code className="text-slate-300">npm run db:elo</code>?
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/70 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Jugador</th>
                <th className="px-4 py-2 text-right font-medium">Elo</th>
                <th className="px-4 py-2 text-right font-medium">Partidos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((r, i) => (
                <tr key={r.playerId} className="hover:bg-slate-900/40">
                  <td className="px-4 py-2 text-slate-500">{i + 1}</td>
                  <td className="px-4 py-2 font-medium">{r.name}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{r.elo.toFixed(0)}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-400">{r.matches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        Mínimo 20 partidos computados. El Elo de ATP y el de WTA son escalas
        independientes — nunca se enfrentan entre sí, así que no son comparables.
        El rating por superficie se encoge hacia el global cuando hay poca muestra.
      </p>
    </section>
  );
}
