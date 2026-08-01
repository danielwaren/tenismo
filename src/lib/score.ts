/** Utilidades de marcador de tenis, compartidas por la web. */

/**
 * ¿Está cerrado este set? Con 6 juegos y dos de ventaja, o con 7 (tie-break o
 * 7-5). Hace falta para no contar como ganado el set que se está jugando: con
 * 1-4 en el primero todavía no ha ganado nadie.
 */
export function setClosed(a: number, b: number): boolean {
  const hi = Math.max(a, b);
  return (hi >= 6 && Math.abs(a - b) >= 2) || hi >= 7;
}

/**
 * Sets YA GANADOS por cada jugador, a partir del marcador por set
 * ("6 7 6" contra "4 6 4"). Los sets en curso no cuentan.
 */
export function setsWon(a: string | null, b: string | null): [number, number] {
  if (!a || !b) return [0, 0];
  const xa = a.trim().split(/\s+/).map(Number);
  const xb = b.trim().split(/\s+/).map(Number);
  let wa = 0;
  let wb = 0;
  for (let i = 0; i < Math.min(xa.length, xb.length); i++) {
    if (!Number.isFinite(xa[i]) || !Number.isFinite(xb[i])) continue;
    if (!setClosed(xa[i], xb[i])) continue;
    if (xa[i] > xb[i]) wa++;
    else if (xb[i] > xa[i]) wb++;
  }
  return [wa, wb];
}

/** Marcador por set, ya emparejado, tal y como se escribe el tenis. */
export interface SetCell {
  a: number;
  b: number;
  /** true si es el set que se está jugando (no cerrado). */
  inPlay: boolean;
}

/**
 * Convierte los dos marcadores de ESPN ("6 3" contra "4 5") en celdas por set.
 *
 * Pintar cada jugador con un número suelto —"2" arriba, "3" abajo— es lo que
 * hacía ilegible la tarjeta de EN VIVO: sin saber si son sets o juegos, y sin
 * nadie marcado como líder, el marcador se lee al revés con facilidad. Emparejar
 * por set y señalar el que está en juego lo deja sin ambigüedad.
 */
export function setCells(a: string | null, b: string | null): SetCell[] {
  if (!a || !b) return [];
  const xa = a.trim().split(/\s+/).map(Number);
  const xb = b.trim().split(/\s+/).map(Number);
  const out: SetCell[] = [];
  for (let i = 0; i < Math.min(xa.length, xb.length); i++) {
    if (!Number.isFinite(xa[i]) || !Number.isFinite(xb[i])) continue;
    out.push({ a: xa[i], b: xb[i], inPlay: !setClosed(xa[i], xb[i]) });
  }
  return out;
}

/**
 * Quién va por delante: 1 = el primero, 2 = el segundo, 0 = igualados.
 *
 * Manda quien tiene más sets ganados. Solo si van iguales en sets se mira quién
 * lleva más juegos en el set en curso. `setsWon` por sí solo devolvía 0-0 en el
 * primer set y dejaba la tarjeta sin ningún indicio de quién domina, que es
 * justo cuando más falta hace.
 */
export function currentLeader(a: string | null, b: string | null): 0 | 1 | 2 {
  const [wa, wb] = setsWon(a, b);
  if (wa !== wb) return wa > wb ? 1 : 2;

  const cells = setCells(a, b);
  const enCurso = cells.find((c) => c.inPlay);
  if (!enCurso || enCurso.a === enCurso.b) return 0;
  return enCurso.a > enCurso.b ? 1 : 2;
}
