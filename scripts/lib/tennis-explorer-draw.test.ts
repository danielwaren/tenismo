import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDraw } from './tennis-explorer-draw';

/**
 * Recorte REAL del cuadro de Hagen Challenger 2026 (solo los divs de
 * cabecera de ronda, jugador y resultado — el resto de la página, con los
 * anuncios y el layout, no aporta nada al parseo). 32 cabezas de serie, 5
 * rondas, con la 4ª y 5ª (semifinal, final) todavía vacías: el torneo está
 * en curso.
 */
const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'tennis-explorer-draw.html'),
  'utf8',
);

describe('parseDraw', () => {
  const draw = parseDraw(fixture);

  it('lee las 5 rondas en orden', () => {
    expect(draw.rounds).toEqual(['1. round', 'round of 16', 'quarterfinal', 'semifinal', 'final']);
  });

  it('reconstruye los 16 partidos de la primera ronda', () => {
    const primera = draw.matches.filter((m) => m.round === '1. round');
    expect(primera).toHaveLength(16);
    for (const m of primera) {
      expect(m.winner).toBeTruthy();
      expect(m.loser).toBeTruthy();
      expect(m.score).toBeTruthy();
      expect(m.sourceId).toBeTruthy();
    }
  });

  // Caso cruzado con datos ya verificados por separado desde la ficha diaria
  // (/matches/, no /torneo/): mismo id de partido, mismo marcador. Si el
  // emparejamiento por orden se rompiera, esto es lo primero que fallaría.
  it('empareja correctamente un partido conocido de la 1ª ronda', () => {
    const m = draw.matches.find((x) => x.sourceId === '3286277');
    expect(m).toMatchObject({
      round: '1. round', winner: 'Gentzsch', loser: 'Monteiro', score: '6-3, 6(5)-7, 6-4',
    });
  });

  it('empareja correctamente un partido conocido de octavos', () => {
    const m = draw.matches.find((x) => x.sourceId === '3287621');
    expect(m).toMatchObject({
      round: 'round of 16', winner: 'Giustino', loser: 'Dodig', score: '4-6, 7-5, 7-6(4)',
    });
  });

  it('reconstruye los 8 partidos de octavos (round of 16)', () => {
    expect(draw.matches.filter((m) => m.round === 'round of 16')).toHaveLength(8);
  });

  it('no inventa partidos en las rondas que aún no se jugaron', () => {
    expect(draw.matches.filter((m) => m.round === 'quarterfinal')).toHaveLength(0);
    expect(draw.matches.filter((m) => m.round === 'semifinal')).toHaveLength(0);
  });

  it('el orden se conserva: el ganador siempre es uno de los dos jugadores de su casilla', () => {
    for (const m of draw.matches) {
      if (m.winner && m.loser) expect(m.winner).not.toBe(m.loser);
    }
  });
});

describe('parseDraw — casos sintéticos', () => {
  const cabecera = (left: number, nombre: string) =>
    `<div style="left: ${left}px; top: 0; text-align: center;">${nombre}</div>`;
  const jugador = (left: number, top: number, nombre: string) =>
    `<div style="left: ${left}px; top: ${top}px;"><a href="/player/x/">${nombre}</a></div>`;
  const resultado = (left: number, top: number, id: number, score: string) =>
    `<div style="left: ${left}px; top: ${top}px;"><a href="/match-detail/?id=${id}">${score}</a></div>`;

  it('un cuadro de 4 (semifinal directa) con las dos rondas completas', () => {
    const html = [
      cabecera(10, 'semifinal'), cabecera(150, 'final'),
      jugador(10, 20, 'A'), jugador(10, 44, 'B'), jugador(10, 68, 'C'), jugador(10, 92, 'D'),
      jugador(150, 20, 'B'), resultado(150, 56, 1, '6-2, 6-3'),
      jugador(150, 80, 'D'), resultado(150, 116, 2, '7-5, 6-4'),
    ].join('\n');
    const draw = parseDraw(html);
    expect(draw.matches).toEqual([
      { round: 'semifinal', winner: 'B', loser: 'A', score: '6-2, 6-3', sourceId: '1' },
      { round: 'semifinal', winner: 'D', loser: 'C', score: '7-5, 6-4', sourceId: '2' },
    ]);
  });

  it('sin ninguna ronda jugada, no hay partidos', () => {
    const html = [cabecera(10, '1. round'), jugador(10, 20, 'A'), jugador(10, 44, 'B')].join('\n');
    expect(parseDraw(html).matches).toEqual([]);
  });

  it('con una sola cabecera de ronda no hay transición que resolver', () => {
    const html = [cabecera(10, 'final'), jugador(10, 20, 'A'), jugador(10, 44, 'B')].join('\n');
    expect(parseDraw(html).matches).toEqual([]);
  });
});
