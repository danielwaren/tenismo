-- Tennis Trader Intelligence — esquema base (Turso / libSQL / SQLite). Fase 1.
--
-- Diferencias de arquitectura frente a sports-trader-intelligence (Supabase):
--   · NO hay RLS. El token de Turso da acceso total, así que el control de
--     acceso vive en las API routes de Astro, nunca en la base.
--   · NO hay pg_cron ni pg_net: la ingesta y el reentrenamiento los dispara
--     GitHub Actions (.github/workflows/), no la base.
--   · Tipos SQLite: INTEGER / REAL / TEXT. Fechas siempre TEXT ISO-8601 (UTC).
--
-- DECISIÓN CLAVE — ORDEN p1/p2 SIN FUGA DE RESULTADO:
--   La fuente (tennis-data.co.uk) publica los partidos como Winner/Loser, no
--   como "jugador A vs jugador B". Si el modelo viera los partidos en ese orden
--   aprendería que "p1 siempre gana" — fuga de la variable objetivo.
--   Por eso cada partido se guarda TAMBIÉN con un orden determinista e
--   independiente del resultado: p1_id = min(winner_id, loser_id),
--   p2_id = max(...), y `p1_won` como etiqueta. Las cuotas se mapean al mismo
--   orden. winner_id/loser_id se conservan solo para lectura humana.

-- ── Circuitos ────────────────────────────────────────────────────────────────
create table if not exists tours (
  id   integer primary key,
  code text not null unique,          -- 'ATP' | 'WTA'
  name text not null
);
insert or ignore into tours (id, code, name) values (1, 'ATP', 'ATP Tour'), (2, 'WTA', 'WTA Tour');

-- ── Jugadores ────────────────────────────────────────────────────────────────
-- La fuente da nombres abreviados ("Vukic A.", "O Connell C."), sin ID estable.
-- `slug` es la forma normalizada (minúsculas, sin acentos ni puntuación) y es
-- la clave real de identidad. `player_aliases` absorbe las variantes de grafía
-- entre temporadas y las que traiga The Odds API (nombre completo).
create table if not exists players (
  id         integer primary key autoincrement,
  tour_id    integer not null references tours(id),
  name       text not null,
  slug       text not null,
  country    text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (tour_id, slug)
);
create index if not exists idx_players_slug on players(slug);

create table if not exists player_aliases (
  id        integer primary key autoincrement,
  player_id integer not null references players(id) on delete cascade,
  alias     text not null,
  slug      text not null,
  source    text not null,             -- 'tennis-data' | 'the-odds-api' | 'manual'
  unique (slug, player_id)
);
create index if not exists idx_aliases_slug on player_aliases(slug);

-- ── Torneos ──────────────────────────────────────────────────────────────────
create table if not exists tournaments (
  id       integer primary key autoincrement,
  tour_id  integer not null references tours(id),
  season   integer not null,
  name     text not null,
  location text,
  series   text,                       -- 'Grand Slam' | 'Masters 1000' | 'ATP250' | 'WTA1000' ...
  surface  text,                       -- 'hard' | 'clay' | 'grass' | 'carpet'
  court    text,                       -- 'indoor' | 'outdoor'
  unique (tour_id, season, name)
);
create index if not exists idx_tournaments_season on tournaments(season);

