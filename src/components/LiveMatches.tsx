import { useEffect, useState } from 'react';
import type { LiveMatchRow } from '../lib/queries';
import { SURFACE_ES } from '../lib/format';
import { setCells, currentLeader } from '../lib/score';

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
    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-75" />
    <span className="relative inline-flex h-2 w-2 rounded-full bg-live" />
  </span>;
}

function Card({ m }: { m: LiveMatchRow }) {
  // El marcador se pinta SET A SET, en columnas alineadas entre los dos
  // jugadores. Antes cada uno llevaba un número suelto ("2" arriba, "3" abajo)
  // sin decir si eran sets o juegos y sin señalar a nadie como líder: el
  // marcador se leía al revés con toda facilidad.
  const cells = setCells(m.scoreP1, m.scoreP2);
  const leader = currentLeader(m.scoreP1, m.scoreP2);
  const p1Lead = leader === 1;
  const p2Lead = leader === 2;
  const enCurso = cells.some((c) => c.inPlay);
  return (
    <a
      href={`/match/${m.id}`}
      className="block rounded-xl border border-live/40 bg-live/[0.06] p-3.5 no-underline transition hover:border-live/60"
    >
      <div className="mb-2 flex items-center justify-between text-2xs">
        <span className="flex items-center gap-1.5 font-semibold text-live">{pulse()} EN VIVO</span>
        <span className="text-ink-faint">
          {m.tour}{m.surface ? ` · ${SURFACE_ES[m.surface] ?? m.surface}` : ''}{m.round ? ` · ${m.round}` : ''}
        </span>
      </div>
      <div className="space-y-1">
        {([['p1', m.p1Name, p1Lead], ['p2', m.p2Name, p2Lead]] as const).map(([lado, nombre, lidera]) => (
          <div key={lado} className="flex items-center justify-between gap-2">
            <span className={`truncate text-sm ${lidera ? 'font-semibold text-ink' : 'text-ink-muted'}`}>
              {lidera ? '▸ ' : '  '}{nombre}
            </span>
            {cells.length ? (
              <span className="flex shrink-0 gap-1.5">
                {cells.map((c, i) => {
                  const propio = lado === 'p1' ? c.a : c.b;
                  const rival = lado === 'p1' ? c.b : c.a;
                  return (
                    <span
                      key={i}
                      // El set en juego se distingue del resto: es un marcador
                      // provisional, no un set ganado.
                      className={`w-6 rounded text-center font-mono text-base tabular-nums ${
                        c.inPlay
                          ? 'bg-live/15 text-live'
                          : propio > rival
                            ? 'font-semibold text-court'
                            : 'text-ink-faint'
                      }`}
                    >
                      {propio}
                    </span>
                  );
                })}
              </span>
            ) : (
              <span className="shrink-0 font-mono text-base text-ink-faint">–</span>
            )}
          </div>
        ))}
      </div>
      {enCurso && (
        <p className="mt-1.5 text-right text-2xs text-ink-faint">
          juegos por set · <span className="text-live">set en juego</span>
        </p>
      )}
      {m.probP1 !== null && (
        <div className="mt-2 border-t border-live/20 pt-1.5 text-2xs text-ink-faint">
          Pronóstico: {m.p1Name.split(' ')[0]} {Math.round(m.probP1 * 100)}% · {m.p2Name.split(' ')[0]} {Math.round((1 - m.probP1) * 100)}%
        </div>
      )}
    </a>
  );
}

export default function LiveMatches({ initial = [] }: { initial?: LiveMatchRow[] }) {
  const [matches, setMatches] = useState<LiveMatchRow[]>(initial);
  const [agoSec, setAgoSec] = useState(0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch('/api/live', { cache: 'no-store' });
        const data = await res.json();
        if (!alive) return;
        setMatches(data.matches ?? []);
        setAgoSec(0);
      } catch { /* red intermitente: se reintenta en el siguiente tick */ }
    };
    // 20 s: el servidor cachea 12 s, así que no se martillea a ESPN.
    const poll = setInterval(tick, 20_000);
    const clock = setInterval(() => setAgoSec((s) => s + 1), 1_000);
    // Al volver a la pestaña, refresca de inmediato en vez de esperar al tick.
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(poll); clearInterval(clock);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!matches.length) return null;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          {pulse()} En vivo
        </h2>
        <span className="text-2xs tabular-nums text-ink-faint" aria-live="polite">
          actualizado hace {agoSec < 60 ? `${agoSec}s` : `${Math.floor(agoSec / 60)} min`}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {matches.map((m) => <Card key={m.id} m={m} />)}
      </div>
    </section>
  );
}
