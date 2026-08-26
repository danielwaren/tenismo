/**
 * Service worker de Tenismo — solo dos trabajos:
 *   1. Habilitar la instalación como PWA (junto con manifest.webmanifest).
 *   2. Mostrar las notificaciones push que manden los scripts de cron
 *      (scripts/notify-*.ts, vía src/lib/push.ts) y llevar al click a la
 *      página correspondiente.
 *
 * Sin caché de assets a propósito: el sitio es SSR con datos que cambian
 * todo el tiempo (partidos en vivo, cuotas) — cachear páginas serviría datos
 * viejos, que es justo el problema que NO queremos. Cachear solo los assets
 * estáticos sin las páginas añadiría complejidad (estrategias de invalidación)
 * por una ganancia de rendimiento marginal en un sitio ya rápido en SSR.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: 'Tenismo', body: event.data.text() };
    }
  }

  const title = data.title || 'Tenismo';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || undefined,
    // `renotify` solo tiene efecto si hay `tag`: sin él, reemplazar una
    // notificación con el mismo tag sería silencioso (sin vibrar/sonar de
    // nuevo), que es sorprendente para un aviso genuinamente nuevo.
    renotify: Boolean(data.tag),
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    }),
  );
});
