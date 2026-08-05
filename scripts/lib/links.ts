/**
 * Enlaces de ta_matches -> matches, en sentencias masivas.
 *
 * Vive aquí y no en ta-ingest.ts porque ese fichero ARRANCA el rastreo al
 * importarlo (llama a main() en el nivel superior): un test que lo importara
 * se pondría a pedir fichas a Tennis Abstract.
 */

/** Filas por sentencia. 3 parámetros cada una: muy por debajo del tope de 65535. */
export const LINKS_PER_STATEMENT = 500;

export interface TaLink {
  taKey: string;
  status: string;
  matchId: number | null;
}

/**
 * Convierte los enlaces en unos pocos `update ... from (values ...)`.
 *
 * Un UPDATE por fila son ~46.000 idas y vueltas contra Supabase, y eso solo
 * tardaba más que todo el resto del job junto (el run #10 de ta.yml murió por
 * timeout justo ahí, con el rastreo y las 52.676 filas de ta_matches ya
 * escritas). Agrupados son ~93 sentencias.
 *
 * `coalesceInserts` (scripts/lib/batch.ts) no puede hacerlo por su cuenta
 * porque solo agrupa INSERT: para un UPDATE hay que saber qué parámetros son
 * SET y cuáles WHERE, y eso solo se sabe en el sitio que los genera.
 *
 * Los `::` son OBLIGATORIOS: los parámetros de un VALUES llegan sin tipo y
 * Postgres no deduce que match_id es bigint — sin el cast falla con
 * "column match_id is of type bigint but expression is of type text".
 */
export function bulkLinkStmts(links: TaLink[]): { sql: string; args: unknown[] }[] {
  const out: { sql: string; args: unknown[] }[] = [];
  for (let i = 0; i < links.length; i += LINKS_PER_STATEMENT) {
    const rows = links.slice(i, i + LINKS_PER_STATEMENT);
    const tuples = rows.map(() => '(?,?,?)').join(', ');
    out.push({
      sql: `update ta_matches set link_status = v.status, match_id = v.match_id::bigint
            from (values ${tuples}) as v(ta_key, status, match_id)
            where ta_matches.ta_key = v.ta_key::text`,
      args: rows.flatMap((r) => [r.taKey, r.status, r.matchId]),
    });
  }
  return out;
}
