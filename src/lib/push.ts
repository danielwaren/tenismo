import webpush from 'web-push';
import { db } from './db';

/**
 * Notificaciones push (Web Push / VAPID) — capa de persistencia y envío.
 *
 * Publico: cualquier visitante puede suscribirse desde el sitio (no hay login
 * en la web, a diferencia de la app móvil). Una fila de `push_subscriptions`
 * es un NAVEGADOR, no una persona — el Push API identifica por `endpoint`.
 *
 * Quien manda notificaciones de verdad son los scripts de cron
 * (scripts/notify-*.ts), nunca una ruta de la web en caliente: por eso este
 * módulo lee las claves VAPID de `process.env` sin pasar por `PUBLIC_` salvo
 * la pública, que sí necesita llegar al navegador (ver src/lib/db.ts sobre el
 * mismo criterio para otros secretos).
 */

export type PushTopic = 'notify_matches' | 'notify_odds' | 'notify_daily';
export const PUSH_TOPICS: PushTopic[] = ['notify_matches', 'notify_odds', 'notify_daily'];

let vapidConfigured = false;
function ensureVapid(): void {
  if (vapidConfigured) return;
  const publicKey = process.env.PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error(
      'Faltan claves VAPID (PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT) — ver .env.example.',
    );
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
}

/**
 * Guarda o refresca una suscripción. `on conflict` por `endpoint`: el mismo
 * navegador puede volver a suscribirse (p. ej. tras limpiar datos del sitio,
 * el navegador reusa el mismo endpoint mientras el permiso siga concedido) sin
 * duplicar la fila.
 */
export async function saveSubscription(sub: SubscriptionInput): Promise<void> {
  const c = db();
  await c.execute({
    sql: `insert into push_subscriptions (endpoint, p256dh, auth, user_agent)
          values (?, ?, ?, ?)
          on conflict (endpoint) do update set
            p256dh = excluded.p256dh, auth = excluded.auth, last_seen_at = iso_now()`,
    args: [sub.endpoint, sub.keys.p256dh, sub.keys.auth, sub.userAgent ?? null],
  });
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  const c = db();
  await c.execute({ sql: 'delete from push_subscriptions where endpoint = ?', args: [endpoint] });
}

export interface PushPayload {
  title: string;
  body: string;
  /** Ruta a la que navegar al hacer click (se resuelve contra el origen del sitio en el service worker). */
  url?: string;
  /** Agrupa notificaciones: una nueva con el mismo tag reemplaza a la anterior en vez de apilarse. */
  tag?: string;
}

export interface BroadcastResult {
  topic: PushTopic;
  subscribers: number;
  sent: number;
  removed: number;
  failed: number;
}

/**
 * Manda `payload` a todos los suscriptores de un tema. Una suscripción que
 * responde 404/410 (endpoint caducado del lado del navegador/proveedor push)
 * se borra sola — es la señal estándar del protocolo Web Push de "esto ya no
 * existe", no un error transitorio que valga la pena reintentar.
 */
export async function broadcastPush(topic: PushTopic, payload: PushPayload): Promise<BroadcastResult> {
  ensureVapid();
  const c = db();
  const rows = (
    await c.execute(`select id, endpoint, p256dh, auth from push_subscriptions where ${topic} = true`)
  ).rows;

  const body = JSON.stringify(payload);
  let sent = 0, removed = 0, failed = 0;
  for (const r of rows) {
    const endpoint = String(r.endpoint);
    try {
      await webpush.sendNotification(
        { endpoint, keys: { p256dh: String(r.p256dh), auth: String(r.auth) } },
        body,
      );
      sent++;
    } catch (e) {
      const statusCode = (e as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await deleteSubscription(endpoint);
        removed++;
      } else {
        failed++;
        console.warn(`[push] fallo enviando a suscripción ${r.id}:`, (e as Error).message);
      }
    }
  }
  return { topic, subscribers: rows.length, sent, removed, failed };
}

/**
 * Reclama un evento para notificar como máximo UNA vez. Devuelve `true` solo
 * la primera vez que se llama con esta combinación `kind`+`dedupKey` — el
 * `insert ... on conflict do nothing` es la comprobación Y la escritura en la
 * misma sentencia (mismo patrón que `settleBet` en bets.ts: sin ventana de
 * carrera entre "¿ya se avisó?" y "marcar avisado").
 */
export async function claimEvent(kind: 'live_match' | 'odds_pick' | 'daily_summary', dedupKey: string): Promise<boolean> {
  const c = db();
  const res = await c.execute({
    sql: `insert into notified_events (kind, dedup_key) values (?, ?) on conflict (kind, dedup_key) do nothing`,
    args: [kind, dedupKey],
  });
  return res.rowsAffected > 0;
}
