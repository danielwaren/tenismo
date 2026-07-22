import { useEffect, useState } from 'react';
import type { LiveMatchRow } from '../lib/queries';
import { SURFACE_ES } from '../lib/format';

/**
 * Tarjetas de partidos EN VIVO, con etiqueta "VIVO" y marcador en directo.
 * Se refresca sola cada 30 s consultando /api/live (los marcadores los actualiza
 * scores-ingest desde The Odds API).
 *
 * El marcador es GRUESO: sets ganados por jugador, que es lo que da el
 * proveedor. No hay punto a punto. Solo aparecen torneos cubiertos en curso.
 */
function pulse() {
  return <span className="relative flex h-2 w-2">
    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
    <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
  </span>;
}

function Card({ m }: { m: LiveMatchRow }) {
  const p1Lead = m.scoreP1 !== null && m.scoreP2 !== null && Number(m.scoreP1) > Number(m.scoreP2);
  const p2Lead = m.scoreP1 !== null && m.scoreP2 !== null && Number(m.scoreP2) > Number(m.scoreP1);
  return (
    <a
      href={`/match/${m.id}`}
      className="block rounded-lg border border-red-900/50 bg-red-950/10 p-3 no-underline transition hover:border-red-800/70"
    >
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-semibold text-red-400">
          {pulse()} VIVO
        </span>
        <span className="text-slate-500">
          {m.tour}{m.surface ? ` · ${SURFACE_ES[m.surface] ?? m.surface}` : ''}{m.round ? ` · ${m.round}` : ''}
        </span>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className={`text-sm font-medium ${p1Lead ? 'text-slate-100' : 'text-slate-300'}`}>{m.p1Name}</span>
          <span className={`font-mono text-lg tabular-nums ${p1Lead ? 'text-court-400' : 'text-slate-400'}`}>{m.scoreP1 ?? '–'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className={`text-sm font-medium ${p2Lead ? 'text-slate-100' : 'text-slate-300'}`}>{m.p2Name}</span>
          <span className={`font-mono text-lg tabular-nums ${p2Lead ? 'text-court-400' : 'text-slate-400'}`}>{m.scoreP2 ?? '–'}</span>
        </div>
      </div>
      {m.probP1 !== null && (
        <div className="mt-2 border-t border-red-900/30 pt-1.5 text-[11px] text-slate-500">
          Pronóstico: {m.p1Name.split(' ')[0]} {Math.round(m.probP1 * 100)}% · {m.p2Name.split(' ')[0]} {Math.round((1 - m.probP1) * 100)}%
        </div>
      )}
    </a>
  );
}

export default function LiveMatches({ initial = [] }: { initial?: LiveMatchRow[] }) {
  const [matches, setMatches] = useState<LiveMatchRow[]>(initial);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch('/api/live');
        const data = await res.json();
        if (alive) setMatches(data.matches ?? []);
      } catch { /* red intermitente: se reintenta en el siguiente tick */ }
    };
    const timer = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  if (!matches.length) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
        {pulse()} En vivo
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {matches.map((m) => <Card key={m.id} m={m} />)}
      </div>
    </section>
  );
}
