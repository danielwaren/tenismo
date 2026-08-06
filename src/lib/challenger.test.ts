import { describe, expect, it } from 'vitest';
import { parseChallengerSummaries } from './challenger';

describe('parseChallengerSummaries', () => {
  it('conserva singles Challenger y excluye otras categorías', () => {
    const event = (id: string, category: string, name: string) => ({ sport_event: {
      id, type: 'singles', start_time: '2026-08-07T12:00:00Z', competitors: [{ name: 'Jugador Uno' }, { name: 'Jugador Dos' }],
      sport_event_context: { category: { id: category, name }, competition: { id: 'c1', name: 'Challenger Test' }, round: { name: 'Round of 32' } },
    } });
    expect(parseChallengerSummaries({ summaries: [event('m1', 'sr:category:72', 'Challenger'), event('m2', 'sr:category:3', 'ATP')] })).toEqual([
      expect.objectContaining({ id: 'm1', tournament: 'Challenger Test', player1: 'Jugador Uno' }),
    ]);
  });
  it('descarta dobles y registros incompletos', () => {
    expect(parseChallengerSummaries({ summaries: [{ sport_event: { type: 'doubles', sport_event_context: { category: { id: 'sr:category:72' } }, competitors: [] } }] })).toEqual([]);
  });
});
