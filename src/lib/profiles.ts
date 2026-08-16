import { db } from './db';

/**
 * Estado de Premium del lado servidor — hoy SOLO lo usa el límite de bancas
 * (1 gratis / 5 Premium, ver `api/mobile/bets/bankroll.ts`). Sigue siendo un
 * STUB: no hay verificación de pago real acá, exactamente igual que
 * `tenismo-app/src/lib/premium.tsx` del lado móvil — este archivo es
 * simplemente el lugar donde ese flag ahora también vive en el servidor,
 * para que el límite de bancas no dependa de confiar en lo que diga el
 * cliente.
 */
export async function isPremiumUser(userId: string): Promise<boolean> {
  const c = db();
  const row = (
    await c.execute({ sql: 'select is_premium from profiles where user_id = ?', args: [userId] })
  ).rows[0];
  if (!row) return false;
  return row.is_premium === true || Number(row.is_premium) === 1;
}

/** Crea o actualiza la fila de perfil — upsert porque puede ser la primera vez que este usuario toca el servidor. */
export async function setPremium(userId: string, isPremium: boolean): Promise<void> {
  const c = db();
  await c.execute({
    sql: `insert into profiles (user_id, is_premium, updated_at) values (?, ?, iso_now())
          on conflict (user_id) do update set is_premium = excluded.is_premium, updated_at = iso_now()`,
    args: [userId, isPremium],
  });
}
