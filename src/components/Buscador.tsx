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
          aria-label="Buscar jugador o torneo"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-court/60 focus:outline-none"
        />
        <div className="flex rounded-lg border border-line p-0.5">
          {(['all', 'ATP', 'WTA'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTouched(true); setTour(t); }}
              aria-pressed={tour === t}
              className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                tour === t ? 'bg-court text-bg' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {t === 'all' ? 'Todos' : t}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="mb-2 text-2xs text-ink-faint">Buscando…</p>}
      {touched && !loading && matches.length === 0 && (q.trim() || tour !== 'all') && (
        <p className="card p-4 text-sm text-ink-muted">Sin resultados para esta búsqueda.</p>
      )}
      {(!touched || matches.length > 0) && <MatchList matches={matches} />}
    </div>
  );
}
