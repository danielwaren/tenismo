-- Tennis Abstract: estadísticas de saque y resto por partido.
--
-- POR QUÉ ESTA FUENTE (ver docs/09-diseno-pick1.md §1.5): tennis-data.co.uk no
-- publica estadísticas y ESPN devuelve `statistics: []`. Sin aces, puntos al
-- saque, primeros dentro y break points no hay `p_a`/`p_b`, y sin ellos no hay
-- motor punto a punto (Markov) ni mercado de aces. tennisabstract.com sí los
-- publica, para ATP/WTA y también para Challenger desde ~2021.
--
-- QUÉ RUTA SE USA Y POR QUÉ: su robots.txt prohíbe /jsfrags/, /jsmatches/ y
-- /jsplayers/, pero NO /cgi-bin/. La ficha ATP `cgi-bin/player-classic.cgi`
-- trae los partidos incrustados en el HTML, así que es a la vez la ruta
-- conforme y la única que hace falta. La ficha WTA sí depende de /jsmatches/:
-- queda FUERA hasta tener permiso explícito del autor.
--
-- AUTORIDAD DE FUENTE — NO SE TOCA: `tennis-data` sigue siendo la única fuente
-- autorizada de RESULTADOS (train-elo filtra por `source='tennis-data'`).
-- Tennis Abstract aporta ESTADÍSTICAS sobre partidos que ya existen. Los
-- partidos que TA conoce y nosotros no (Challengers, previas) se guardan en
-- `ta_matches` sin crear filas en `matches`: promoverlos es una decisión
-- posterior y consciente, no un efecto colateral de la ingesta.

-- ── Identidad del jugador en Tennis Abstract ────────────────────────────────
-- TA no tiene índice público bajo /cgi-bin/, así que el rastreo es en bola de
-- nieve: cada ficha revela los nombres completos de todos sus rivales, y de ahí
-- salen las siguientes fichas a pedir. Esta tabla es la frontera de ese rastreo.
create table if not exists ta_players (
  player_id       integer primary key references players(id) on delete cascade,
  ta_name         text not null unique,   -- 'MattiaBellucci' (tal cual va en la URL)
  full_name       text not null,          -- 'Mattia Bellucci' (lo que declara la ficha)
  ta_id           text,                   -- id interno de TA, visto desde la ficha del rival
  last_fetched_at text,
  last_match_date text,                   -- fecha del partido más reciente visto
  matches_seen    integer not null default 0,
  -- 'ok'        la ficha respondió y el nombre declarado coincide con el pedido
  -- 'mismatch'  la ficha devolvió OTRO jugador (ver aviso de abajo)
  -- 'error'     fallo de red o de formato tras agotar reintentos
  status          text not null default 'ok',
  note            text
);
create index if not exists idx_ta_players_pendientes on ta_players(status, last_fetched_at);

-- Nombres completos vistos como rival pero todavía sin ficha propia pedida.
-- Es la cola del rastreo; se vacía a medida que se piden las fichas.
create table if not exists ta_frontier (
  ta_name    text primary key,
  full_name  text not null,
  ta_id      text,
  seen_from  text,                        -- ta_name de la ficha donde apareció
  depth      integer not null default 0,
  fetched    integer not null default 0,
  seen_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index if not exists idx_ta_frontier_cola on ta_frontier(fetched, depth);

-- ── Partidos vistos en Tennis Abstract (staging) ────────────────────────────
-- Cada partido se ve DOS veces, una por la ficha de cada jugador. `ta_key` es
-- simétrica (lados ordenados por slug) para que las dos visitas caigan en la
-- misma fila. La segunda visita no duplica: confirma. Si los números no
-- coinciden se marca `conflict` y la fila NO pasa a `match_stats`.
create table if not exists ta_matches (
  ta_key        text primary key,         -- fecha|tour|slugA|slugB|ronda
  tour_code     text not null,            -- 'ATP' (WTA pendiente de permiso)
  event_date    text not null,            -- OJO: es la fecha de INICIO DEL TORNEO
  event         text not null,
  level         text,                     -- G|M|A|C|D|S|15|25 (ver ta.ts)
  surface       text,
  round         text,                     -- vocabulario de TA: F, SF, QF, R16, Q1…
  best_of       integer,
  score         text,                     -- del ganador: '6-3 5-7 6-4'
  minutes       integer,

  -- Lado A = slug menor; lado B = slug mayor. Orden independiente del resultado,
  -- igual que p1/p2 en `matches` (ver 001_schema.sql).
  a_slug        text not null,
  a_name        text not null,
  a_player_id   integer references players(id),
  a_rank        integer,
  b_slug        text not null,
  b_name        text not null,
  b_player_id   integer references players(id),
  b_rank        integer,
  winner_slug   text not null,

  -- Los 9 campos de la fuente, por lado. null = el partido no trae estadísticas
  -- (ITF Futures y Challengers anteriores a ~2021).
  a_ace integer, a_df integer, a_svpt integer, a_first_in integer,
  a_first_won integer, a_second_won integer, a_sv_gms integer,
  a_bp_saved integer, a_bp_faced integer,
  b_ace integer, b_df integer, b_svpt integer, b_first_in integer,
  b_first_won integer, b_second_won integer, b_sv_gms integer,
  b_bp_saved integer, b_bp_faced integer,

  mcp_chart_id  text,                     -- enlace al Match Charting Project
  ta_event_id   text,

  sides_seen    integer not null default 1,  -- 1 = una ficha, 2 = confirmado por ambas
  conflict      integer not null default 0,  -- las dos fichas discrepan en los números
  match_id      integer references matches(id) on delete set null,
  link_status   text not null default 'pending',
  -- pending | linked | no_candidate | ambiguous | no_stats | conflict
  first_seen_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index if not exists idx_ta_matches_link on ta_matches(link_status, event_date);
create index if not exists idx_ta_matches_match on ta_matches(match_id);

-- ── Estadísticas ya enlazadas a un partido nuestro ──────────────────────────
create table if not exists match_stats (
  match_id      integer not null references matches(id) on delete cascade,
  player_id     integer not null references players(id),
  serve_points  integer,                  -- svpt
  first_in      integer,
  first_won     integer,
  second_won    integer,
  serve_games   integer,
  aces          integer,
  double_faults integer,
  bp_saved      integer,
  bp_faced      integer,
  source        text not null default 'tennis-abstract',
  ta_key        text references ta_matches(ta_key) on delete set null,
  ingested_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  primary key (match_id, player_id)
);
create index if not exists idx_match_stats_player on match_stats(player_id);
