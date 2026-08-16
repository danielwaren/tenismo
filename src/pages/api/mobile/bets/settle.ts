import type { APIRoute } from 'astro';
import { settleBet, updateBetNotes, getBet, getBankrollOwnerId, AlreadySettledError, BetValidationError } from '../../../../lib/bets';
import { verifyBearerToken } from '../../../../lib/mobile-auth';
import { jsonCors, corsPreflight } from '../../../../lib/api-cors';

export const prerender = false;

/**
 * Versión móvil de `api/bets/settle.ts`. La apuesta no lleva el dueño
 * directo (solo `bankroll_id`) — se busca la apuesta primero para saber de
 * qué banca es, y ahí recién se verifica que esa banca sea de quien llama.
 * La protección contra doble liquidación sigue viviendo en `settleBet()`
 * (el UPDATE con `where status='OPEN'`), sin cambios.
 */
export const POST: APIRoute = async ({ request }) => {
  const userId = await verifyBearerToken(request);
  if (!userId) return jsonCors({ error: 'Sesión inválida o ausente.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonCors({ error: 'Cuerpo JSON inválido.' }, 400);
  }

  const id = Number(body.id);
  if (!Number.isFinite(id)) return jsonCors({ error: 'id de apuesta requerido.' }, 400);

  const bet = await getBet(id);
  if (!bet) return jsonCors({ error: 'Apuesta no encontrada.' }, 404);
  const owner = await getBankrollOwnerId(bet.bankrollId);
  if (owner === null || owner !== userId) return jsonCors({ error: 'Esta apuesta no te pertenece.' }, 403);

  if (body.action === 'notes') {
    try {
      await updateBetNotes(id, String(body.notes ?? ''));
      return jsonCors({ ok: true });
    } catch (e) {
      return jsonCors({ error: `No se pudieron guardar las notas: ${(e as Error).message}` }, 500);
    }
  }

  const outcome = String(body.outcome ?? '');
  if (!['WON', 'LOST', 'VOID', 'CASHOUT'].includes(outcome)) {
    return jsonCors({ error: 'outcome debe ser WON, LOST, VOID o CASHOUT.' }, 400);
  }

  const cashoutAmount = body.cashoutAmount === undefined ? undefined : Number(body.cashoutAmount);
  if (outcome === 'CASHOUT' && !(cashoutAmount !== undefined && cashoutAmount >= 0)) {
    return jsonCors({ error: 'Falta el importe recibido en el cashout.' }, 400);
  }

  try {
    const settled = await settleBet(id, outcome as 'WON' | 'LOST' | 'VOID' | 'CASHOUT', { cashoutAmount });
    return jsonCors({ bet: settled });
  } catch (e) {
    if (e instanceof AlreadySettledError) return jsonCors({ error: e.message }, 409);
    if (e instanceof BetValidationError) return jsonCors({ error: e.message }, 400);
    return jsonCors({ error: `No se pudo liquidar: ${(e as Error).message}` }, 500);
  }
};

export const OPTIONS: APIRoute = async () => corsPreflight();
