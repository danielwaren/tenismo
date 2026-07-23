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
