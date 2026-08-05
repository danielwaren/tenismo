import { useState, useEffect, useRef } from 'react';

interface TournamentHit {
  id: number;
  name: string;
  tour: string;
  surface: string | null;
  live: boolean;
}

const SURFACE_LABEL: Record<string, string> = {
  hard: 'Dura', clay: 'Arcilla', grass: 'Hierba', carpet: 'Moqueta',
};

/**
 * Selector de torneo con la lista de los que se juegan AHORA o empiezan ya.
 *
 * Escribirlo a mano se presta a erratas y el nombre es lo que después permite
 * cruzar la apuesta con el partido. La lista es corta, así que se pide una vez
 * al abrir y se filtra en memoria — se muestra ENTERA al enfocar, sin escribir
 * nada, porque lo normal es apostar a algo que está en curso.
 *
 * Sigue admitiendo texto libre: torneos que la base no cubra (Challenger, ITF)
 * se pueden escribir igual.
 */
export default function TournamentSelect({
  id, value, onChange, onPick, placeholder,
}: {
  id: string;
  value: string;
  onChange: (name: string) => void;
  /** Avisa del circuito y la superficie del torneo elegido, para autocompletarlos. */
  onPick?: (t: TournamentHit) => void;
  placeholder?: string;
}) {
  const [all, setAll] = useState<TournamentHit[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [loaded, setLoaded] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/tournaments/active')
      .then((r) => r.json())
      .then((b) => setAll(b.tournaments ?? []))
      .catch(() => setAll([]))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const q = value.trim().toLowerCase();
  const hits = q ? all.filter((t) => t.name.toLowerCase().includes(q)) : all;
  const exacto = all.some((t) => t.name === value);

  function pick(t: TournamentHit) {
    onChange(t.name);
    onPick?.(t);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || hits.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); pick(hits[activeIdx]); }
    else if (e.key === 'Escape') setOpen(false);
  }

  const inputClass = 'w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint';

  return (
    <div ref={boxRef} className="relative">
      <input
        id={id}
        className={inputClass}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActiveIdx(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
      />
      {value.trim() && exacto && (
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-2xs text-court" title="Torneo de la base de datos">✓</span>
      )}
      {open && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-surface shadow-lg">
          {!loaded && <li className="px-3 py-2 text-2xs text-ink-faint">Cargando torneos…</li>}
          {loaded && hits.length === 0 && (
            <li className="px-3 py-2 text-2xs text-ink-faint">
              Ningún torneo en curso coincide. Puedes escribirlo a mano.
            </li>
          )}
          {hits.map((t, i) => (
            <li key={t.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(t)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${i === activeIdx ? 'bg-surface-2 text-ink' : 'text-ink-muted'}`}
              >
                <span className="flex items-center gap-1.5">
                  {t.live && <span className="inline-block h-1.5 w-1.5 rounded-full bg-live" aria-label="en vivo" />}
                  {t.name}
                </span>
                <span className="shrink-0 text-2xs uppercase tracking-wide text-ink-faint">
                  {t.tour}{t.surface ? ` · ${SURFACE_LABEL[t.surface] ?? t.surface}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
