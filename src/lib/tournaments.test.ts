import { describe, it, expect } from 'vitest';
import {
  overlaps, dateOverlapRatio, sharedPlayers, containment, shareName, distinctiveTokens,
  shouldMerge, metadataScore, pickCanonical, findDuplicateGroups,
  MIN_SHARED_PLAYERS, type TournamentAgg,
} from './tournaments';

let seq = 1;
// `players` se pasa como array por comodidad, así que hay que EXCLUIRLO del
// Partial: intersecar sin quitarlo da `Set<number> & number[]`, un tipo que no
// admite ningún valor. Los tests pasaban igual (vitest no comprueba tipos) pero
// `astro check` sacaba 50 errores.
const t = (o: Omit<Partial<TournamentAgg>, 'players'> & { players: number[] }): TournamentAgg => ({
  id: o.id ?? seq++,
  tourId: o.tourId ?? 1,
  season: o.season ?? 2026,
  name: o.name ?? 'Torneo',
  surface: o.surface ?? null,
  series: o.series ?? null,
  location: o.location ?? null,
  from: o.from ?? '2026-08-01',
  to: o.to ?? '2026-08-07',
  matches: o.matches ?? 10,
  players: new Set(o.players),
});

const rango = (n: number, desde = 0) => Array.from({ length: n }, (_, i) => desde + i);

describe('nombres', () => {
  it('descarta las palabras genéricas y las cortas', () => {
    expect(distinctiveTokens('National Bank Open presented by Rogers')).toEqual(['national', 'bank', 'rogers']);
    expect(distinctiveTokens('ATP Canadian Open')).toEqual(['canadian']);
  });

  it('reconoce el mismo sitio escrito distinto', () => {
    const a = t({ name: 'Livesport Prague Open', players: [] });
    const b = t({ name: 'Prague Open', players: [] });
    expect(shareName(a, b)).toBe(true);
    expect(shareName(t({ name: 'MSC Hamburg Ladies Open', players: [] }), t({ name: 'Hamburg European Open', players: [] }))).toBe(true);
  });

  it('no empareja torneos sin nada en común', () => {
    expect(shareName(t({ name: 'Monte Carlo Masters', players: [] }), t({ name: 'Miami Open', players: [] }))).toBe(false);
    expect(shareName(t({ name: 'National Bank Open presented by Rogers', players: [] }), t({ name: 'ATP Canadian Open', players: [] }))).toBe(false);
  });
});

describe('fechas', () => {
  it('el roce entre semanas consecutivas apenas cubre nada', () => {
    // Un torneo acaba el domingo y el siguiente empieza ese mismo día.
    const a = t({ from: '2026-08-01', to: '2026-08-07', players: [] });
    const b = t({ from: '2026-08-07', to: '2026-08-13', players: [] });
    expect(overlaps(a, b)).toBe(true);
    expect(dateOverlapRatio(a, b)).toBeCloseTo(1 / 7, 2);
  });

  it('dos vistas del mismo evento se solapan casi del todo', () => {
    const a = t({ from: '2026-08-01', to: '2026-08-07', players: [] });
    const b = t({ from: '2026-08-01', to: '2026-08-05', players: [] });
    expect(dateOverlapRatio(a, b)).toBe(1);
  });

  it('sin solape, cero', () => {
    const a = t({ from: '2026-08-01', to: '2026-08-05', players: [] });
    const b = t({ from: '2026-08-06', to: '2026-08-10', players: [] });
    expect(dateOverlapRatio(a, b)).toBe(0);
  });
});

describe('jugadores', () => {
  it('cuenta la intersección y la contención sin importar el orden', () => {
    const a = t({ players: [1, 2, 3, 4, 5] });
    const b = t({ players: [4, 5, 6] });
    expect(sharedPlayers(a, b)).toBe(2);
    expect(sharedPlayers(b, a)).toBe(2);
    expect(containment(a, b)).toBeCloseTo(2 / 3, 6);
  });
});

