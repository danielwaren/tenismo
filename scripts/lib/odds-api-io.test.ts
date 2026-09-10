import { describe, it, expect } from 'vitest';
import {
  mlFromOdds, totalsFromOdds, spreadsFromOdds,
  tourFromLeague, isLowTierLeague, surfaceAndBestOf, tournamentName,
  type IoOddsEvent,
} from './odds-api-io';

/** Evento con la forma documentada en docs.odds-api.io (bookmakers{} → mercados). */
function ev(bookmakers: IoOddsEvent['bookmakers']): IoOddsEvent {
  return { id: 1, home: 'Player A', away: 'Player B', date: '2026-09-15T12:00:00Z', status: 'pending', bookmakers };
}

describe('mlFromOdds', () => {
  it('promedia y saca el máximo por lado sobre todas las casas', () => {
    const r = mlFromOdds(ev({
      Bet365: [{ name: 'ML', odds: [{ home: '1.50', away: '2.60' }] }],
      Pinnacle: [{ name: 'ML', odds: [{ home: '1.55', away: '2.50' }] }],
    }))!;
    expect(r.home.books).toBe(2);
    expect(r.home.mean).toBeCloseTo(1.525, 3);
    expect(r.home.max).toBe(1.55);
    expect(r.away.mean).toBeCloseTo(2.55, 3);
  });

  it('acepta variantes del nombre de mercado y precios numéricos', () => {
    const r = mlFromOdds(ev({ X: [{ name: 'Moneyline', odds: [{ home: 1.8, away: 2.0 }] }] }))!;
    expect(r.home.mean).toBe(1.8);
  });

  it('devuelve null si falta un lado', () => {
    expect(mlFromOdds(ev({ X: [{ name: 'ML', odds: [{ home: '1.5' }] }] }))).toBeNull();
    expect(mlFromOdds(ev({}))).toBeNull();
  });
});

describe('totalsFromOdds', () => {
  it('se queda con la línea hdp más cubierta', () => {
    const r = totalsFromOdds(ev({
      A: [{ name: 'Totals Games', odds: [{ hdp: 22.5, over: '1.90', under: '1.90' }, { hdp: 23.5, over: '2.10', under: '1.72' }] }],
      B: [{ name: 'Totals Games', odds: [{ hdp: 22.5, over: '1.88', under: '1.92' }] }],
    }))!;
    expect(r.line).toBe(22.5); // 2 casas contra 1
    expect(r.a.books).toBe(2);
    expect(r.a.mean).toBeCloseTo(1.89, 2);
  });

  it('devuelve null sin datos de totales', () => {
    expect(totalsFromOdds(ev({ A: [{ name: 'ML', odds: [{ home: '1.5', away: '2.5' }] }] }))).toBeNull();
  });
});

describe('spreadsFromOdds', () => {
  it('usa el hdp con signo tal cual (hándicap de home)', () => {
    const r = spreadsFromOdds(ev({
      A: [{ name: 'Spread Games', odds: [{ hdp: -3.5, home: '1.95', away: '1.85' }] }],
      B: [{ name: 'Spread Games', odds: [{ hdp: -3.5, home: '1.90', away: '1.90' }] }],
    }))!;
    expect(r.line).toBe(-3.5); // home favorito, da 3.5 juegos
    expect(r.a.mean).toBeCloseTo(1.925, 3);
    expect(r.b.mean).toBeCloseTo(1.875, 3);
  });

  it('ignora hdp = 0 y filas incompletas', () => {
    expect(spreadsFromOdds(ev({ A: [{ name: 'Spread Games', odds: [{ hdp: 0, home: '1.9', away: '1.9' }] }] }))).toBeNull();
  });
});

describe('metadatos de liga', () => {
  it('detecta el circuito por el nombre', () => {
    expect(tourFromLeague('WTA - US Open')).toBe('WTA');
    expect(tourFromLeague('ATP Challenger - Genova')).toBe('ATP');
    expect(tourFromLeague('ATP - US Open')).toBe('ATP');
    expect(tourFromLeague(undefined)).toBe('ATP');
  });

  it('marca ITF/Futures para descartar', () => {
    expect(isLowTierLeague('ITF Men - M25 Villena')).toBe(true);
    expect(isLowTierLeague('ATP - Wimbledon')).toBe(false);
  });

  it('superficie y best_of solo para Slams', () => {
    expect(surfaceAndBestOf('ATP - Wimbledon', 'ATP')).toEqual({ surface: 'grass', bestOf: 5 });
    expect(surfaceAndBestOf('WTA - Roland Garros', 'WTA')).toEqual({ surface: 'clay', bestOf: 3 });
    expect(surfaceAndBestOf('ATP - Cincinnati Masters', 'ATP')).toEqual({ surface: null, bestOf: 3 });
  });

  it('limpia el prefijo del circuito del nombre de torneo', () => {
    expect(tournamentName('ATP - US Open')).toBe('US Open');
    expect(tournamentName('WTA – Guadalajara Open')).toBe('Guadalajara Open');
    expect(tournamentName('Challenger Genova')).toBe('Challenger Genova');
  });
});
