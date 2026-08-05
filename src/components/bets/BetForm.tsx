import { useState, useEffect, useCallback, useRef } from 'react';
import ForecastCard from './ForecastCard';
import PlayerSearchInput from './PlayerSearchInput';
import { MARKETS, SCOPES, TOURS, type ForecastResponse, type MarketType, type BankrollSummary } from './types';
import { money, odds as fmtOdds } from './format';

/**
 * Formulario de registro. Toda la validación se repite en el servidor
 * (src/pages/api/bets/index.ts) — esto es solo la primera barrera y el
 * cálculo del preview.
 */
export default function BetForm({
  summary,
  onCreated,
}: {
  summary: BankrollSummary;
  onCreated: () => void;
}) {
  const [tour, setTour] = useState<string>('ATP');
  const [tournament, setTournament] = useState('');
  const [surface, setSurface] = useState('');
  const [playerOne, setPlayerOne] = useState('');
  const [playerTwo, setPlayerTwo] = useState('');
  const [marketType, setMarketType] = useState<MarketType>('match_winner');
  const [side, setSide] = useState<'p1' | 'p2' | 'over' | 'under'>('p1');
  const [line, setLine] = useState('');
  const [scope, setScope] = useState('match');
  const [oddsDecimal, setOddsDecimal] = useState('');
  const [stake, setStake] = useState('');
  const [bookmaker, setBookmaker] = useState('');
  const [isLive, setIsLive] = useState(false);
  const [liveScore, setLiveScore] = useState('');
  const [serverAtEntry, setServerAtEntry] = useState('');
  const [notes, setNotes] = useState('');

  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const marketDef = MARKETS.find((m) => m.value === marketType)!;
  const oddsNum = Number(oddsDecimal);
  const stakeNum = Number(stake);
  const validOdds = Number.isFinite(oddsNum) && oddsNum > 1;
  const validStake = Number.isFinite(stakeNum) && stakeNum > 0;

  const selectionLabel = (() => {
    if (marketDef.sideKind === 'overunder') {
      return `${side === 'over' ? 'Más' : 'Menos'} de ${line || '?'} juegos`;
    }
    const who = side === 'p1' ? playerOne : playerTwo;
    if (marketDef.needsLine) return `${who || '?'} ${line ? (Number(line) > 0 ? `+${line}` : line) : ''}`.trim();
    return who || '?';
  })();

  const potentialReturn = validOdds && validStake ? stakeNum * oddsNum : 0;
  const potentialProfit = potentialReturn - (validStake ? stakeNum : 0);
  const balanceAfter = summary.availableBalance - (validStake ? stakeNum : 0);
  const stakeTooBig = validStake && stakeNum > summary.availableBalance;

  // Consulta del pronóstico, con debounce: cambia al escribir jugadores/cuota.
  const debounceRef = useRef<number | null>(null);
  const fetchForecast = useCallback(() => {
    if (!playerOne.trim() || !playerTwo.trim() || !validOdds) {
      setForecast(null);
      return;
    }
    setForecastLoading(true);
    setForecastError(null);
    fetch('/api/bets/forecast', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tour, tournament, playerOne, playerTwo, surface: surface || null,
        marketType, side, line: line === '' ? null : Number(line),
        market: marketDef.label, selection: selectionLabel,
        oddsDecimal: oddsNum, isLive, liveScoreAtEntry: liveScore || null,
        serverAtEntry: serverAtEntry || null,
      }),
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'Error al consultar el pronóstico.');
        setForecast(body as ForecastResponse);
      })
      .catch((e: Error) => setForecastError(e.message))
      .finally(() => setForecastLoading(false));
  }, [tour, tournament, playerOne, playerTwo, surface, marketType, side, line, oddsNum, validOdds, isLive, liveScore, serverAtEntry, marketDef.label, selectionLabel]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(fetchForecast, 600);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [fetchForecast]);

  const canSubmit = validOdds && validStake && !stakeTooBig && playerOne.trim() && playerTwo.trim() && selectionLabel.trim() !== '?';

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/bets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bankrollId: summary.id, tournament, tour, surface: surface || null,
          playerOne, playerTwo, market: marketDef.label, marketType, selection: selectionLabel,
          side, line: line === '' ? null : Number(line), scope,
          oddsDecimal: oddsNum, stake: stakeNum, bookmaker: bookmaker || null,
          isLive, liveScoreAtEntry: liveScore || null, serverAtEntry: serverAtEntry || null,
          notes: notes || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'No se pudo registrar la apuesta.');
      // Limpia solo lo específico de la apuesta; conserva torneo/jugadores para
      // registrar varias del mismo partido seguidas.
      setOddsDecimal(''); setStake(''); setLine(''); setNotes('');
      setConfirming(false);
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = 'w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint';
  const labelClass = 'mb-1 block text-2xs uppercase tracking-wide text-ink-muted';

  return (
    <div className="space-y-4">
      <section className="card p-4 sm:p-5">
        <h2 className="mb-3 font-display text-base font-semibold">Registrar apuesta</h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="tour">Circuito</label>
            <select id="tour" className={inputClass} value={tour} onChange={(e) => setTour(e.target.value)}>
              {TOURS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="tournament">Torneo</label>
            <input id="tournament" className={inputClass} value={tournament} onChange={(e) => setTournament(e.target.value)} placeholder="National Bank Open" />
          </div>
          <div>
            <label className={labelClass} htmlFor="p1">Jugador 1</label>
            <PlayerSearchInput id="p1" value={playerOne} onChange={setPlayerOne} placeholder="Carlos Alcaraz" />
          </div>
          <div>
            <label className={labelClass} htmlFor="p2">Jugador 2</label>
            <PlayerSearchInput id="p2" value={playerTwo} onChange={setPlayerTwo} placeholder="Jannik Sinner" />
          </div>
          <div>
            <label className={labelClass} htmlFor="surface">Superficie</label>
            <select id="surface" className={inputClass} value={surface} onChange={(e) => setSurface(e.target.value)}>
              <option value="">Sin especificar</option>
              <option value="hard">Dura</option>
              <option value="clay">Arcilla</option>
              <option value="grass">Hierba</option>
              <option value="carpet">Moqueta</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="market">Mercado</label>
            <select id="market" className={inputClass} value={marketType} onChange={(e) => {
              const v = e.target.value as MarketType;
              setMarketType(v);
              const def = MARKETS.find((m) => m.value === v)!;
              setSide(def.sideKind === 'overunder' ? 'over' : 'p1');
            }}>
              {MARKETS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          {marketDef.sideKind && (
            <div>
              <label className={labelClass} htmlFor="side">Selección</label>
              <select id="side" className={inputClass} value={side} onChange={(e) => setSide(e.target.value as typeof side)}>
                {marketDef.sideKind === 'overunder' ? (
                  <>
                    <option value="over">Más de (Over)</option>
                    <option value="under">Menos de (Under)</option>
                  </>
                ) : (
                  <>
                    <option value="p1">{playerOne || 'Jugador 1'}</option>
                    <option value="p2">{playerTwo || 'Jugador 2'}</option>
                  </>
                )}
              </select>
            </div>
          )}

          {marketDef.needsLine && (
            <div>
              <label className={labelClass} htmlFor="line">Línea exacta</label>
              <input id="line" className={inputClass} inputMode="decimal" value={line} onChange={(e) => setLine(e.target.value)} placeholder="22.5" />
            </div>
          )}

          <div>
            <label className={labelClass} htmlFor="scope">Alcance</label>
            <select id="scope" className={inputClass} value={scope} onChange={(e) => setScope(e.target.value)}>
              {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="odds">Cuota decimal</label>
            <input id="odds" className={inputClass} inputMode="decimal" value={oddsDecimal} onChange={(e) => setOddsDecimal(e.target.value)} placeholder="2.40" />
            {oddsDecimal !== '' && !validOdds && <p className="mt-1 text-2xs text-live">La cuota debe ser mayor que 1.</p>}
          </div>
          <div>
            <label className={labelClass} htmlFor="stake">Stake</label>
            <input id="stake" className={inputClass} inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} placeholder="10" />
            {stakeTooBig && <p className="mt-1 text-2xs text-live">Supera la caja disponible ({money(summary.availableBalance, summary.currency)}).</p>}
          </div>
          <div>
            <label className={labelClass} htmlFor="book">Casa</label>
            <input id="book" className={inputClass} value={bookmaker} onChange={(e) => setBookmaker(e.target.value)} placeholder="Bet365" />
          </div>
        </div>

        {/* Live: nunca se asume quién saca — si no se registra, no se interpreta el marcador. */}
        <div className="mt-4 rounded-lg border border-line bg-surface-2/40 p-3">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={isLive} onChange={(e) => setIsLive(e.target.checked)} className="h-4 w-4" />
            Apuesta en vivo
          </label>
          {isLive && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="score">Marcador al entrar</label>
                <input id="score" className={inputClass} value={liveScore} onChange={(e) => setLiveScore(e.target.value)} placeholder="6-4 3-2, 30-15" />
              </div>
              <div>
                <label className={labelClass} htmlFor="server">Quién saca</label>
                <select id="server" className={inputClass} value={serverAtEntry} onChange={(e) => setServerAtEntry(e.target.value)}>
                  <option value="">No registrado</option>
                  <option value="p1">{playerOne || 'Jugador 1'}</option>
                  <option value="p2">{playerTwo || 'Jugador 2'}</option>
                </select>
                {!serverAtEntry && (
                  <p className="mt-1 text-2xs leading-relaxed text-ink-faint">
                    Sin esto, un 30-40 o una ventaja no se pueden interpretar. No se asume.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-3">
          <label className={labelClass} htmlFor="notes">Notas</label>
          <textarea id="notes" className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && <p className="mt-3 rounded-lg border border-live/40 bg-live/10 p-2.5 text-sm text-live">{error}</p>}

        {!confirming ? (
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => setConfirming(true)}
            className="mt-4 w-full rounded-lg bg-court px-4 py-3 text-sm font-semibold text-bg disabled:opacity-40"
          >
            Revisar y registrar
          </button>
        ) : (
          <div className="mt-4 rounded-lg border border-court/40 bg-court/5 p-3">
            <h3 className="mb-2 text-sm font-semibold text-ink">Confirmar apuesta</h3>
            <dl className="space-y-1 text-2xs text-ink-muted">
              <div className="flex justify-between gap-2"><dt>Partido</dt><dd className="text-right text-ink">{playerOne} vs {playerTwo}</dd></div>
              <div className="flex justify-between gap-2"><dt>Mercado</dt><dd className="text-right text-ink">{marketDef.label}</dd></div>
              <div className="flex justify-between gap-2"><dt>Selección</dt><dd className="text-right text-ink">{selectionLabel}</dd></div>
              {marketDef.needsLine && <div className="flex justify-between gap-2"><dt>Línea</dt><dd className="font-mono tabular-nums text-ink">{line}</dd></div>}
              <div className="flex justify-between gap-2"><dt>Cuota</dt><dd className="font-mono tabular-nums text-ink">{fmtOdds(oddsNum)}</dd></div>
              <div className="flex justify-between gap-2"><dt>Stake</dt><dd className="font-mono tabular-nums text-ink">{money(stakeNum, summary.currency)}</dd></div>
              <div className="flex justify-between gap-2"><dt>Retorno potencial</dt><dd className="font-mono tabular-nums text-court">{money(potentialReturn, summary.currency)}</dd></div>
              <div className="flex justify-between gap-2"><dt>Beneficio potencial</dt><dd className="font-mono tabular-nums text-court">{money(potentialProfit, summary.currency)}</dd></div>
              <div className="flex justify-between gap-2 border-t border-line pt-1"><dt>Caja tras colocarla</dt><dd className="font-mono tabular-nums text-ink">{money(balanceAfter, summary.currency)}</dd></div>
            </dl>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-line px-4 py-3 text-sm text-ink-muted">
                Volver
              </button>
              <button type="button" disabled={submitting} onClick={submit} className="rounded-lg bg-court px-4 py-3 text-sm font-semibold text-bg disabled:opacity-40">
                {submitting ? 'Guardando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        )}
      </section>

      <ForecastCard data={forecast} loading={forecastLoading} error={forecastError} />
    </div>
  );
}