-- ── Partidos ─────────────────────────────────────────────────────────────────
create table if not exists matches (
  id            integer primary key autoincrement,
  tour_id       integer not null references tours(id),
  tournament_id integer not null references tournaments(id),
  season        integer not null,
  played_on     text not null,         -- fecha ISO 'YYYY-MM-DD'
  round         text,
  best_of       integer,               -- 3 | 5
  surface       text,                  -- desnormalizado del torneo: el Elo filtra por aquí
  court         text,

  -- Orden independiente del resultado (ver nota de cabecera).
  p1_id         integer not null references players(id),
  p2_id         integer not null references players(id),
  p1_won        integer,               -- 1 = ganó p1, 0 = ganó p2, null = sin resolver

  -- Legibles / auditoría. Null mientras el partido no se haya jugado.
  winner_id     integer references players(id),
  loser_id      integer references players(id),
  winner_rank   integer,
  loser_rank    integer,
  winner_points integer,
  loser_points  integer,
  w_sets        integer,
  l_sets        integer,
  sets_json     text,                  -- [[6,4],[7,5]] juegos ganador/perdedor por set

  -- 'completed' entra al modelo; 'retired' y 'walkover' se EXCLUYEN del
  -- entrenamiento (el resultado no refleja fuerza relativa) pero se conservan.
  status        text not null default 'completed',

  -- Idempotencia de la ingesta: clave estable derivada de la fila de origen.
  source        text not null default 'tennis-data',
  source_key    text not null unique,

  elo_applied   integer not null default 0,   -- 1 = ya consumido por train-elo
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index if not exists idx_matches_played_on   on matches(played_on);
create index if not exists idx_matches_p1          on matches(p1_id);
create index if not exists idx_matches_p2          on matches(p2_id);
create index if not exists idx_matches_surface     on matches(surface);
create index if not exists idx_matches_elo_pending on matches(elo_applied, played_on, id);
create index if not exists idx_matches_tournament  on matches(tournament_id);

-- ── Ratings Elo por superficie ───────────────────────────────────────────────
-- surface 'all' = rating global; el resto, uno por superficie. El modelo mezcla
-- global y de superficie según cuántos partidos tenga el jugador en ella
-- (ver packages/model/src/elo.ts).
create table if not exists player_ratings (
  player_id  integer not null references players(id) on delete cascade,
  surface    text not null,            -- 'all' | 'hard' | 'clay' | 'grass' | 'carpet'
  elo        real not null default 1500,
  matches    integer not null default 0,
  last_match text,                     -- fecha del último partido computado
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  primary key (player_id, surface)
);

-- Historial de ratings. LECCIÓN HEREDADA DE FÚTBOL: allí se ordenaba por un
-- timestamp que era constante dentro de la transacción, así que un reentreno
-- masivo dejaba todas las filas con el mismo `as_of` y "el último rating"
-- devolvía una fila arbitraria. Aquí el orden canónico es el `id`
-- autoincremental (monótono por inserción), nunca la fecha.
create table if not exists rating_history (
  id        integer primary key autoincrement,
  player_id integer not null references players(id) on delete cascade,
  surface   text not null,
  match_id  integer references matches(id) on delete cascade,
  elo_before real not null,
  elo_after  real not null,
  played_on  text not null
);
create index if not exists idx_rating_history_player on rating_history(player_id, surface, id);

-- ── Cuotas ───────────────────────────────────────────────────────────────────
-- Dos orígenes, misma tabla:
--   · 'tennis-data'  → cuotas de CIERRE históricas (Pinnacle, Bet365, media y
--     máximo del mercado). Permiten backtestear el paper trading.
--   · 'the-odds-api' → cuotas de partidos futuros (Fase 2).
-- Regla no negociable: aquí NUNCA se escribe una cuota derivada de la
-- probabilidad del propio modelo. Si no hay cuota real, no hay fila.
create table if not exists odds (
  id           integer primary key autoincrement,
  match_id     integer not null references matches(id) on delete cascade,
  source       text not null,
  bookmaker    text not null,          -- 'pinnacle' | 'bet365' | 'market_avg' | 'market_max' | 'consensus(N)'
  market       text not null default 'match_winner',
  selection    text not null,          -- 'p1' | 'p2' (mismo orden que matches)
  odds         real not null check (odds > 1),
  implied_prob real not null,
  is_closing   integer not null default 0,
  captured_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (match_id, bookmaker, market, selection, captured_at)
);
create index if not exists idx_odds_match on odds(match_id, market, selection);

-- ── Salidas del modelo ───────────────────────────────────────────────────────
create table if not exists model_outputs (
  id            integer primary key autoincrement,
  match_id      integer not null references matches(id) on delete cascade,
  model_version text not null,
  prob_p1       real not null,
  prob_p2       real not null,
  confidence    real,                  -- 0..1, penaliza poco historial
  explanation   text,                  -- JSON con los factores en palabras
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (match_id, model_version)
);

-- ── Configuración ────────────────────────────────────────────────────────────
create table if not exists app_config (
  k text primary key,
  v text not null
);
insert or ignore into app_config (k, v) values
  ('model_version', 'tennis-elo-surface-1.0.0');
