# Notificaciones push (PWA) — ago 2026

El sitio es instalable (PWA) y cualquier visitante puede activar avisos push,
sin necesitar cuenta — el sitio web nunca ha tenido login (a diferencia de la
app móvil, `tenismo-app/`). Una suscripción es un NAVEGADOR/dispositivo
concreto, no una persona: el Push API identifica por `endpoint`.

## Tres tipos de aviso

1. **Partidos destacados en vivo** (`notify_matches`) — Grand Slam, Masters
   1000/WTA1000 o cualquier Challenger (criterio en
   `src/lib/tournament-tier.ts`). Una vez por partido, al empezar — nunca por
   cada punto. Lo dispara `scripts/notify-live-matches.ts`, colgado del cron
   de 15 min que ya existía (`.github/workflows/en-vivo.yml`).
2. **Oportunidades de cuotas** (`notify_odds`) — cuando el simulador (modo
   Favorito, ver [docs/13](./13-paradigma-favoritos.md)) coloca picks nuevos.
   Lo manda `scripts/paper-trade.ts` mismo, al final de cada corrida diaria.
3. **Resumen diario** (`notify_daily`) — mañana (qué hay programado hoy) y
   noche (cómo salió: partidos jugados, aciertos del simulador, banca).
   `scripts/notify-daily-summary.ts --morning` / `--evening`, cron aparte en
   `.github/workflows/resumen-diario.yml`.

Cada suscripción tiene los tres temas activados por defecto
(`push_subscriptions.notify_*`, boolean por tema) — no hay UI todavía para
apagar uno solo, pero la columna ya existe para cuando se quiera.

## Piezas

- `db/postgres/0006_push_notifications.sql` — `push_subscriptions` +
  `notified_events` (deduplicación genérica: "este evento ya se avisó").
- `src/lib/push.ts` — guardar/borrar suscripciones, `broadcastPush(topic,
  payload)`, `claimEvent(kind, dedupKey)`. Una suscripción que responde
  404/410 (caducada) se borra sola.
- `public/manifest.webmanifest` + `public/sw.js` — instalación + recepción
  del push en el navegador. El SW NO cachea páginas (el sitio es SSR con
  datos que cambian todo el tiempo — cachear serviría datos viejos).
- `src/components/PushSubscribeButton.tsx` — botón "Activar avisos", en el
  sidebar de escritorio y en el header móvil (`src/layouts/Base.astro`).
  Detecta iOS-sin-instalar (`Notification`/`PushManager` existen mas no
  funcionan de verdad si la página no se abrió desde el ícono instalado) y
  permiso denegado, con su propio mensaje en vez de un botón que no hace nada.
- `src/pages/api/push/{subscribe,unsubscribe}.ts` — únicas rutas que tocan la
  tabla desde el navegador.

## Configuración necesaria (una sola vez)

Par de claves VAPID generado con `npx web-push generate-vapid-keys` — ya
generado y en el `.env` local. Hace falta copiarlo a los otros dos sitios
donde corre código de este proyecto (Claude no tiene acceso para escribir ahí
directo: ni `gh` ni un token de Vercel con permiso de escritura en este
entorno):

**Vercel** (panel del proyecto → Settings → Environment Variables):
```
PUBLIC_VAPID_PUBLIC_KEY = <la pública>
VAPID_PRIVATE_KEY       = <la privada>
VAPID_SUBJECT           = https://tenismo.vercel.app
```

**GitHub Actions** (repo → Settings → Secrets and variables → Actions):
mismos tres nombres, mismos valores.

Sin estas variables: el sitio sigue funcionando normal, el botón de
suscripción no aparece (`PUBLIC_VAPID_PUBLIC_KEY` ausente = "no configurado
todavía"), y los tres scripts de aviso fallan con un error explícito
("Faltan claves VAPID...") en vez de fallar en silencio o inventar algo.

## Cómo probarlo en el teléfono

- **Android (Chrome)**: entra al sitio, toca "Activar avisos", concede el
  permiso. Funciona en la pestaña normal, sin instalar nada.
- **iPhone (Safari, iOS 16.4+)**: hace falta instalar primero — Compartir →
  "Añadir a pantalla de inicio" — y abrir Tenismo desde ese ícono. Recién ahí
  aparece el botón activo (antes muestra el aviso de instalar).

## Verificado sin teléfono real

- Suscripción guardada vía `POST /api/push/subscribe` → fila real en
  `push_subscriptions`.
- `broadcastPush` firmando con VAPID de verdad y mandando un POST real a
  `fcm.googleapis.com` (Chrome/Android) — confirmado con dos pruebas: una
  auth key inválida rechazada localmente por `web-push` (nunca llegó a salir
  la petición), y una auth key con el tamaño correcto que sí generó la
  petición real y volvió 404/410 (endpoint de prueba inventado), lo que
  disparó correctamente el auto-borrado de suscripciones caducadas.
- Lo que NO se pudo probar desde aquí: la entrega visual en un teléfono real
  — conceder el permiso de notificaciones requiere un gesto humano genuino
  que este entorno no puede simular (el navegador automatizado deniega el
  permiso por política). Eso solo se confirma probándolo en tu propio
  dispositivo.
