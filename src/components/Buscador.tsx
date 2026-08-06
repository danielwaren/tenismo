import { useEffect, useRef, useState } from 'react';
import type { MatchRow, MatchAces, PlayerSearchResult, TournamentCard } from '../lib/queries';
import { fmtDate, tourChip } from '../lib/format';
import { playerPath } from '../lib/urls';
import MatchList from './MatchList';

export default function Buscador({ initial = [], initialAces = {} }: {
  initial?: MatchRow[];
  initialAces?: Record<number, MatchAces>;
}) {
  const [q, setQ] = useState('');
  const [tour, setTour] = useState<'all' | 'ATP' | 'WTA'>('all');
  const [players, setPlayers] = useState<PlayerSearchResult[]>([]);
  const [tournaments, setTournaments] = useState<TournamentCard[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>(initial);
  const [aces, setAces] = useState<Record<number, MatchAces>>(initialAces);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!touched) return;
    if (!q.trim() && tour === 'all') {
      setPlayers([]); setTournaments([]); setMatches(initial); setAces(initialAces); setFailed(false);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    const controller = new AbortController();
    timer.current = setTimeout(async () => {
      setLoading(true); setFailed(false);
      try {
        const params = new URLSearchParams({ q });
        if (tour !== 'all') params.set('tour', tour);
        const response = await fetch(`/api/search?${params.toString()}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Búsqueda HTTP ${response.status}`);
        const data = await response.json();
        setPlayers(data.players ?? []); setTournaments(data.tournaments ?? []);
        setMatches(data.matches ?? []); setAces(data.aces ?? {});
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          setFailed(true); setPlayers([]); setTournaments([]); setMatches([]);
        }
      } finally { setLoading(false); }
    }, 250);
    return () => { controller.abort(); if (timer.current) clearTimeout(timer.current); };
  }, [q, tour, touched]);

  const empty = players.length === 0 && tournaments.length === 0 && matches.length === 0;
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <input type="search" value={q} onChange={(event) => { setTouched(true); setQ(event.target.value); }}
          placeholder="Buscar jugador, partido o torneo…" aria-label="Buscar jugadores, partidos y torneos"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-court/60 focus:outline-none" />
        <div className="flex rounded-lg border border-line p-0.5" aria-label="Filtrar por circuito">
          {(['all', 'ATP', 'WTA'] as const).map((value) => <button key={value} type="button"
            onClick={() => { setTouched(true); setTour(value); }} aria-pressed={tour === value}
            className={`rounded-md px-3 py-1 text-sm font-medium transition ${tour === value ? 'bg-court text-bg' : 'text-ink-muted hover:text-ink'}`}>
            {value === 'all' ? 'Todos' : value}
          </button>)}
        </div>
      </div>

      <div aria-live="polite">
        {loading && <p className="mb-2 text-2xs text-ink-faint">Buscando…</p>}
        {failed && <p className="card p-4 text-sm text-amber-300">No fue posible completar la búsqueda. Inténtalo nuevamente.</p>}
        {touched && !loading && !failed && empty && (q.trim() || tour !== 'all') && <p className="card p-4 text-sm text-ink-muted">Sin resultados para esta búsqueda.</p>}
      </div>

      {players.length > 0 && <section className="mb-5" aria-labelledby="search-players">
        <h3 id="search-players" className="mb-2 text-sm font-semibold text-ink">Jugadores y jugadoras <span className="text-ink-faint">({players.length})</span></h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{players.map((player) => <a key={player.id} href={playerPath(player.id, player.slug)} className="card-hover block p-3 no-underline">
          <div className="flex items-center justify-between gap-2"><span className="font-medium text-ink">{player.name}</span><span className={`chip ${tourChip(player.tour)}`}>{player.tour}</span></div>
          <p className="mt-1 text-2xs text-ink-faint">{player.matches} partidos{player.lastPlayed ? ` · último ${fmtDate(player.lastPlayed)}` : ''}</p>
          <p className="mt-1 text-2xs text-court-ink">Ver perfil →</p>
        </a>)}</div>
      </section>}

      {tournaments.length > 0 && <section className="mb-5" aria-labelledby="search-tournaments">
        <h3 id="search-tournaments" className="mb-2 text-sm font-semibold text-ink">Torneos <span className="text-ink-faint">({tournaments.length})</span></h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{tournaments.map((item) => <a key={item.id} href={`/tournament/${item.id}`} className="card-hover block p-3 no-underline">
          <div className="flex items-center justify-between gap-2"><span className="font-medium text-ink">{item.name}</span><span className={`chip ${tourChip(item.tour)}`}>{item.tour}</span></div>
          <p className="mt-1 text-2xs text-ink-faint">{item.season}{item.series ? ` · ${item.series}` : ''} · {item.matches} partidos</p>
        </a>)}</div>
      </section>}

      {(!touched || matches.length > 0) && <section aria-labelledby="search-matches">
        {touched && <h3 id="search-matches" className="mb-2 text-sm font-semibold text-ink">Partidos <span className="text-ink-faint">({matches.length})</span></h3>}
        <MatchList matches={matches} aces={aces} />
      </section>}
    </div>
  );
}
