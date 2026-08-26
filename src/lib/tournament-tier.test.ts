import { describe, it, expect } from 'vitest';
import { isNotableTournament } from './tournament-tier';

describe('isNotableTournament', () => {
  it('incluye cualquier Challenger, sin mirar nombre ni series', () => {
    expect(isNotableTournament({ tour: 'Challenger', series: null, name: 'Cancun challenger' })).toBe(true);
  });

  it('reconoce Masters 1000 / WTA1000 por `series`', () => {
    expect(isNotableTournament({ tour: 'ATP', series: 'Masters 1000', name: 'Western & Southern Financial Group Masters' })).toBe(true);
    expect(isNotableTournament({ tour: 'WTA', series: 'WTA1000', name: 'Western & Southern Financial Group Women\'s Open' })).toBe(true);
  });

  it('reconoce un Grand Slam por el nombre aunque `series` venga null (caso real observado)', () => {
    expect(isNotableTournament({ tour: 'ATP', series: null, name: 'US Open' })).toBe(true);
    expect(isNotableTournament({ tour: 'WTA', series: null, name: 'US Open' })).toBe(true);
    expect(isNotableTournament({ tour: 'ATP', series: null, name: 'Wimbledon' })).toBe(true);
  });

  it('descarta un ATP500/ATP250 normal', () => {
    expect(isNotableTournament({ tour: 'ATP', series: 'ATP500', name: 'Citi Open' })).toBe(false);
    expect(isNotableTournament({ tour: 'WTA', series: null, name: 'Palermo Ladies Open' })).toBe(false);
  });

  it('no confunde un torneo cualquiera que mencione "masters" en el nombre sin serlo', () => {
    // Nombre real observado en la base — un ATP250 sin relación con Masters 1000.
    expect(isNotableTournament({ tour: 'ATP', series: 'ATP250', name: 'Generali Open' })).toBe(false);
  });
});
