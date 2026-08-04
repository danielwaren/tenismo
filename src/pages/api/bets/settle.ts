import type { APIRoute } from 'astro';
import { settleBet, updateBetNotes, AlreadySettledError, BetValidationError } from '../../../lib/bets';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/**
 * Liquida una apuesta (ganada / perdida / anulada / cashout) o actualiza sus
 * notas. La protección contra doble liquidación vive en settleBet(): el
 * UPDATE lleva `where status='OPEN'`, así que dos peticiones simultáneas no
 * pueden liquidar dos veces (la segunda recibe 409).
 */
export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Cuerpo JSON inválido.' }, 400);
  }

  const id = Number(body.id);
  if (!Number.isFinite(id)) return json({ error: 'id de apuesta requerido.' }, 400);

  // Actualización de notas: no toca la contabilidad.
  if (body.action === 'notes') {
    try {
      await updateBetNotes(id, String(body.notes ?? ''));
      return json({ ok: true });
    } catch (e) {
      return json({ error: `No se pudieron guardar las notas: ${(e as Error).message}` }, 500);
    }
  }

  const outcome = String(body.outcome ?? '');
  if (!['WON', 'LOST', 'VOID', 'CASHOUT'].includes(outcome)) {
    return json({ error: 'outcome debe ser WON, LOST, VOID o CASHOUT.' }, 400);
  }

  const cashoutAmount = body.cashoutAmount === undefined ? undefined : Number(body.cashoutAmount);
  if (outcome === 'CASHOUT' && !(cashoutAmount !== undefined && cashoutAmount >= 0)) {
    return json({ error: 'Falta el importe recibido en el cashout.' }, 400);
  }

  try {
    const bet = await settleBet(id, outcome as 'WON' | 'LOST' | 'VOID' | 'CASHOUT', { cashoutAmount });
    return json({ bet });
  } catch (e) {
    if (e instanceof AlreadySettledError) return json({ error: e.message }, 409);
    if (e instanceof BetValidationError) return json({ error: e.message }, 400);
    return json({ error: `No se pudo liquidar: ${(e as Error).message}` }, 500);
  }
};
