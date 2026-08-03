import { describe, it, expect } from 'vitest';
import { parseSeason } from './tennis-data';
import type { Row, Cell } from './xlsx';

const HEADER = [
  'Date', 'Tournament', 'Location', 'Series', 'Surface', 'Court', 'Round', 'Best of',
  'Winner', 'Loser', 'WRank', 'LRank', 'WPts', 'LPts', 'W1', 'L1', 'Wsets', 'Lsets', 'Comment',
];
const idx = (name: string) => HEADER.indexOf(name);

/** Fila mínima válida, con los huecos que no importan al test en null. */
function row(overrides: Record<string, Cell>): Row {
  const r: Row = HEADER.map(() => null);
  r[idx('Date')] = '2026-08-03';
  r[idx('Tournament')] = 'Citi Open';
  r[idx('Round')] = 'The Final';
  r[idx('Surface')] = 'Hard';
  r[idx('Best of')] = 3;
  r[idx('Winner')] = 'Jodar R.';
  r[idx('Loser')] = 'Fritz T.';
  for (const [k, v] of Object.entries(overrides)) r[idx(k)] = v;
  return r;
}

describe('parseSeason — status', () => {
  it('comentario vacío con ganador y perdedor reales: se trata como partido jugado, no como un tercer estado invisible', () => {
    const { matches } = parseSeason([HEADER, row({ Comment: null })], 'ATP', 2026);
    expect(matches).toHaveLength(1);
    expect(matches[0].status).toBe('completed');
  });

  it('"Completed" explícito sigue dando completed', () => {
    const { matches } = parseSeason([HEADER, row({ Comment: 'Completed' })], 'ATP', 2026);
    expect(matches[0].status).toBe('completed');
  });

  it('retirada y walkover se distinguen del resto', () => {
    const { matches: retired } = parseSeason([HEADER, row({ Comment: 'Retired' })], 'ATP', 2026);
    expect(retired[0].status).toBe('retired');
    const { matches: wo } = parseSeason([HEADER, row({ Comment: 'Walkover' })], 'ATP', 2026);
    expect(wo[0].status).toBe('walkover');
  });

  it('sin ganador o perdedor válido, la fila se descarta (no inventa un partido)', () => {
    const { matches, skipped } = parseSeason([HEADER, row({ Winner: '', Loser: 'Fritz T.' })], 'ATP', 2026);
    expect(matches).toHaveLength(0);
    expect(skipped.some((s) => s.reason === 'jugador no válido')).toBe(true);
  });
});
