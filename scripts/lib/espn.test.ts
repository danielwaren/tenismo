import { describe, it, expect } from 'vitest';
import { parseScoreboard, normalizeRound, surfaceHint } from './espn';

describe('normalizeRound', () => {
  it('mapea la nomenclatura de ESPN a la nuestra', () => {
    expect(normalizeRound('Final')).toBe('The Final');
    expect(normalizeRound('Semifinal')).toBe('Semifinals');
    expect(normalizeRound('Quarterfinal')).toBe('Quarterfinals');
    expect(normalizeRound('Round of 16')).toBe('4th Round');
    expect(normalizeRound('Round of 32')).toBe('3rd Round');
    expect(normalizeRound('Round 2')).toBe('2nd Round');
    expect(normalizeRound('1st Round')).toBe('1st Round');
  });

  it('no confunde final con semi/cuartos', () => {
    expect(normalizeRound('Semifinal')).not.toBe('The Final');
    expect(normalizeRound('Quarterfinal')).not.toBe('The Final');
  });

  it('marca las rondas de clasificación aparte', () => {
    expect(normalizeRound('Qualifying 1st Round')).toBe('Qualifying');
    expect(normalizeRound(null)).toBeNull();
  });
});

describe('surfaceHint', () => {
  it('acierta la superficie de los torneos conocidos', () => {
    expect(surfaceHint('Millennium Estoril Open')).toBe('clay');
    expect(surfaceHint('Generali Open')).toBe('clay');   // Kitzbühel
    expect(surfaceHint('Wimbledon')).toBe('grass');
    expect(surfaceHint('Halle Open')).toBe('grass');
  });
  it('deja null si no reconoce (mejor global que una superficie inventada)', () => {
    expect(surfaceHint('Torneo Inventado')).toBeNull();
  });
});

describe('parseScoreboard', () => {
  const sample = {
    events: [
      {
        id: '100', name: 'Millennium Estoril Open', season: { year: 2026 },
        date: '2026-07-18T04:00Z', endDate: '2026-07-27T03:59Z',
        groupings: [
          {
            grouping: { slug: 'mens-singles' },
            competitions: [
              {
                id: '900', date: '2026-07-23T09:00Z',
                status: { type: { state: 'in' } },
                round: { displayName: 'Quarterfinal' },
                competitors: [
                  { homeAway: 'home', winner: false, athlete: { fullName: 'Carlos Alcaraz' }, linescores: [{ value: 6 }, { value: 4 }] },
                  { homeAway: 'away', winner: false, athlete: { fullName: 'Jannik Sinner' }, linescores: [{ value: 3 }, { value: 6 }] },
                ],
              },
              {
                id: '901', date: '2026-07-23T11:00Z',
                status: { type: { state: 'post' } },
                round: { displayName: 'Round of 32' },
                competitors: [
                  { homeAway: 'home', winner: true, athlete: { fullName: 'Casper Ruud' }, linescores: [{ value: 6 }, { value: 6 }] },
                  { homeAway: 'away', winner: false, athlete: { fullName: 'Alex Molcan' }, linescores: [{ value: 3 }, { value: 4 }] },
                ],
              },
            ],
          },
          {
            // Dobles: se ignora por completo.
            grouping: { slug: 'mens-doubles' },
            competitions: [
              { id: '999', status: { type: { state: 'in' } }, competitors: [
                { athlete: { fullName: 'A B' } }, { athlete: { fullName: 'C D' } }] },
            ],
          },
        ],
      },
    ],
  };

  it('extrae torneos con sus partidos de individuales', () => {
    const t = parseScoreboard(sample);
    expect(t).toHaveLength(1);
    expect(t[0].name).toBe('Millennium Estoril Open');
    expect(t[0].season).toBe(2026);
    // 2 individuales; los dobles (3 competidores mal formados) se descartan.
    expect(t[0].matches).toHaveLength(2);
  });

  it('lee estado, ronda, ganador y marcador por set', () => {
    const [m1, m2] = parseScoreboard(sample)[0].matches;
    expect(m1.state).toBe('in');
    expect(m1.round).toBe('Quarterfinals');
    expect(m1.homeScore).toEqual([6, 4]);
    expect(m1.awayScore).toEqual([3, 6]);
    expect(m1.homeWon).toBeNull(); // en vivo, sin ganador aún

    expect(m2.state).toBe('post');
    expect(m2.round).toBe('3rd Round');
    expect(m2.homeWon).toBe(true);
  });

  it('descarta competiciones que no son de dos jugadores', () => {
    const solo = { events: [{ id: '1', name: 'X', season: { year: 2026 },
      groupings: [{ grouping: { slug: 'mens-singles' }, competitions: [
        { id: '1', competitors: [{ athlete: { fullName: 'Solo' } }] }] }] }] };
    expect(parseScoreboard(solo)[0].matches).toHaveLength(0);
  });
});