describe('shouldMerge', () => {
  it('fusiona el caso real sin ayuda del nombre: contención total', () => {
    // National Bank Open (ESPN) y ATP Canadian Open (Odds API): los 24
    // jugadores del segundo están todos en el primero.
    const espn = t({ name: 'National Bank Open presented by Rogers', players: rango(56), from: '2026-08-01', to: '2026-08-02' });
    const odds = t({ name: 'ATP Canadian Open', surface: 'hard', series: 'Masters 1000', players: rango(24), from: '2026-08-01', to: '2026-08-01' });
    expect(shareName(espn, odds)).toBe(false);
    expect(containment(espn, odds)).toBe(1);
    expect(shouldMerge(espn, odds)).toBe(true);
  });

  it('fusiona con contención parcial si el nombre coincide', () => {
    // Praga: la reconciliación ya se llevó parte de los partidos de ESPN, así
    // que solo queda la mitad de los jugadores. El nombre sostiene el enlace.
    // 8 de los 17 jugadores de ESPN están en la lista de tennis-data; los otros
    // 9 son partidos que la reconciliación ya se llevó.
    const espn = t({ name: 'Livesport Prague Open', players: [...rango(8, 0), ...rango(9, 900)], from: '2026-07-18', to: '2026-07-21' });
    const td = t({ name: 'Prague Open', surface: 'hard', series: 'WTA250', location: 'Prague', players: rango(32), from: '2026-07-20', to: '2026-07-26' });
    expect(containment(espn, td)).toBeLessThan(0.8);
    expect(shouldMerge(espn, td)).toBe(true);
  });

  it('NO fusiona Monte Carlo con Miami: el fallo que rompió la primera versión', () => {
    // Semanas contiguas, se rozan por un día, y los mismos jugadores pasan de
    // uno a otro. Sin el filtro de solape esto se fusionaba.
    const miami = t({ name: 'Miami Open', players: rango(48), from: '2026-03-20', to: '2026-04-01' });
    const monteCarlo = t({ name: 'Monte Carlo Masters', players: rango(40), from: '2026-04-01', to: '2026-04-12' });
    expect(overlaps(miami, monteCarlo)).toBe(true);
    expect(sharedPlayers(miami, monteCarlo)).toBeGreaterThan(MIN_SHARED_PLAYERS);
    expect(shouldMerge(miami, monteCarlo)).toBe(false);
  });

  it('NO fusiona dos torneos distintos de la misma semana', () => {
    const a = t({ name: 'Washington', players: rango(32, 0) });
    const b = t({ name: 'Kitzbuhel', players: rango(32, 100) });
    expect(shouldMerge(a, b)).toBe(false);
  });

  it('NO fusiona por un puñado de jugadores sueltos aunque el nombre coincida', () => {
    const a = t({ name: 'Prague Open', players: rango(32, 0) });
    const b = t({ name: 'Livesport Prague Open', players: [0, 1, 2, ...rango(29, 200)] });
    expect(sharedPlayers(a, b)).toBe(3);
    expect(shouldMerge(a, b)).toBe(false);
  });

  it('no fusiona torneos de circuitos ni temporadas distintas', () => {
    expect(shouldMerge(t({ tourId: 1, players: rango(20) }), t({ tourId: 2, players: rango(20) }))).toBe(false);
    expect(shouldMerge(t({ season: 2025, players: rango(20) }), t({ season: 2026, players: rango(20) }))).toBe(false);
  });

  it('no fusiona si las fechas no se solapan aunque compartan jugadores', () => {
    const a = t({ from: '2026-07-01', to: '2026-07-07', players: rango(20) });
    const b = t({ from: '2026-07-08', to: '2026-07-14', players: rango(20) });
    expect(shouldMerge(a, b)).toBe(false);
  });
});

