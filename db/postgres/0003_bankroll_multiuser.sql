-- "Mis apuestas" pasa a ser multi-usuario. Hasta ahora era una herramienta
-- de un solo operador (sin auth, sin user_id) — ver el comentario de
-- src/lib/bets.ts. Esto agrega el enganche para que la app móvil (login con
-- Google vía Supabase Auth) pueda tener cada usuario con su propia banca,
-- sin tocar en nada el uso actual de la web.
--
-- La banca existente (id=1, con las apuestas ya registradas) queda con
-- user_id NULL — invisible para cualquier usuario real vía el filtrado que
-- hacen las rutas nuevas de /api/mobile/bets/*, y trading.astro (web, sigue
-- sin auth) continúa listando TODAS las bancas sin filtrar, exactamente
-- como hoy: cero cambios de comportamiento para ese flujo.
alter table bankrolls add column if not exists user_id uuid;
create index if not exists idx_bankrolls_user on bankrolls(user_id);

-- Estado de Premium del lado servidor — hoy solo lo necesita el límite de
-- bancas (1 gratis / 5 Premium, ver /api/mobile/bets/bankroll.ts), pero es
-- el sitio natural para cualquier futura verificación server-side de
-- Premium (hoy 100% stub local en tenismo-app/src/lib/premium.tsx).
create table if not exists profiles (
  user_id     uuid primary key,
  is_premium  boolean not null default false,
  created_at  text not null default iso_now(),
  updated_at  text not null default iso_now()
);

-- Sin políticas: mismo patrón ya aplicado al resto de las tablas del
-- proyecto (deny-all por defecto vía PostgREST para anon/authenticated). El
-- backend Astro conecta con el rol `postgres` (rolbypassrls=true, ver
-- src/lib/db.ts) y el control de acceso real vive en las rutas API nuevas,
-- no en políticas RLS — mismo criterio que el resto del proyecto.
alter table bankrolls enable row level security;
alter table profiles enable row level security;
