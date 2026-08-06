import { useEffect, useState } from 'react';
import type { MatchAces } from '../lib/queries';
import type { LiveDisplayMatch, LiveProviderStatus } from '../lib/live';
import { SURFACE_ES } from '../lib/format';
import { setCells, currentLeader } from '../lib/score';
import { matchPath, playerPath } from '../lib/urls';

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

function Card({ m, ace }: { m: LiveDisplayMatch; ace?: MatchAces }) {
  // El marcador se pinta SET A SET, en columnas alineadas entre los dos
  // jugadores. Antes cada uno llevaba un número suelto ("2" arriba, "3" abajo)
  // sin decir si eran sets o juegos y sin señalar a nadie como líder: el
  // marcador se leía al revés con toda facilidad.
  const cells = setCells(m.scoreP1, m.scoreP2);
  const leader = currentLeader(m.scoreP1, m.scoreP2);
  const p1Lead = leader === 1;
  const p2Lead = leader === 2;
  const enCurso = cells.some((c) => c.inPlay);
  const content = (
    <>
      <div className="mb-2 flex items-center justify-between text-2xs">
        <span className="flex items-center gap-1.5 font-semibold text-live">{pulse()} EN VIVO</span>
        <span className="text-ink-faint">
          {m.tour}{m.surface ? ` · ${SURFACE_ES[m.surface] ?? m.surface}` : ''}{m.round ? ` · ${m.round}` : ''}
        </span>
      </div>
      <div className="space-y-1">
        {([['p1', m.p1Name, p1Lead, m.p1Id, m.p1Slug], ['p2', m.p2Name, p2Lead, m.p2Id, m.p2Slug]] as const).map(([lado, nombre, lidera, playerId, playerSlug]) => (
          <div key={lado} className="flex items-center justify-between gap-2">
            {playerId === null ? (
              <span className={`truncate text-sm ${lidera ? 'font-semibold text-ink' : 'text-ink-muted'}`}>{lidera ? '▸ ' : '  '}{nombre}</span>
            ) : (
              <a href={playerPath(playerId, playerSlug)} className={`truncate text-sm underline-offset-2 hover:text-court hover:underline ${lidera ? 'font-semibold text-ink' : 'text-ink-muted'}`}>{lidera ? '▸ ' : '  '}{nombre}</a>
            )}
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
      {(m.probP1 !== null || ace) && (
        <div className="mt-2 space-y-0.5 border-t border-live/20 pt-1.5 text-2xs text-ink-faint">
          {m.probP1 !== null && (
            <div>
              Pronóstico: {m.p1Name.split(' ')[0]} {Math.round(m.probP1 * 100)}% · {m.p2Name.split(' ')[0]} {Math.round((1 - m.probP1) * 100)}%
            </div>
          )}
          {ace && (
            // Proyección para el partido COMPLETO, no lo que lleva servido: no
            // tenemos aces en directo, solo el histórico de Tennis Abstract.
            <div>
              Aces previstos: {m.p1Name.split(' ')[0]}{' '}
              <span className="font-mono tabular-nums text-court">{ace.p1.expected.toFixed(1).replace('.', ',')}</span>
              {' · '}{m.p2Name.split(' ')[0]}{' '}
              <span className="font-mono tabular-nums text-court">{ace.p2.expected.toFixed(1).replace('.', ',')}</span>
              {' · total '}
              <span className="font-mono tabular-nums">{ace.total.toFixed(1).replace('.', ',')}</span>
            </div>
          )}
        </div>
      )}
      {m.resolution !== 'linked' && (
        <p className="mt-2 border-t border-live/20 pt-1.5 text-2xs text-ink-faint">
          Marcador disponible · perfil, cuotas y pronóstico pendientes de vinculación.
        </p>
      )}
      {m.internalId !== null && <a href={matchPath({ id: m.internalId, p1Slug: m.p1Slug, p2Slug: m.p2Slug })} className="mt-2 inline-flex text-2xs text-court-ink no-underline hover:underline">Ver partido →</a>}
    </>
  );
  const className = 'block rounded-xl border border-live/40 bg-live/[0.06] p-3.5 no-underline transition hover:border-live/60';
  return <article className={className}>{content}</article>;
}

export default function LiveMatches({
  initial = [],
  initialAces = {},
  initialStatus = 'ok',
  initialCoverage = { received: 0, linked: 0, unresolved: 0, providersAvailable: 2 },
}: {
  initial?: LiveDisplayMatch[];
  initialAces?: Record<number, MatchAces>;
  initialStatus?: LiveProviderStatus;
  initialCoverage?: { received: number; linked: number; unresolved: number; providersAvailable: number };
}) {
  const [matches, setMatches] = useState<LiveDisplayMatch[]>(initial);
  const [aces, setAces] = useState<Record<number, MatchAces>>(initialAces);
  const [status, setStatus] = useState<LiveProviderStatus>(initialStatus);
  const [coverage, setCoverage] = useState(initialCoverage);
  const [agoSec, setAgoSec] = useState(0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch('/api/live', { cache: 'no-store' });
        const data = await res.json();
        if (!alive) return;
        setMatches(data.matches ?? []);
        setAces(data.aces ?? {});
        setStatus(data.status ?? 'unavailable');
        setCoverage(data.coverage ?? initialCoverage);
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

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div><p className="mb-1 text-2xs font-semibold uppercase tracking-[0.18em] text-live">Ahora mismo</p><h2 className="flex items-center gap-2 font-display text-xl font-semibold sm:text-2xl">{pulse()} Partidos en vivo</h2></div>
        <span className="text-2xs tabular-nums text-ink-faint" aria-live="polite">
          actualizado hace {agoSec < 60 ? `${agoSec}s` : `${Math.floor(agoSec / 60)} min`}
        </span>
      </div>
      {status !== 'ok' && (
        <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
          {status === 'unavailable'
            ? 'El proveedor en vivo no está disponible. Conservamos la última información válida cuando existe.'
            : `Cobertura parcial: ${coverage.linked} de ${coverage.received} partidos vinculados; los demás se muestran sin pronóstico.`}
        </p>
      )}
      {matches.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {matches.map((m) => <Card key={m.id} m={m} ace={m.internalId === null ? undefined : aces[m.internalId]} />)}
        </div>
      ) : (
        <div className="card p-4 text-sm text-ink-muted">
          {status === 'unavailable' ? 'No fue posible comprobar los partidos en vivo.' : 'No hay partidos en vivo ahora mismo.'}
        </div>
      )}
    </section>
  );
}
