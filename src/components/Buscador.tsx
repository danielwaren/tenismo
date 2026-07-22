import { useEffect, useRef, useState } from 'react';
import type { MatchRow } from '../lib/queries';
import MatchList from './MatchList';

/**
 * Buscador de partidos por jugador o torneo. Llama a /api/search (servidor),
 * con debounce para no disparar una petición por tecla.
 */
export default function Buscador({ initial = [] }: { initial?: MatchRow[] }) {
  const [q, setQ] = useState('');
  const [tour, setTour] = useState<'all' | 'ATP' | 'WTA'>('all');
  const [matches, setMatches] = useState<MatchRow[]>(initial);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!touched) return;
    if (!q.trim() && tour === 'all') { setMatches(initial); return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q });
        if (tour !== 'all') params.set('tour', tour);
        const res = await fetch(`/api/search?${params.toString()}`);
        const data = await res.json();
        setMatches(data.matches ?? []);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, tour, touched]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => { setTouched(true); setQ(e.target.value); }}
          placeholder="Buscar jugador o torneo…"
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-court-500 focus:outline-none"
        />
        <div className="flex rounded-lg border border-slate-700 p-0.5">
          {(['all', 'ATP', 'WTA'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTouched(true); setTour(t); }}
              className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                tour === t ? 'bg-court-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t === 'all' ? 'Todos' : t}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="mb-2 text-xs text-slate-500">Buscando…</p>}
      {touched && !loading && matches.length === 0 && (q.trim() || tour !== 'all') && (
        <p className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
          Sin resultados para esta búsqueda.
        </p>
      )}
      {(!touched || matches.length > 0) && <MatchList matches={matches} />}
    </div>
  );
}
