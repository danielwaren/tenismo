import { describe, it, expect } from 'vitest';
import { slugFromShortName, slugFromFullName, longInitialSlugCandidates } from '../src/names';

describe('slugFromShortName', () => {
  it('recorta una sola inicial', () => {
    expect(slugFromShortName('Auger-Aliassime F.')).toBe('auger aliassime-f');
  });

  it('NO recorta un sufijo de más de una letra: se queda pegado al apellido', () => {
    // Caso real: gemelas con el mismo apellido e inicial ("Pliskova Ka." /
    // "Pliskova Kr."), la fuente las distingue con dos letras. Este test deja
    // constancia del comportamiento — no es lo ideal, pero es lo que hay que
    // compensar en longInitialSlugCandidates() del lado de la resolución.
    expect(slugFromShortName('Pliskova Ka.')).toBe('pliskova ka');
  });
});

describe('longInitialSlugCandidates', () => {
  it('genera candidatos apellido-XX y "apellido XX" para desambiguar gemelas/coincidencias', () => {
    const cands = longInitialSlugCandidates('Karolina Pliskova');
    expect(cands).toContain('pliskova-ka');
    expect(cands).toContain('pliskova ka');
  });

  it('no rompe con nombre de una sola palabra', () => {
    expect(longInitialSlugCandidates('Pele')).toEqual([]);
  });

  it('el candidato normal (slugFromFullName) sigue siendo el primero que se prueba en la práctica', () => {
    // Para un jugador SIN colisión, el slug de una sola inicial es el correcto;
    // los candidatos largos son extra, no reemplazan al normal.
    expect(slugFromFullName('Carlos Alcaraz')).toBe('alcaraz-c');
  });
});
