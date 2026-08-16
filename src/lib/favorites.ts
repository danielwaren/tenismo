import { db } from './db';

/**
 * Jugadores favoritos — persistencia para `/api/mobile/favorites.ts`.
 * Igual que `bets.ts`/`profiles.ts`: la app móvil nunca toca la base
 * directo, solo habla con esta ruta autenticada por Bearer token.
 */
export interface FavoritePlayerRow {
  id: number; name: string; slug: string; tour: string; hasPhoto: boolean;
}

export async function listFavoritePlayers(userId: string): Promise<FavoritePlayerRow[]> {
  const c = db();
  const rows = (await c.execute({
    sql: `select p.id, p.name, p.slug, t.code as tour, (p.photo_url is not null) as has_photo
          from favorite_players f
          join players p on p.id = f.player_id
          join tours t on t.id = p.tour_id
          where f.user_id = ?
          order by f.created_at desc`,
    args: [userId],
  })).rows;
  return rows.map((r) => ({
    id: Number(r.id), name: String(r.name), slug: String(r.slug), tour: String(r.tour),
    hasPhoto: r.has_photo === true,
  }));
}

/** Idempotente: marcar dos veces al mismo jugador no es un error. */
export async function addFavorite(userId: string, playerId: number): Promise<void> {
  const c = db();
  await c.execute({
    sql: `insert into favorite_players (user_id, player_id) values (?, ?)
          on conflict (user_id, player_id) do nothing`,
    args: [userId, playerId],
  });
}

export async function removeFavorite(userId: string, playerId: number): Promise<void> {
  const c = db();
  await c.execute({
    sql: 'delete from favorite_players where user_id = ? and player_id = ?',
    args: [userId, playerId],
  });
}
