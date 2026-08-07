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

/**
 * Casos reales encontrados en producción (Challenger, 6-ago-2026):
 * promote-challenger.ts crea jugadores con slugFromFullName, que solo separa
 * el PRIMER token como nombre de pila. "Radu Mihai Papoe" queda con slug
 * "mihai papoe-r" en vez de "papoe-r", y la fuente del día a día da luego la
 * forma corta "Papoe R." — que antes de este fix no casaba con nada.
 */
describe('resolvePlayer — apellido enterrado tras un nombre de pila compuesto', () => {
  const index = buildIndex([
    { id: 1, slug: 'mihai papoe-r' }, // "Radu Mihai Papoe"
    { id: 2, slug: 'dylan hara friend-j' }, // "Jay Dylan Hara Friend"
    { id: 3, slug: 'johnson-s' }, // jugador normal, no debe verse afectado
  ]);
  const sinAlias = new Map<string, number>();

  it('encuentra el apellido por el final, aunque el nombre de pila esté de más', () => {
    expect(resolvePlayer('Papoe R.', index, sinAlias)).toMatchObject({ ok: true, playerId: 1 });
    expect(resolvePlayer('Friend J.', index, sinAlias)).toMatchObject({ ok: true, playerId: 2 });
  });

  it('sigue prefiriendo la coincidencia directa cuando existe', () => {
    expect(resolvePlayer('Johnson S.', index, sinAlias)).toMatchObject({ ok: true, playerId: 3 });
  });

  it('no inventa nada si el apellido no aparece en ningún jugador', () => {
    // Caso real: "Marrero Curbelo I." no está en la base (jugador genuinamente
    // no cubierto) — debe seguir sin resolver, no adivinar el más parecido.
    expect(resolvePlayer('Marrero Curbelo I.', index, sinAlias).ok).toBe(false);
  });

  // Caso real que el propio fix rompía al principio: "Matsuda K." resolvía al
  // id de "Matsuda R." porque el apellido era único, sin comprobar la inicial.
  it('NO confunde a dos jugadores con el mismo apellido e inicial distinta', () => {
    const homonimos = buildIndex([
      { id: 20, slug: 'matsuda-r' }, // Ryuki Matsuda, sí está en la base
      // "Matsuda K." (Kaito, u otro) NO está — solo existe el de arriba.
    ]);
    const r = resolvePlayer('Matsuda K.', homonimos, sinAlias);
    expect(r.ok).toBe(false); // no debe devolver el id de Matsuda R.
  });

  it('no elige ninguno si el apellido final Y la inicial coinciden en dos jugadores', () => {
    const ambiguo = buildIndex([
      { id: 10, slug: 'mihai papoe-r' },
      { id: 11, slug: 'esteban papoe-r' }, // misma inicial: colisión real
    ]);
    const r = resolvePlayer('Papoe R.', ambiguo, sinAlias);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/ambiguo/);
  });

  it('la inicial distinta desambigua en vez de bloquear', () => {
    // Antes de comprobar la inicial esto habría contado como "ambiguo" — con
    // la inicial de por medio es una resolución precisa a uno solo de los dos.
    const dosApellidosIguales = buildIndex([
      { id: 10, slug: 'mihai papoe-r' },
      { id: 11, slug: 'esteban papoe-x' },
    ]);
    expect(resolvePlayer('Papoe R.', dosApellidosIguales, sinAlias)).toMatchObject({ ok: true, playerId: 10 });
  });
});
