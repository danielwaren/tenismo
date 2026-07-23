import { describe, it, expect } from 'vitest';
import {
  consensusFromEvent, tourFromSportKey, tournamentNameFromKey, TOURNAMENT_INFO,
  type OddsApiEvent,
} from './odds-api';
import { buildIndex, resolvePlayer, candidateSlugs } from '../../src/lib/players';

/**
 * Payload de ejemplo con la forma documentada de The Odds API. NO son cuotas
 * reales: sirve para fijar el comportamiento del parseo, que hoy no se puede
 * ejercitar en vivo porque no hay ningún torneo cubierto en curso.
 */
const evento: OddsApiEvent = {
  id: 'abc123',
  sport_key: 'tennis_atp_wimbledon',
  commence_time: '2026-07-05T12:00:00Z',
  home_team: 'Carlos Alcaraz',
  away_team: 'Jannik Sinner',
  bookmakers: [
    { key: 'pinnacle', title: 'Pinnacle', markets: [{ key: 'h2h', outcomes: [
      { name: 'Carlos Alcaraz', price: 1.9 }, { name: 'Jannik Sinner', price: 2.0 }] }] },
    { key: 'betfair', title: 'Betfair', markets: [{ key: 'h2h', outcomes: [
      { name: 'Carlos Alcaraz', price: 2.1 }, { name: 'Jannik Sinner', price: 1.8 }] }] },
    // Un mercado que no es h2h debe ignorarse por completo.
    { key: 'otro', title: 'Otro', markets: [{ key: 'totals', outcomes: [
      { name: 'Over', price: 1.5 }, { name: 'Under', price: 2.4 }] }] },
  ],
};

describe('parseo de The Odds API', () => {
  it('promedia y saca el máximo por jugador, ignorando otros mercados', () => {
    const c = consensusFromEvent(evento)!;
    expect(c.home.books).toBe(2);
    expect(c.home.mean).toBeCloseTo(2.0, 10);
    expect(c.home.max).toBeCloseTo(2.1, 10);
    expect(c.away.mean).toBeCloseTo(1.9, 10);
    expect(c.away.max).toBeCloseTo(2.0, 10);
  });

  it('devuelve null si no hay mercado h2h utilizable', () => {
    expect(consensusFromEvent({ ...evento, bookmakers: [] })).toBeNull();
    expect(consensusFromEvent({
      ...evento,
      bookmakers: [{ key: 'x', title: 'X', markets: [{ key: 'h2h', outcomes: [
        { name: 'Carlos Alcaraz', price: 1 }] }] }],
    })).toBeNull();
  });

  it('descarta precios imposibles', () => {
    const c = consensusFromEvent({
      ...evento,
      bookmakers: [
        { key: 'a', title: 'A', markets: [{ key: 'h2h', outcomes: [
          { name: 'Carlos Alcaraz', price: 2.0 }, { name: 'Jannik Sinner', price: 2.0 }] }] },
        { key: 'b', title: 'B', markets: [{ key: 'h2h', outcomes: [
          { name: 'Carlos Alcaraz', price: 0.5 }, { name: 'Jannik Sinner', price: 1.0 }] }] },
      ],
    })!;
    expect(c.home.books).toBe(1);
    expect(c.home.mean).toBeCloseTo(2.0, 10);
  });

  it('deduce el circuito desde la clave del torneo', () => {
    expect(tourFromSportKey('tennis_atp_wimbledon')).toBe('ATP');
    expect(tourFromSportKey('tennis_wta_wimbledon')).toBe('WTA');
    expect(tourFromSportKey('soccer_epl')).toBeNull();
  });

  it('genera un nombre legible si falta el título', () => {
    expect(tournamentNameFromKey('tennis_atp_indian_wells')).toBe('indian wells');
    expect(tournamentNameFromKey('tennis_atp_indian_wells', 'ATP Indian Wells')).toBe('ATP Indian Wells');
  });
});

describe('mapa de superficies', () => {
  it('acierta las trampas de nombres parecidos', () => {
    // Hamburgo (ATP) es tierra; el "German Open" femenino es BERLÍN, en hierba.
    expect(TOURNAMENT_INFO.tennis_atp_hamburg_open.surface).toBe('clay');
    expect(TOURNAMENT_INFO.tennis_wta_german_open.surface).toBe('grass');
    // Stuttgart femenino es tierra BAJO TECHO.
    expect(TOURNAMENT_INFO.tennis_wta_stuttgart_open).toEqual(
      expect.objectContaining({ surface: 'clay', court: 'indoor' }),
    );
    // París-Bercy es dura indoor.
    expect(TOURNAMENT_INFO.tennis_atp_paris_masters.court).toBe('indoor');
  });

  it('los Grand Slams tienen la superficie correcta', () => {
    expect(TOURNAMENT_INFO.tennis_atp_french_open.surface).toBe('clay');
    expect(TOURNAMENT_INFO.tennis_atp_wimbledon.surface).toBe('grass');
    expect(TOURNAMENT_INFO.tennis_atp_us_open.surface).toBe('hard');
    expect(TOURNAMENT_INFO.tennis_wta_aus_open_singles.surface).toBe('hard');
  });

  it('un torneo desconocido no inventa superficie', () => {
    expect(TOURNAMENT_INFO['tennis_atp_torneo_inexistente']).toBeUndefined();
  });
});

describe('resolución de jugadores', () => {
  const index = buildIndex([
    { id: 1, slug: 'alcaraz-c' },
    { id: 2, slug: 'sinner-j' },
    { id: 3, slug: 'de minaur-a' },
    { id: 4, slug: 'del potro-jm' },
    { id: 5, slug: 'auger aliassime-f' },
    { id: 6, slug: 'zverev-a' },
    { id: 7, slug: 'zverev-m' },
  ]);
  const sinAlias = new Map<string, number>();

  it('resuelve nombres simples y compuestos', () => {
    expect(resolvePlayer('Carlos Alcaraz', index, sinAlias)).toMatchObject({ ok: true, playerId: 1 });
    expect(resolvePlayer('Alex de Minaur', index, sinAlias)).toMatchObject({ ok: true, playerId: 3 });
    expect(resolvePlayer('Felix Auger-Aliassime', index, sinAlias)).toMatchObject({ ok: true, playerId: 5 });
  });

  it('resuelve nombres de pila compuestos probando varias particiones', () => {
    expect(candidateSlugs('Juan Martin del Potro')).toContain('del potro-jm');
    expect(resolvePlayer('Juan Martin del Potro', index, sinAlias)).toMatchObject({ ok: true, playerId: 4 });
  });

  it('NO adivina cuando el apellido es ambiguo', () => {
    const r = resolvePlayer('Alexander Zverev', index, sinAlias);
    expect(r).toMatchObject({ ok: true, playerId: 6 }); // slug exacto, sin ambigüedad
    const r2 = resolvePlayer('Sascha Zverev', index, sinAlias); // inicial que no existe
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toContain('ambiguo');
  });

  it('el alias tiene prioridad sobre la heurística', () => {
    const alias = new Map([['alcaraz-c', 99]]);
    expect(resolvePlayer('Carlos Alcaraz', index, alias)).toMatchObject({ ok: true, playerId: 99, via: 'alias' });
  });

  it('un desconocido queda sin resolver en vez de emparejarse a la fuerza', () => {
    const r = resolvePlayer('Jean-Julien Rojer', index, sinAlias);
    expect(r.ok).toBe(false);
  });
});
