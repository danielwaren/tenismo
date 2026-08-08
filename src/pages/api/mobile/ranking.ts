import type { APIRoute } from 'astro';
import { getRanking } from '../../../lib/queries';
import { jsonCors, corsPreflight } from '../../../lib/api-cors';

export const prerender = false;

const SURFACES = ['all', 'hard', 'clay', 'grass', 'carpet'] as const;

/** Ranking Elo para la app móvil: mismo `getRanking` que usa `ranking.astro`. */
export const GET: APIRoute = async ({ url }) => {
  const tourParam = url.searchParams.get('tour');
  const tour = tourParam === 'WTA' ? 'WTA' : 'ATP';
  const surfaceParam = url.searchParams.get('surface');
  const surface = (SURFACES as readonly string[]).includes(surfaceParam ?? '')
    ? (surfaceParam as (typeof SURFACES)[number])
    : 'all';
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 30));

  const ranking = await getRanking(tour, surface, limit);
  return jsonCors({ tour, surface, ranking });
};

export const OPTIONS: APIRoute = async () => corsPreflight();