describe('pickCanonical', () => {
  it('gana la fila con superficie y categoría, aunque tenga menos partidos', () => {
    const pobre = t({ id: 10, name: 'National Bank Open', matches: 28, players: [] });
    const rica = t({ id: 20, name: 'ATP Canadian Open', surface: 'hard', series: 'Masters 1000', matches: 12, players: [] });
    expect(pickCanonical(pobre, rica).id).toBe(20);
    expect(metadataScore(rica)).toBeGreaterThan(metadataScore(pobre));
  });

  it('a igual información, la que tiene más partidos', () => {
    expect(pickCanonical(
      t({ id: 10, surface: 'hard', matches: 30, players: [] }),
      t({ id: 20, surface: 'hard', matches: 12, players: [] }),
    ).id).toBe(10);
  });

  it('a igualdad total, la de id menor: el resultado no depende del orden', () => {
    const a = t({ id: 20, matches: 10, players: [] });
    const b = t({ id: 10, matches: 10, players: [] });
    expect(pickCanonical(a, b).id).toBe(10);
    expect(pickCanonical(b, a).id).toBe(10);
  });
});

describe('findDuplicateGroups', () => {
  it('no inventa grupos cuando no hay duplicados', () => {
    expect(findDuplicateGroups([t({ players: rango(20, 0) }), t({ players: rango(20, 100) })]).groups).toHaveLength(0);
  });

  it('agrupa un par y elige bien el superviviente', () => {
    const espn = t({ id: 3401, name: 'National Bank Open presented by Rogers', matches: 28, players: rango(56) });
    const odds = t({ id: 3478, name: 'ATP Canadian Open', surface: 'hard', series: 'Masters 1000', matches: 12, players: rango(24) });
    const { groups } = findDuplicateGroups([espn, odds]);
    expect(groups).toHaveLength(1);
    expect(groups[0].canonical.id).toBe(3478);
    expect(groups[0].duplicates.map((d) => d.id)).toEqual([3401]);
  });

  it('NO encadena: un eslabón entre dos parejas se descarta y se registra', () => {
    // A=B y B=C, pero B no puede ser a la vez superviviente y duplicado.
    // Encadenar aquí fue lo que metió Los Cabos en el Canadian Open.
    const A = t({ id: 1, name: 'Alfa Open', surface: 'hard', players: rango(20, 0) });
    const B = t({ id: 2, name: 'Alfa Beta Open', players: rango(20, 0) });
    const C = t({ id: 3, name: 'Beta Open', surface: 'clay', players: rango(20, 0) });
    const { groups, skipped } = findDuplicateGroups([A, B, C]);
    const fusionados = groups.flatMap((g) => g.duplicates.map((d) => d.id));
    expect(fusionados).not.toContain(3);
    expect(skipped.length).toBeGreaterThan(0);
  });

  it('un superviviente puede absorber varios duplicados directos', () => {
    const canon = t({ id: 1, name: 'Praga Open', surface: 'hard', series: 'WTA250', players: rango(32) });
    // Los dos duplicados están contenidos en el superviviente pero NO se
    // solapan entre sí: son dos parejas directas, no una cadena.
    const d1 = t({ id: 2, name: 'Livesport Praga Open', players: rango(10, 0) });
    const d2 = t({ id: 3, name: 'Praga Ladies', players: rango(10, 20) });
    const { groups } = findDuplicateGroups([canon, d1, d2]);
    expect(groups).toHaveLength(1);
    expect(groups[0].canonical.id).toBe(1);
    expect(groups[0].duplicates.map((d) => d.id).sort()).toEqual([2, 3]);
  });

  it('el resultado no depende del orden de entrada', () => {
    const A = t({ id: 1, name: 'Praga Open', players: rango(20) });
    const B = t({ id: 2, name: 'Livesport Praga Open', surface: 'clay', players: rango(20) });
    expect(findDuplicateGroups([A, B]).groups[0].canonical.id)
      .toBe(findDuplicateGroups([B, A]).groups[0].canonical.id);
  });
});
