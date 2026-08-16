-- Jugadores favoritos — perfil móvil (propuesta 3: favoritos EXPLÍCITOS, no
-- inferidos del historial de apuestas). Se marcan con el corazón en la ficha
-- de jugador (`player/[id].tsx`) y se muestran en Perfil.
--
-- Sin equivalente en la web: es una función nueva de la app móvil, atada a
-- la cuenta de Google (Supabase Auth) igual que "Mi banca" — mismo criterio
-- de auth ya establecido en 0003_bankroll_multiuser.sql.
create table if not exists favorite_players (
  user_id     uuid not null,
  player_id   integer not null references players(id) on delete cascade,
  created_at  text not null default iso_now(),
  primary key (user_id, player_id)
);
create index if not exists idx_favorite_players_user on favorite_players(user_id);

-- Sin políticas: mismo patrón deny-all ya aplicado a bankrolls/profiles en
-- 0003 — el backend Astro conecta como `postgres` (bypassa RLS) y el control
-- de acceso real vive en /api/mobile/favorites.ts, no en políticas RLS.
alter table favorite_players enable row level security;
