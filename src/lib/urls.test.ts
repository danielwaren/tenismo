import { describe, it, expect } from 'vitest';
import { challengerSlug, challengerPath } from './urls';

describe('challengerSlug', () => {
  it('toma el nombre y el año, sin el resto de la ruta', () => {
    expect(challengerSlug('/hagen-challenger/2026/atp-men/')).toBe('hagen-challenger-2026');
  });

  // Caso real: el propio nombre del torneo ya trae un número ("Plovdiv 2").
  // Una reconstrucción por regex que adivina "el año son los últimos 4
  // dígitos" seguiría funcionando aquí, pero es justo el caso que puede
  // romperse — por eso challengerPath/challengerSlug no intentan invertirse,
  // se comparan calculando el mismo slug para cada torneo candidato.
  it('no confunde un número del propio nombre con el año', () => {
    expect(challengerSlug('/plovdiv-2-challenger/2026/atp-men/')).toBe('plovdiv-2-challenger-2026');
  });

  it('es estable y determinista para el mismo id', () => {
    const id = '/istanbul-challenger/2026/atp-men/';
    expect(challengerSlug(id)).toBe(challengerSlug(id));
  });

  it('challengerPath usa el mismo slug con el prefijo de la ruta', () => {
    expect(challengerPath('/hagen-challenger/2026/atp-men/')).toBe('/challenger/hagen-challenger-2026');
  });
});
