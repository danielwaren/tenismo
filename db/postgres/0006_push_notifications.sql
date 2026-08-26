-- Notificaciones push (PWA), ago 2026. Publico: cualquier visitante puede
-- suscribirse desde el sitio (no requiere login -- el sitio web nunca lo ha
-- tenido, a diferencia de la app movil). Una suscripcion = un navegador/
-- dispositivo concreto (el Push API identifica por `endpoint`, no por
-- persona), asi que no hace falta usuario para esto.
create table if not exists push_subscriptions (
  id             bigint generated always as identity primary key,
  endpoint       text not null unique,
  p256dh         text not null,
  auth           text not null,
  user_agent     text,
  -- Temas por separado desde el dia uno: hoy el boton de "activar avisos"
  -- suscribe a los tres a la vez, pero la fila ya soporta que mas adelante
  -- se pueda apagar uno solo (p.ej. "quiero resumenes pero no cada partido")
  -- sin tener que migrar el esquema otra vez.
  notify_matches boolean not null default true,
  notify_odds    boolean not null default true,
  notify_daily   boolean not null default true,
  created_at     text not null default iso_now(),
  last_seen_at   text not null default iso_now()
);

-- Deduplicacion generica para los tres tipos de aviso. `dedup_key` vive en su
-- propio espacio de nombres por `kind` (un partido en vivo, un pick del
-- simulador, un resumen de un dia) -- evita mandar el mismo aviso dos veces
-- si el cron que lo dispara corre mas de una vez sobre el mismo evento (cada
-- 15 min para partidos en vivo, p.ej.).
create table if not exists notified_events (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('live_match', 'odds_pick', 'daily_summary')),
  dedup_key  text not null,
  created_at text not null default iso_now(),
  unique (kind, dedup_key)
);
