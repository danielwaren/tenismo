/**
 * Normalización de nombres de jugadores.
 *
 * La fuente histórica (tennis-data.co.uk) no trae IDs: cada partido identifica
 * a los jugadores por un nombre abreviado tipo "Vukic A.", "O Connell C.",
 * "Auger-Aliassime F.". Entre temporadas hay variaciones de grafía, y The Odds
 * API usará el nombre completo ("Felix Auger-Aliassime"). El `slug` es la clave
 * de identidad; las variantes se resuelven contra `player_aliases`.
 */

/** Minúsculas, sin acentos, sin puntuación, espacios colapsados. */
export function normalizeName(raw: string): string {
  return (raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Slug canónico del formato de la fuente histórica: "Apellido I." → "apellido-i".
 * Apellidos compuestos se conservan enteros: "Auger-Aliassime F." →
 * "auger aliassime-f".
 */
export function slugFromShortName(raw: string): string {
  const n = normalizeName(raw);
  if (!n) return '';
  const parts = n.split(' ');
  // La(s) inicial(es) son las últimas fichas de una sola letra.
  const initials: string[] = [];
  while (parts.length > 1 && parts[parts.length - 1].length === 1) {
    initials.unshift(parts.pop()!);
  }
  const surname = parts.join(' ');
  return initials.length ? `${surname}-${initials.join('')}` : surname;
}

/**
 * Slug a partir de un nombre completo ("Felix Auger Aliassime") con la misma
 * forma que `slugFromShortName`, para poder cruzar las dos fuentes: se toma la
 * inicial del nombre de pila y el resto como apellido.
 *
 * Es una heurística, no una verdad: los nombres compuestos ("Juan Martin del
 * Potro") no se resuelven bien y necesitan un alias manual. Por eso el
 * emparejamiento con The Odds API (Fase 2) debe REGISTRAR lo que no casa en vez
 * de adivinar — el mismo criterio que en el proyecto de fútbol.
 */
export function slugFromFullName(raw: string): string {
  const n = normalizeName(raw);
  if (!n) return '';
  const parts = n.split(' ');
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const surname = parts.slice(1).join(' ');
  return `${surname}-${first[0]}`;
}

/**
 * Variantes de slug para cuando la inicial sola no basta: dos jugadores con
 * el mismo apellido Y la misma inicial (gemelas, hermanos, coincidencia — hay
 * 22 casos en la base, de Pliskova Ka./Kr. a Zhang Zh./Wang Xin.). La fuente
 * histórica los distingue con dos o más letras del nombre de pila ("Ka.",
 * "Xin."), pero `slugFromShortName` solo reconoce como inicial un token de UNA
 * letra — con más, no recorta nada y el slug guardado queda "apellido nombre"
 * completo, CON ESPACIO, no con guion. `slugFromFullName` nunca prueba eso, así
 * que un nombre completo real (de ESPN) nunca resolvía a esos jugadores.
 */
export function longInitialSlugCandidates(raw: string): string[] {
  const n = normalizeName(raw);
  if (!n) return [];
  const parts = n.split(' ');
  if (parts.length === 1) return [];
  const first = parts[0];
  const surname = parts.slice(1).join(' ');
  const out: string[] = [];
  for (let len = 2; len <= Math.min(4, first.length); len++) {
    const prefix = first.slice(0, len);
    out.push(`${surname}-${prefix}`, `${surname} ${prefix}`);
  }
  return out;
}

/** ¿Es una fila de jugador utilizable? Descarta vacíos y marcadores tipo "Bye". */
export function isRealPlayer(raw: string): boolean {
  const n = normalizeName(raw);
  return n.length > 1 && n !== 'bye' && n !== 'unknown';
}
