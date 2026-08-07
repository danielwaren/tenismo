import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/**
 * Reinicia la banca del Paper Trading (modo auditoría).
 *
 * Borra TODAS las apuestas simuladas de `paper_trades`. Es seguro: esta banca
 * no es dinero real ni una decisión del usuario — la coloca sola el cron
 * diario (scripts/paper-trade.ts) sobre partidos con cuota real, así que
 * "resetear" solo significa que el próximo run vuelve a acumular desde cero.
 * `paper_trading_config` guarda los parámetros (kelly, edge mínimo…), no se
 * toca salvo que se pida un `initialBankroll` nuevo explícito.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    /* cuerpo vacío = reset sin cambiar la banca inicial */
  }

  const c = db();
  const initialBankroll = body.initialBankroll === undefined ? null : Number(body.initialBankroll);
  if (initialBankroll !== null && (!Number.isFinite(initialBankroll) || initialBankroll <= 0)) {
    return json({ error: 'La banca inicial debe ser un número mayor que 0.' }, 400);
  }

  const tx = await c.transaction('write');
  try {
    await tx.execute('delete from paper_trades');
    if (initialBankroll !== null) {
      await tx.execute({
        sql: 'update paper_trading_config set initial_bankroll = ?, updated_at = iso_now() where id = 1',
        args: [initialBankroll],
      });
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    return json({ error: `No se pudo reiniciar: ${(e as Error).message}` }, 500);
  }

  return json({ ok: true });
};
