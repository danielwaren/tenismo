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
