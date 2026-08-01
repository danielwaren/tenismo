import { describe, it, expect } from 'vitest';
import { setClosed, setsWon, setCells, currentLeader } from './score';

describe('setClosed', () => {
  it('cierra con 6 y dos de ventaja', () => {
    expect(setClosed(6, 4)).toBe(true);
    expect(setClosed(6, 0)).toBe(true);
  });

  it('NO cierra con 6-5 (hace falta el 7)', () => {
    expect(setClosed(6, 5)).toBe(false);
  });

  it('cierra a 7 (7-5 y tie-break)', () => {
    expect(setClosed(7, 5)).toBe(true);
    expect(setClosed(7, 6)).toBe(true);
  });

  it('un set en curso no está cerrado', () => {
    expect(setClosed(1, 4)).toBe(false);
    expect(setClosed(0, 0)).toBe(false);
    expect(setClosed(3, 2)).toBe(false);
  });
});

describe('setsWon', () => {
  it('no cuenta el set que se está jugando', () => {
    // Buse 1-4 Etcheverry en el primer set: nadie ha ganado un set todavía.
    expect(setsWon('1', '4')).toEqual([0, 0]);
    expect(setsWon('3 2', '6 1')).toEqual([0, 1]); // 2º set en curso
  });

  it('cuenta los sets ya cerrados', () => {
    expect(setsWon('6 4 1', '3 6 2')).toEqual([1, 1]); // 3º en curso
    expect(setsWon('6 6', '3 4')).toEqual([2, 0]);
    expect(setsWon('7 6', '6 7')).toEqual([1, 1]);
  });

  it('aguanta marcadores ausentes o ilegibles', () => {
    expect(setsWon(null, '6')).toEqual([0, 0]);
    expect(setsWon('6', null)).toEqual([0, 0]);
    expect(setsWon('', '')).toEqual([0, 0]);
    expect(setsWon('x y', '6 4')).toEqual([0, 0]);
  });
});

describe('setCells', () => {
  it('empareja los juegos set a set', () => {
    expect(setCells('6 3', '4 5')).toEqual([
      { a: 6, b: 4, inPlay: false },
      { a: 3, b: 5, inPlay: true },
    ]);
  });

  it('marca en juego el set que no está cerrado', () => {
    expect(setCells('2', '3')).toEqual([{ a: 2, b: 3, inPlay: true }]);
    expect(setCells('7', '6')).toEqual([{ a: 7, b: 6, inPlay: false }]);
  });

  it('sin marcador devuelve lista vacía', () => {
    expect(setCells(null, '3')).toEqual([]);
    expect(setCells('', '')).toEqual([]);
  });
});

describe('currentLeader', () => {
  it('manda quien tiene más sets ganados', () => {
    expect(currentLeader('6 2', '4 5')).toBe(1); // 1-0 en sets pese a ir 2-5
    expect(currentLeader('4 5', '6 2')).toBe(2);
  });

  it('si van iguales en sets, decide el set en curso', () => {
    // Este es el caso real que se leía al revés: primer set, 2-3.
    expect(currentLeader('2', '3')).toBe(2);
    expect(currentLeader('3', '2')).toBe(1);
    expect(currentLeader('6 4 3', '4 6 1')).toBe(1);
  });

  it('empate cuando no hay diferencia', () => {
    expect(currentLeader('3', '3')).toBe(0);
    expect(currentLeader('6 3', '4 3')).toBe(1); // 1-0 en sets
    expect(currentLeader(null, null)).toBe(0);
  });
});
