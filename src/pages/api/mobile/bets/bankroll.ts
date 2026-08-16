import type { APIRoute } from 'astro';
import {
  createBankroll, listBankrolls, getBankrollSummary, addBankrollMovement,
  listTransactions, getDailySummary, resetBankroll, getBankrollOwnerId, countBankrollsForUser,
  BetValidationError,
} from '../../../../lib/bets';
import { verifyBearerToken } from '../../../../lib/mobile-auth';
import { isPremiumUser } from '../../../../lib/profiles';
import { jsonCors, corsPreflight } from '../../../../lib/api-cors';

export const prerender = false;

/**
 * Versión móvil de `api/bets/bankroll.ts` — MISMA lógica de negocio
 * (`bets.ts`), con dos cosas nuevas encima: (1) requiere un token de sesión
 * de Supabase válido, (2) toda banca ajena a quien llama da 403/404. La ruta
 * web (`api/bets/bankroll.ts`) NO cambia — sigue sin auth, sigue viendo
 * todas las bancas (la tuya, id=1, incluida).
 */

const FREE_LIMIT = 1;
const PREMIUM_LIMIT = 5;

export const GET: APIRoute = async ({ url, request }) => {
  const userId = await verifyBearerToken(request);
  if (!userId) return jsonCors({ error: 'Sesión inválida o ausente.' }, 401);

  const view = url.searchParams.get('view') ?? 'list';
  const bankrollId = Number(url.searchParams.get('bankrollId'));

  try {
    if (view === 'list') return jsonCors({ bankrolls: await listBankrolls(userId) });

    if (!Number.isFinite(bankrollId)) return jsonCors({ error: 'bankrollId requerido.' }, 400);
    const owner = await getBankrollOwnerId(bankrollId);
    if (owner === null) return jsonCors({ error: 'Banca no encontrada.' }, 404);
    if (owner !== userId) return jsonCors({ error: 'Esta banca no te pertenece.' }, 403);

    if (view === 'summary') {
      const summary = await getBankrollSummary(bankrollId);
      if (!summary) return jsonCors({ error: 'Banca no encontrada.' }, 404);
      return jsonCors({ summary });
    }
    if (view === 'transactions') {
      return jsonCors({ transactions: await listTransactions(bankrollId) });
    }
    if (view === 'daily') {
      const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
      return jsonCors({ daily: await getDailySummary(bankrollId, date) });
    }
    return jsonCors({ error: `Vista desconocida: ${view}` }, 400);
  } catch (e) {
    if (e instanceof BetValidationError) return jsonCors({ error: e.message }, 400);
    return jsonCors({ error: `Error de base de datos: ${(e as Error).message}` }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const userId = await verifyBearerToken(request);
  if (!userId) return jsonCors({ error: 'Sesión inválida o ausente.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonCors({ error: 'Cuerpo JSON inválido.' }, 400);
  }

  try {
    if (body.action === 'movement') {
      const bankrollId = Number(body.bankrollId);
      if (!Number.isFinite(bankrollId)) return jsonCors({ error: 'bankrollId requerido.' }, 400);
      const owner = await getBankrollOwnerId(bankrollId);
      if (owner === null) return jsonCors({ error: 'Banca no encontrada.' }, 404);
      if (owner !== userId) return jsonCors({ error: 'Esta banca no te pertenece.' }, 403);

      const amount = Number(body.amount);
      const type = String(body.type ?? '');
      if (!['DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT'].includes(type)) {
        return jsonCors({ error: 'type debe ser DEPOSIT, WITHDRAWAL o ADJUSTMENT.' }, 400);
      }
      if (!(amount > 0)) return jsonCors({ error: 'El importe debe ser mayor que 0.' }, 400);
      await addBankrollMovement({
        bankrollId, type: type as 'DEPOSIT' | 'WITHDRAWAL' | 'ADJUSTMENT', amount,
        description: body.description ? String(body.description) : undefined,
      });
      return jsonCors({ ok: true }, 201);
    }

    if (body.action === 'reset') {
      const bankrollId = Number(body.bankrollId);
      if (!Number.isFinite(bankrollId)) return jsonCors({ error: 'bankrollId requerido.' }, 400);
      const owner = await getBankrollOwnerId(bankrollId);
      if (owner === null) return jsonCors({ error: 'Banca no encontrada.' }, 404);
      if (owner !== userId) return jsonCors({ error: 'Esta banca no te pertenece.' }, 403);

      const confirmName = String(body.confirmName ?? '').trim();
      const actual = (await listBankrolls(userId)).find((b) => b.id === bankrollId);
      if (!actual) return jsonCors({ error: 'Banca no encontrada.' }, 404);
      if (confirmName !== actual.name) {
        return jsonCors({ error: 'El nombre no coincide. Escribe el nombre exacto de la banca para confirmar.' }, 400);
      }
      const sinIndicar = body.initialBalance === undefined || body.initialBalance === null || body.initialBalance === '';
      const initialBalance = sinIndicar ? undefined : Number(body.initialBalance);
      if (initialBalance !== undefined && (!Number.isFinite(initialBalance) || initialBalance < 0)) {
        return jsonCors({ error: 'La banca inicial debe ser un número no negativo (usa punto decimal, no coma).' }, 400);
      }
      await resetBankroll({ bankrollId, initialBalance });
      return jsonCors({ ok: true });
    }

    // Crear banca — el único lugar donde se aplica el límite 1 gratis / 5 Premium.
    const name = String(body.name ?? '').trim();
    const currency = String(body.currency ?? 'USD').trim().toUpperCase();
    const initialBalance = Number(body.initialBalance);
    if (!name) return jsonCors({ error: 'El nombre de la banca es obligatorio.' }, 400);
    if (!Number.isFinite(initialBalance) || initialBalance < 0) {
      return jsonCors({ error: 'La banca inicial debe ser un número no negativo.' }, 400);
    }

    // Stub de Premium (ver /api/mobile/bets/premium.ts): sin fila en
    // `profiles`, es gratis por defecto.
    const isPremium = await isPremiumUser(userId);
    const limit = isPremium ? PREMIUM_LIMIT : FREE_LIMIT;

    const current = await countBankrollsForUser(userId);
    if (current >= limit) {
      return jsonCors({
        error: isPremium
          ? `Límite de bancas Premium alcanzado (${PREMIUM_LIMIT}).`
          : `Límite de banca gratis alcanzado (${FREE_LIMIT}). Pasate a Premium para tener hasta ${PREMIUM_LIMIT}.`,
      }, 400);
    }

    const id = await createBankroll({ name, currency, initialBalance, userId });
    return jsonCors({ id }, 201);
  } catch (e) {
    if (e instanceof BetValidationError) return jsonCors({ error: e.message }, 400);
    return jsonCors({ error: `No se pudo completar: ${(e as Error).message}` }, 500);
  }
};

export const OPTIONS: APIRoute = async () => corsPreflight();
