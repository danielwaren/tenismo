/**
 * Resolución de jugadores entre las dos fuentes.
 *
 * tennis-data da nombres abreviados ("Auger-Aliassime F.", "De Minaur A.") y
 * The Odds API da nombres completos ("Felix Auger-Aliassime", "Alex de Minaur").
 * Hay que casarlos sin inventar.
 *
 * PRINCIPIO: ante la duda, NO se adivina. Un emparejamiento equivocado mete la
 * cuota de un partido en otro y contamina el modelo en silencio, que es mucho
 * peor que un partido que no se ingiere. Lo que no casa se REGISTRA para
 * revisarlo y crear un alias a mano.
 */
import { normalizeName, slugFromShortName, longInitialSlugCandidates } from '@tti/model';

export interface PlayerIndex {
  /** slug canónico -> id, para un circuito. */
  bySlug: Map<string, number>;
  /** apellido normalizado -> ids que lo comparten. */
  bySurname: Map<string, number[]>;
}

/** Construye el índice a partir de las filas de `players` de un circuito. */
export function buildIndex(rows: { id: number; slug: string }[]): PlayerIndex {
  const bySlug = new Map<string, number>();
  const bySurname = new Map<string, number[]>();
  for (const r of rows) {
    bySlug.set(r.slug, r.id);
    const surname = r.slug.split('-')[0];
    const list = bySurname.get(surname) ?? [];
    list.push(r.id);
    bySurname.set(surname, list);
  }
  return { bySlug, bySurname };
}

/**
 * Slugs candidatos para un nombre completo.
 *
 * La heurística simple (primer token = nombre de pila, resto = apellido) falla
 * con los nombres de pila compuestos: "Juan Martin del Potro" daría
 * "martin del potro-j" cuando la fuente histórica lo llama "del potro-j". Por
 * eso se generan varias particiones y se prueban todas contra el índice.
 */
export function candidateSlugs(fullName: string): string[] {
  const n = normalizeName(fullName);
  if (!n) return [];
  const parts = n.split(' ').filter(Boolean);
  if (parts.length === 1) return [parts[0]];

  const out: string[] = [];

  // Nombre YA abreviado ("Giustino L."), que es la forma en que la propia base
  // guarda `players.name` y la que dan tennis-data y tennisexplorer. Va
  // PRIMERO porque en ese caso es una coincidencia exacta, no una heurística.
  //
  // Sin esto, el bucle de abajo lee "Giustino" como nombre de pila y "L." como
  // apellido, y genera l-g, l-gi, l-giu… que no casan con nada: el pronóstico
  // salía como "jugador no reconocido" para jugadores que SÍ están en la base
  // y tienen Elo.
  if (parts.length > 1 && parts[parts.length - 1].length === 1) {
    const corto = slugFromShortName(fullName);
    if (corto) out.push(corto);
  }

  // k = cuántos tokens iniciales se consideran nombre de pila (1..parts.length-1)
  for (let k = 1; k < parts.length; k++) {
    const given = parts.slice(0, k);
    const surname = parts.slice(k).join(' ');
    const initials = given.map((g) => g[0]).join('');
    out.push(`${surname}-${initials}`);
    // También con la inicial del PRIMER nombre solamente: la fuente histórica
    // casi siempre usa una sola inicial aunque el jugador tenga dos nombres.
    if (initials.length > 1) out.push(`${surname}-${given[0][0]}`);
  }
  // Apellido + inicial compartidos por dos jugadores (gemelas, coincidencia):
  // la fuente distingue con más de una letra del nombre de pila, guardada sin
  // guion (ver longInitialSlugCandidates). Sin esto un nombre completo real
  // nunca resuelve a ninguno de los dos.
  out.push(...longInitialSlugCandidates(fullName));
  return [...new Set(out)];
}

export type ResolveResult =
  | { ok: true; playerId: number; via: 'slug' | 'alias' | 'apellido' }
  | { ok: false; reason: string; candidates: string[] };

/**
 * Resuelve un nombre completo a un id de jugador.
 * `aliases` mapea slug de alias -> id, y tiene prioridad sobre la heurística.
 */
export function resolvePlayer(
  fullName: string,
  index: PlayerIndex,
  aliases: Map<string, number>,
): ResolveResult {
  const candidates = candidateSlugs(fullName);
  if (!candidates.length) return { ok: false, reason: 'nombre vacío', candidates };

  for (const slug of candidates) {
    const byAlias = aliases.get(slug);
    if (byAlias !== undefined) return { ok: true, playerId: byAlias, via: 'alias' };
  }
  for (const slug of candidates) {
    const id = index.bySlug.get(slug);
    if (id !== undefined) return { ok: true, playerId: id, via: 'slug' };
  }

  // Último recurso: apellido ÚNICO en el circuito. Si lo comparten varios
  // jugadores no se elige ninguno — adivinar aquí es exactamente el error que
  // este módulo existe para evitar.
  const parts = normalizeName(fullName).split(' ').filter(Boolean);
  for (let k = 1; k < parts.length; k++) {
    const surname = parts.slice(k).join(' ');
    const hits = index.bySurname.get(surname);
    if (hits?.length === 1) return { ok: true, playerId: hits[0], via: 'apellido' };
    if (hits && hits.length > 1) {
      return { ok: false, reason: `apellido "${surname}" ambiguo (${hits.length} jugadores)`, candidates };
    }
  }

  return { ok: false, reason: 'sin coincidencia', candidates };
}

/** Slug canónico de un nombre abreviado, reexportado por comodidad. */
export { slugFromShortName };
