export function playerPath(id: number, slug: string): string {
  return `/player/${slug}-${id}`;
}

export function matchPath(match: { id: number; p1Slug: string; p2Slug: string }): string {
  return `/match/${match.p1Slug}-vs-${match.p2Slug}-${match.id}`;
}

/**
 * Slug legible de un torneo Challenger, a partir del id que da la fuente
 * ("/hagen-challenger/2026/atp-men/" -> "hagen-challenger-2026").
 *
 * NO se intenta invertir de vuelta al id original (regex adivinando dónde
 * termina el nombre y empieza el año sería frágil con nombres que ya traen
 * números, como "Plovdiv 2 challenger"). En su lugar, la página del torneo
 * recalcula este mismo slug para cada torneo del snapshot del día y busca
 * cuál coincide — comparación simétrica, sin adivinar nada.
 */
export function challengerSlug(tournamentId: string): string {
  const [nombre, anio] = tournamentId.split('/').filter(Boolean);
  return anio ? `${nombre}-${anio}` : nombre;
}

export function challengerPath(tournamentId: string): string {
  return `/challenger/${challengerSlug(tournamentId)}`;
}

export function idFromReadablePath(value: string | undefined): number | null {
  const match = (value ?? '').match(/(?:^|-)(\d+)$/);
  return match ? Number(match[1]) : null;
}
