export function playerPath(id: number, slug: string): string {
  return `/player/${slug}-${id}`;
}

export function matchPath(match: { id: number; p1Slug: string; p2Slug: string }): string {
  return `/match/${match.p1Slug}-vs-${match.p2Slug}-${match.id}`;
}

/**
 * Ficha de un torneo Challenger.
 *
 * El id que da la fuente es su ruta (`/hagen-challenger/2026/atp-men/`), con
 * barras dentro, así que se codifica entero en UN solo segmento. No se guarda
 * en la base: estos torneos vienen del proveedor en cada petición.
 */
export function challengerPath(tournamentId: string): string {
  return `/challenger/${encodeURIComponent(tournamentId)}`;
}

export function idFromReadablePath(value: string | undefined): number | null {
  const match = (value ?? '').match(/(?:^|-)(\d+)$/);
  return match ? Number(match[1]) : null;
}
