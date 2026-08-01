import { describe, it, expect } from 'vitest';
import {
  shrink,
  estimateAces,
  estimateMatchAces,
  DEFAULT_KAPPA,
  MIN_SERVE_GAMES,
  type ServeProfile,
  type AceContext,
} from '../src/aces';

/** Media del circuito usada en los tests: 0,5 aces por juego al saque. */
const ctx: AceContext = { tourAceRate: 0.5, expectedServeGames: 11 };

/**
 * Contexto sin encogimiento, para los tests que comprueban el AJUSTE POR RIVAL
 * aislado. Con kappa por defecto, hasta una muestra de 5.000 juegos deja la tasa
 * en 0,985 en vez de 1,0 — correcto, pero mezcla los dos efectos y hace
 * ilegibles las cifras esperadas. El encogimiento tiene sus propios tests.
 */
const sinEncoger: AceContext = { ...ctx, kappa: 0 };

const perfil = (aceRate: number, concedeRate: number, n = 5000): ServeProfile => ({
  serveGames: n,
  aceRate,
  returnGames: n,
  concedeRate,
});

const medio = perfil(0.5, 0.5);

describe('shrink', () => {
  it('sin muestra devuelve la media del circuito', () => {
    expect(shrink(9, 0, 0.5, DEFAULT_KAPPA)).toBe(0.5);
  });

  it('con muestra enorme devuelve casi lo observado', () => {
    expect(shrink(1.2, 1_000_000, 0.5, DEFAULT_KAPPA)).toBeCloseTo(1.2, 3);
  });

  it('con muestra igual a kappa se queda a medio camino', () => {
    expect(shrink(1.0, DEFAULT_KAPPA, 0.5, DEFAULT_KAPPA)).toBeCloseTo(0.75, 6);
  });

  it('una muestra pequeña y extrema queda cerca de la media, no del dato', () => {
    // Un partido de 12 aces en 10 juegos: 1,2 por juego. Sin encoger
    // proyectaría 13 aces; encogido se queda en algo razonable.
    const r = shrink(1.2, 10, 0.5, DEFAULT_KAPPA);
    expect(r).toBeLessThan(0.55);
    expect(r).toBeGreaterThan(0.5);
  });
});

describe('estimateAces', () => {
  it('dos jugadores medios dan la media del circuito', () => {
    const e = estimateAces(medio, medio, ctx)!;
    expect(e.perGame).toBeCloseTo(0.5, 6);
    expect(e.expected).toBeCloseTo(5.5, 6); // 0,5 × 11 juegos
  });

  it('un restador medio no altera la tasa del sacador', () => {
    const sacador = perfil(1.0, 0.5);
    const e = estimateAces(sacador, medio, sinEncoger)!;
    expect(e.perGame).toBeCloseTo(1.0, 6);
  });

  it('un restador que concede el doble duplica la proyección', () => {
    const sacador = perfil(1.0, 0.5);
    const malRestador = perfil(0.5, 1.0);
    const e = estimateAces(sacador, malRestador, sinEncoger)!;
    expect(e.perGame).toBeCloseTo(2.0, 6);
  });

  it('un buen restador la reduce', () => {
    const sacador = perfil(1.0, 0.5);
    const buenRestador = perfil(0.5, 0.25);
    const e = estimateAces(sacador, buenRestador, sinEncoger)!;
    expect(e.perGame).toBeCloseTo(0.5, 6);
  });

  it('marca como poco fiable la muestra corta de cualquiera de los dos lados', () => {
    const corto = perfil(1.0, 0.5, MIN_SERVE_GAMES - 1);
    expect(estimateAces(corto, medio, ctx)!.reliable).toBe(false);
    expect(estimateAces(medio, corto, ctx)!.reliable).toBe(false);
    expect(estimateAces(medio, medio, ctx)!.reliable).toBe(true);
  });

  it('sin contexto utilizable devuelve null en vez de inventar', () => {
    expect(estimateAces(medio, medio, { tourAceRate: 0, expectedServeGames: 11 })).toBeNull();
    expect(estimateAces(medio, medio, { tourAceRate: 0.5, expectedServeGames: 0 })).toBeNull();
  });

  it('un jugador sin ningún dato proyecta la media, no cero', () => {
    const vacio: ServeProfile = { serveGames: 0, aceRate: 0, returnGames: 0, concedeRate: 0 };
    const e = estimateAces(vacio, vacio, ctx)!;
    expect(e.perGame).toBeCloseTo(0.5, 6);
    expect(e.reliable).toBe(false);
  });
});

describe('estimateMatchAces', () => {
  it('el total es la suma de los dos lados', () => {
    const sacador = perfil(1.2, 0.6);
    const restador = perfil(0.3, 0.4);
    const m = estimateMatchAces(sacador, restador, ctx)!;
    expect(m.total).toBeCloseTo(m.p1.expected + m.p2.expected, 9);
  });

  it('el saque de cada uno se mide contra el resto del otro, no contra el suyo', () => {
    // p1 saca mucho (1,0) y concede poco al resto (0,2).
    // p2 saca poco (0,2) y concede mucho (1,0).
    const p1 = perfil(1.0, 0.2);
    const p2 = perfil(0.2, 1.0);
    const m = estimateMatchAces(p1, p2, sinEncoger)!;
    // p1: 1,0 × (1,0/0,5) = 2,0 por juego
    expect(m.p1.perGame).toBeCloseTo(2.0, 6);
    // p2: 0,2 × (0,2/0,5) = 0,08 por juego
    expect(m.p2.perGame).toBeCloseTo(0.08, 6);
  });

  it('solo es fiable si lo son los dos lados', () => {
    const corto = perfil(1.0, 0.5, MIN_SERVE_GAMES - 1);
    expect(estimateMatchAces(medio, corto, ctx)!.reliable).toBe(false);
    expect(estimateMatchAces(medio, medio, ctx)!.reliable).toBe(true);
  });
});
