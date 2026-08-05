import { useState, useEffect, useRef, useCallback } from 'react';

interface PlayerHit { id: number; name: string; slug: string; tour: string }

/**
 * Input de jugador con autocompletado contra `players`.
 *
 * Por qué existe: el input de texto libre que había antes dejaba escribir
 * cualquier cosa, y el pronóstico del modelo (resolvePlayer en
 * model-forecast.ts) necesita el nombre TAL COMO está en la base para poder
 * encontrar el jugador — un acento de menos o un apellido mal escrito y el
 * "Mi pronóstico" simplemente no aparece, sin avisar de por qué.
 *
 * Sigue admitiendo texto libre (jugadores fuera de la base, Challenger/ITF
 * poco cubiertos) — elegir una sugerencia es lo recomendado, no obligatorio.
 */
export default function PlayerSearchInput({
  id, value, onChange, placeholder,
}: {
  id: string;
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
}) {
  const [hits, setHits] = useState<PlayerHit[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [matched, setMatched] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const search = useCallback((q: string) => {
    if (q.trim().length < 2) { setHits([]); return; }
    fetch(`/api/players/search?q=${encodeURIComponent(q.trim())}`)
      .then((r) => r.json())
      .then((body) => setHits(body.players ?? []))
      .catch(() => setHits([]));
  }, []);

  useEffect(() => {
    // Si el valor coincide EXACTO con un nombre ya buscado, no hace falta
    // seguir mostrando la lista ni marcar "sin confirmar".
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => search(value), 250);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [value, search]);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  function pick(hit: PlayerHit) {
    onChange(hit.name);
    setMatched(true);
    setOpen(false);
    setHits([]);
  }

  function handleChange(v: string) {
    onChange(v);
    setMatched(false);
    setOpen(true);
    setActiveIdx(-1);
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
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
      />
      {value.trim() && (
        matched ? (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-2xs text-court" title="Coincide con la base de datos">✓</span>
        ) : (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-2xs text-ink-faint" title="Sin confirmar contra la base de datos">?</span>
        )
      )}
      {open && hits.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-surface shadow-lg">
          {hits.map((h, i) => (
            <li key={h.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(h)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${i === activeIdx ? 'bg-surface-2 text-ink' : 'text-ink-muted'}`}
              >
                <span>{h.name}</span>
                <span className="text-2xs uppercase tracking-wide text-ink-faint">{h.tour}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
