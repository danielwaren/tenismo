import { describe, it, expect } from 'vitest';
import { buildIndex, resolvePlayer, candidateSlugs } from './players';

describe('resolvePlayer — apellido e inicial compartidos (gemelas)', () => {
  // Caso real: Karolina y Kristyna Pliskova. tennis-data las guarda como
  // "Pliskova Ka." / "Pliskova Kr." (slugFromShortName no recorta un sufijo de
  // más de una letra), así que sus slugs quedan "pliskova ka" / "pliskova kr"
  // — CON ESPACIO, no con guion como el resto de la base.
  const index = buildIndex([
    { id: 1687, slug: 'pliskova ka' },
    { id: 1690, slug: 'pliskova kr' },
    { id: 1, slug: 'alcaraz-c' },
  ]);
  const aliases = new Map<string, number>();

  it('resuelve el nombre completo de ESPN a la jugadora correcta, no a su gemela', () => {
    expect(resolvePlayer('Karolina Pliskova', index, aliases)).toEqual({ ok: true, playerId: 1687, via: 'slug' });
    expect(resolvePlayer('Kristyna Pliskova', index, aliases)).toEqual({ ok: true, playerId: 1690, via: 'slug' });
  });

  it('un jugador normal (sin colisión) sigue resolviendo igual que antes', () => {
    expect(resolvePlayer('Carlos Alcaraz', index, aliases)).toEqual({ ok: true, playerId: 1, via: 'slug' });
  });

  it('candidateSlugs incluye tanto el candidato de una inicial como los de prefijo largo', () => {
    const cands = candidateSlugs('Karolina Pliskova');
    expect(cands).toContain('pliskova-k');
    expect(cands).toContain('pliskova ka');
  });
});

/**
 * Formato abreviado, que es el que usa la propia base (`players.name`) y el
 * que dan tennis-data y tennisexplorer. Antes se leía al revés —"Giustino"
 * como nombre de pila y "L." como apellido— y generaba l-g, l-gi, l-giu…, así
 * que el pronóstico decía "jugador no reconocido" para jugadores que sí están
 * en la base y tienen Elo. Se detectó con los Challenger.
 */
describe('resolvePlayer — nombres ya abreviados', () => {
  const index = buildIndex([
    { id: 1, slug: 'giustino-l' },
    { id: 2, slug: 'dodig-m' },
    // Slug REAL de la base (id 71): el apellido compuesto lleva ESPACIO, no
    // guion — así lo genera slugFromShortName desde siempre, verificado contra
    // producción. Con guion, el test parecía pasar por casualidad y no habría
    // detectado una regresión real en el emparejamiento.
    { id: 3, slug: 'auger aliassime-f' },
  ]);
  const sinAlias = new Map<string, number>();

  it('casa "Apellido I." con su slug', () => {
    expect(resolvePlayer('Giustino L.', index, sinAlias)).toMatchObject({ ok: true, playerId: 1 });
    expect(resolvePlayer('Dodig M.', index, sinAlias)).toMatchObject({ ok: true, playerId: 2 });
  });

  it('casa apellidos compuestos con guion', () => {
    expect(resolvePlayer('Auger-Aliassime F.', index, sinAlias)).toMatchObject({ ok: true, playerId: 3 });
  });

  it('sigue casando el nombre completo', () => {
    expect(resolvePlayer('Felix Auger-Aliassime', index, sinAlias)).toMatchObject({ ok: true, playerId: 3 });
  });

  it('no inventa cuando no está', () => {
    expect(resolvePlayer('Inexistente Z.', index, sinAlias).ok).toBe(false);
  });
});
