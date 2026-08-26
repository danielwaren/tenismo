import { useEffect, useState } from 'react';
import { pushSupported, isStandalone, isIOS, urlBase64ToUint8Array, registerServiceWorker } from '../lib/push-client';

type Status = 'checking' | 'unsupported' | 'ios-needs-install' | 'denied' | 'subscribed' | 'ready' | 'busy';

/**
 * Botón "Activar avisos" — suscribe ESTE navegador a notificaciones push
 * (partidos destacados en vivo, picks del simulador, resumen diario). Público:
 * cualquier visitante puede activarlas, no requiere cuenta.
 *
 * En iOS Safari, `Notification`/`PushManager` existen en el objeto global
 * pero no funcionan de verdad si la página no se abrió desde el ícono
 * instalado ("Compartir" → "Añadir a pantalla de inicio", iOS 16.4+) — por
 * eso el estado `ios-needs-install` explica el paso extra en vez de fallar
 * en silencio o mostrar un botón que no hace nada al tocarlo.
 */
export default function PushSubscribeButton({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function check() {
      if (!pushSupported()) { setStatus('unsupported'); return; }
      if (isIOS() && !isStandalone()) { setStatus('ios-needs-install'); return; }
      if (Notification.permission === 'denied') { setStatus('denied'); return; }
      try {
        const registration = await registerServiceWorker();
        const sub = await registration.pushManager.getSubscription();
        setStatus(sub ? 'subscribed' : 'ready');
      } catch {
        setStatus('unsupported');
      }
    }
    check();
  }, []);

  async function subscribe() {
    setError(null);
    setStatus('busy');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setStatus('denied'); return; }

      const publicKey = import.meta.env.PUBLIC_VAPID_PUBLIC_KEY as string | undefined;
      if (!publicKey) throw new Error('Notificaciones no configuradas todavía en este despliegue.');

      const registration = await registerServiceWorker();
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast a BufferSource: con @types/node cargado, Uint8Array queda
        // tipado sobre ArrayBufferLike (incluye SharedArrayBuffer) y el DOM
        // exige ArrayBuffer a secas — un desajuste de tipos, no de datos
        // reales (en el navegador esto siempre es un ArrayBuffer normal).
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const json = sub.toJSON();
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'No se pudo guardar la suscripción.');
      setStatus('subscribed');
    } catch (e) {
      setError((e as Error).message);
      setStatus('ready');
    }
  }

  async function unsubscribe() {
    setError(null);
    setStatus('busy');
    try {
      const registration = await registerServiceWorker();
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus('ready');
    } catch (e) {
      setError((e as Error).message);
      setStatus('subscribed');
    }
  }

  const base = compact
    ? 'grid h-9 w-9 shrink-0 place-items-center rounded-full border text-base'
    : 'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium';

  if (status === 'checking') return null; // evita el parpadeo del botón mientras se resuelve el estado real
  if (status === 'unsupported') return null; // navegador sin Push API: no hay nada que ofrecer

  if (status === 'ios-needs-install') {
    return (
      <div className={compact ? 'text-2xs text-ink-faint' : `${base} border-line text-ink-faint`} title="En iPhone: toca Compartir → Añadir a pantalla de inicio, y vuelve a abrir Tenismo desde ahí para activar los avisos.">
        {compact ? '🔔' : <><span>🔔</span><span>Instala la app para activar avisos (iPhone: Compartir → Añadir a inicio)</span></>}
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div className={compact ? 'text-2xs text-ink-faint' : `${base} border-line text-ink-faint`} title="Bloqueaste las notificaciones para este sitio — actívalas desde los ajustes del navegador si cambias de idea.">
        {compact ? '🔕' : <><span>🔕</span><span>Notificaciones bloqueadas</span></>}
      </div>
    );
  }

  const subscribed = status === 'subscribed';
  const busy = status === 'busy';

  return (
    <div className={compact ? '' : 'flex flex-col gap-1'}>
      <button
        type="button"
        disabled={busy}
        onClick={subscribed ? unsubscribe : subscribe}
        title={subscribed ? 'Desactivar avisos en este dispositivo' : 'Activar avisos: partidos destacados en vivo, picks del simulador y resumen diario'}
        className={`${base} ${subscribed ? 'border-court/40 bg-court/10 text-court-ink' : 'border-line text-ink-muted hover:border-court/40 hover:text-court-ink'} disabled:opacity-50`}
      >
        {compact ? (subscribed ? '🔔' : '🔕') : (
          <>
            <span>{subscribed ? '🔔' : '🔕'}</span>
            <span>{busy ? 'Un momento…' : subscribed ? 'Avisos activados' : 'Activar avisos'}</span>
          </>
        )}
      </button>
      {!compact && error && <p className="text-2xs text-live">{error}</p>}
    </div>
  );
}
