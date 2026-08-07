import type { APIRoute } from 'astro';
import {
  createBankroll, listBankrolls, getBankrollSummary, addBankrollMovement,
  listTransactions, getDailySummary, resetBankroll, BetValidationError,
} from '../../../lib/bets';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export const GET: APIRoute = async ({ url }) => {
  const view = url.searchParams.get('view') ?? 'list';
  const bankrollId = Number(url.searchParams.get('bankrollId'));

  try {
    if (view === 'list') return json({ bankrolls: await listBankrolls() });

    if (!Number.isFinite(bankrollId)) return json({ error: 'bankrollId requerido.' }, 400);

    if (view === 'summary') {
      const summary = await getBankrollSummary(bankrollId);
      if (!summary) return json({ error: 'Banca no encontrada.' }, 404);
      return json({ summary });
    }
    if (view === 'transactions') {
      return json({ transactions: await listTransactions(bankrollId) });
    }
    if (view === 'daily') {
      const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
      return json({ daily: await getDailySummary(bankrollId, date) });
    }
    return json({ error: `Vista desconocida: ${view}` }, 400);
  } catch (e) {
    if (e instanceof BetValidationError) return json({ error: e.message }, 400);
    return json({ error: `Error de base de datos: ${(e as Error).message}` }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Cuerpo JSON inválido.' }, 400);
  }

  try {
    // Movimiento de caja (depósito / retiro / ajuste) sobre una banca existente.
    if (body.action === 'movement') {
      const bankrollId = Number(body.bankrollId);
      const amount = Number(body.amount);
      const type = String(body.type ?? '');
      if (!Number.isFinite(bankrollId)) return json({ error: 'bankrollId requerido.' }, 400);
      if (!['DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT'].includes(type)) {
        return json({ error: 'type debe ser DEPOSIT, WITHDRAWAL o ADJUSTMENT.' }, 400);
      }
      if (!(amount > 0)) return json({ error: 'El importe debe ser mayor que 0.' }, 400);
      await addBankrollMovement({
        bankrollId,
        type: type as 'DEPOSIT' | 'WITHDRAWAL' | 'ADJUSTMENT',
        amount,
        description: body.description ? String(body.description) : undefined,
      });
      return json({ ok: true }, 201);
    }

    // Reinicio: borra TODAS las apuestas y movimientos de la banca. Son datos
    // reales metidos a mano, así que exige repetir el NOMBRE de la banca como
    // confirmación — no basta un botón, hay que escribir qué se está borrando.
    if (body.action === 'reset') {
      const bankrollId = Number(body.bankrollId);
      if (!Number.isFinite(bankrollId)) return json({ error: 'bankrollId requerido.' }, 400);
      const confirmName = String(body.confirmName ?? '').trim();
      const actual = (await listBankrolls()).find((b) => b.id === bankrollId);
      if (!actual) return json({ error: 'Banca no encontrada.' }, 404);
      if (confirmName !== actual.name) {
        return json({ error: 'El nombre no coincide. Escribe el nombre exacto de la banca para confirmar.' }, 400);
      }
      // `null` cuenta como "sin indicar", NO como 0: JSON.stringify convierte
      // NaN en null (p. ej. Number("200,50") con coma decimal en vez de
      // punto), y sin esta rama Number(null) da 0 — la banca se reiniciaba a
      // $0 en silencio en vez de avisar de que el número no se entendió.
      const sinIndicar = body.initialBalance === undefined || body.initialBalance === null || body.initialBalance === '';
      const initialBalance = sinIndicar ? undefined : Number(body.initialBalance);
      if (initialBalance !== undefined && (!Number.isFinite(initialBalance) || initialBalance < 0)) {
        return json({ error: 'La banca inicial debe ser un número no negativo (usa punto decimal, no coma).' }, 400);
      }
      await resetBankroll({ bankrollId, initialBalance });
      return json({ ok: true });
    }

    // Crear banca. El saldo inicial lo pone el usuario a mano — nunca se toma
    // de una captura ni del saldo que muestre una casa de apuestas.
    const name = String(body.name ?? '').trim();
    const currency = String(body.currency ?? 'USD').trim().toUpperCase();
    const initialBalance = Number(body.initialBalance);
    if (!name) return json({ error: 'El nombre de la banca es obligatorio.' }, 400);
    if (!Number.isFinite(initialBalance) || initialBalance < 0) {
      return json({ error: 'La banca inicial debe ser un número no negativo.' }, 400);
    }
    const id = await createBankroll({ name, currency, initialBalance });
    return json({ id }, 201);
  } catch (e) {
    if (e instanceof BetValidationError) return json({ error: e.message }, 400);
    return json({ error: `No se pudo completar: ${(e as Error).message}` }, 500);
  }
};
