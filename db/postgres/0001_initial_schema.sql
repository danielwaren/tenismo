-- Tennis Trader Intelligence — esquema completo, traducido de SQLite/Turso
-- (db/migrations/001..014) a Postgres/Supabase.
--
-- POR QUÉ ESTA MIGRACIÓN DE MOTOR: Turso bloqueó la cuenta por cuota de
-- lecturas dos veces en dos días (500M filas/mes, límite duro que corta el
-- acceso de golpe). Supabase free no tiene ese tipo de tope — es API
-- requests ilimitadas, con el límite real en storage (500 MB) y pausa tras 7
-- días sin actividad (no aplica aquí: los cron de GitHub Actions pegan cada
-- 15 min).
--
-- QUÉ CAMBIA Y QUÉ NO respecto al esquema SQLite original:
--   · Las fechas SIGUEN siendo TEXT ISO-8601 (UTC), no timestamptz. Cambiar
--     el tipo habría obligado a reescribir cada julianday()/date()/strftime()
--     del proyecto (docenas de sitios) para nada estructural — el ahorro no
--     compensa el riesgo. `iso_now()` (abajo) reproduce el mismo formato que
--     daba `strftime('%Y-%m-%dT%H:%M:%fZ','now')`.
--   · JSON sigue en columnas TEXT (sets_json, explanation, weights...), no
--     jsonb: el código ya hace JSON.parse/JSON.stringify en cada sitio: pasar
--     a jsonb cambiaría qué devuelve el driver y forzaría a tocar esos
--     mismos sitios sin necesidad.
--   · Booleanos siguen en INTEGER 0/1 con CHECK, no BOOLEAN nativo: el código
--     ya compara `Number(x) === 1` en todas partes.
--   · `insert or ignore` → `insert ... on conflict do nothing`.
--     `insert or replace` / `on conflict(...) do update set col=excluded.col`
--     es SINTAXIS IDÉNTICA en los dos motores (SQLite copió el upsert de
--     Postgres) — no cambia.
--   · `integer primary key autoincrement` → `bigint generated always as
--     identity primary key`.
--
-- NO hay RLS: el control de acceso sigue viviendo en las API routes de
-- Astro, igual que con Turso — la clave de servicio de Supabase no sale del
-- servidor. Ver src/lib/db.ts.

create or replace function iso_now() returns text as $$
  select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$ language sql stable;

-- ── Circuitos ────────────────────────────────────────────────────────────────
create table if not exists tours (
  id   integer primary key,
  code text not null unique,
  name text not null
);
insert into tours (id, code, name) values (1, 'ATP', 'ATP Tour'), (2, 'WTA', 'WTA Tour')
  on conflict do nothing;

-- ── Jugadores ────────────────────────────────────────────────────────────────
create table if not exists players (
  id         bigint generated always as identity primary key,
  tour_id    integer not null references tours(id),
  name       text not null,
  slug       text not null,
  country    text,
  created_at text not null default iso_now(),
  unique (tour_id, slug)
);
create index if not exists idx_players_slug on players(slug);

create table if not exists player_aliases (
  id        bigint generated always as identity primary key,
  player_id bigint not null references players(id) on delete cascade,
  alias     text not null,
  slug      text not null,
  source    text not null,
  unique (slug, player_id)
);
create index if not exists idx_aliases_slug on player_aliases(slug);

-- ── Torneos ──────────────────────────────────────────────────────────────────
create table if not exists tournaments (
  id       bigint generated always as identity primary key,
  tour_id  integer not null references tours(id),
  season   integer not null,
  name     text not null,
  location text,
  series   text,
  surface  text,
  court    text,
  unique (tour_id, season, name)
);
create index if not exists idx_tournaments_season on tournaments(season);

-- ── Partidos ─────────────────────────────────────────────────────────────────
create table if not exists matches (
  id            bigint generated always as identity primary key,
  tour_id       integer not null references tours(id),
  tournament_id bigint not null references tournaments(id),
  season        integer not null,
  played_on     text not null,
  round         text,
  best_of       integer,
  surface       text,
  court         text,

  p1_id         bigint not null references players(id),
  p2_id         bigint not null references players(id),
  p1_won        integer,

  winner_id     bigint references players(id),
  loser_id      bigint references players(id),
  winner_rank   integer,
  loser_rank    integer,
  winner_points integer,
  loser_points  integer,
  w_sets        integer,
  l_sets        integer,
  sets_json     text,

  status        text not null default 'completed',

  source        text not null default 'tennis-data',
  source_key    text not null unique,

  elo_applied   integer not null default 0,
  created_at    text not null default iso_now()
);
create index if not exists idx_matches_played_on   on matches(played_on);
create index if not exists idx_matches_p1          on matches(p1_id);
create index if not exists idx_matches_p2          on matches(p2_id);
create index if not exists idx_matches_surface     on matches(surface);
create index if not exists idx_matches_elo_pending on matches(elo_applied, played_on, id);
create index if not exists idx_matches_tournament  on matches(tournament_id);
create index if not exists idx_matches_scheduled   on matches(status, played_on);

-- ── Ratings Elo por superficie ───────────────────────────────────────────────
create table if not exists player_ratings (
  player_id  bigint not null references players(id) on delete cascade,
  surface    text not null,
  elo        double precision not null default 1500,
  matches    integer not null default 0,
  last_match text,
  updated_at text not null default iso_now(),
  primary key (player_id, surface)
);

create table if not exists rating_history (
  id         bigint generated always as identity primary key,
  player_id  bigint not null references players(id) on delete cascade,
  surface    text not null,
  match_id   bigint references matches(id) on delete cascade,
  elo_before double precision not null,
  elo_after  double precision not null,
  played_on  text not null
);
create index if not exists idx_rating_history_player on rating_history(player_id, surface, id);
create index if not exists idx_rating_history_match on rating_history(match_id);

-- ── Cuotas ───────────────────────────────────────────────────────────────────
create table if not exists odds (
  id           bigint generated always as identity primary key,
  match_id     bigint not null references matches(id) on delete cascade,
  source       text not null,
  bookmaker    text not null,
  market       text not null default 'match_winner',
  selection    text not null,
  odds         double precision not null check (odds > 1),
  implied_prob double precision not null,
  is_closing   integer not null default 0,
  -- línea del mercado (total/hándicap); NULL en match_winner.
  line         double precision,
  captured_at  text not null default iso_now(),
  unique (match_id, bookmaker, market, selection, captured_at)
);
create index if not exists idx_odds_match on odds(match_id, market, selection);
create unique index if not exists idx_odds_cierre_unica
  on odds (match_id, bookmaker, market, selection)
  where source = 'tennis-data';

-- ── Salidas del modelo ───────────────────────────────────────────────────────
create table if not exists model_outputs (
  id            bigint generated always as identity primary key,
  match_id      bigint not null references matches(id) on delete cascade,
  model_version text not null,
  prob_p1       double precision not null,
  prob_p2       double precision not null,
  confidence    double precision,
  explanation   text,
  created_at    text not null default iso_now(),
  unique (match_id, model_version)
);

-- ── Configuración ────────────────────────────────────────────────────────────
create table if not exists app_config (
  k text primary key,
  v text not null
);
insert into app_config (k, v) values ('model_version', 'tennis-elo-surface-1.0.0')
  on conflict do nothing;

-- ── Features y ajustes del modelo (forma v2 + markov_logit) ─────────────────
create table if not exists match_features (
  match_id           bigint primary key references matches(id) on delete cascade,
  elo_diff_surface   double precision not null,
  elo_diff_overall   double precision not null,
  rank_log_diff      double precision not null,
  points_log_diff    double precision not null,
  h2h                double precision not null,
  h2h_surface        double precision not null,
  load_diff          double precision not null,
  intensity_diff     double precision not null,
  rest_diff          double precision not null,
  form_diff          double precision not null,
  exp_diff           double precision not null,
  surface_exp_diff   double precision not null,
  best_of5_elo_diff  double precision not null,
  markov_logit       double precision not null default 0,
  created_at         text not null default iso_now()
);

create table if not exists model_fits (
  id             bigint generated always as identity primary key,
  model_version  text not null unique,
  feature_names  text not null,
  weights        text not null,
  l2             double precision not null,
  train_seasons  text not null,
  valid_seasons  text not null,
  test_seasons   text not null,
  n_train        integer not null,
  metrics        text,
  created_at     text not null default iso_now()
);

-- ── Eventos sin resolver (The Odds API) ──────────────────────────────────────
create table if not exists unmatched_events (
  id          bigint generated always as identity primary key,
  source      text not null default 'the-odds-api',
  event_id    text not null,
  sport_key   text not null,
  home_team   text not null,
  away_team   text not null,
  commence_at text,
  reason      text not null,
  seen_at     text not null default iso_now(),
  resolved    integer not null default 0,
  unique (source, event_id)
);
create index if not exists idx_unmatched_pendientes on unmatched_events(resolved, seen_at);

-- ── Marcadores en vivo ────────────────────────────────────────────────────────
create table if not exists live_scores (
  match_id     bigint primary key references matches(id) on delete cascade,
  event_id     text not null,
  state        text not null check (state in ('live', 'finished')),
  score_p1     text,
  score_p2     text,
  updated_at   text not null default iso_now()
);
create index if not exists idx_live_scores_state on live_scores(state);

-- ── Tennis Abstract ──────────────────────────────────────────────────────────
create table if not exists ta_players (
  player_id       bigint primary key references players(id) on delete cascade,
  ta_name         text not null unique,
  full_name       text not null,
  ta_id           text,
  last_fetched_at text,
  last_match_date text,
  matches_seen    integer not null default 0,
  status          text not null default 'ok',
  note            text
);
create index if not exists idx_ta_players_pendientes on ta_players(status, last_fetched_at);

create table if not exists ta_frontier (
  ta_name    text primary key,
  full_name  text not null,
  ta_id      text,
  seen_from  text,
  depth      integer not null default 0,
  fetched    integer not null default 0,
  seen_at    text not null default iso_now()
);
create index if not exists idx_ta_frontier_cola on ta_frontier(fetched, depth);

create table if not exists ta_matches (
  ta_key        text primary key,
  tour_code     text not null,
  event_date    text not null,
  event         text not null,
  level         text,
  surface       text,
  round         text,
  best_of       integer,
  score         text,
  minutes       integer,

  a_slug        text not null,
  a_name        text not null,
  a_player_id   bigint references players(id),
  a_rank        integer,
  b_slug        text not null,
  b_name        text not null,
  b_player_id   bigint references players(id),
  b_rank        integer,
  winner_slug   text not null,

  a_ace integer, a_df integer, a_svpt integer, a_first_in integer,
  a_first_won integer, a_second_won integer, a_sv_gms integer,
  a_bp_saved integer, a_bp_faced integer,
  b_ace integer, b_df integer, b_svpt integer, b_first_in integer,
  b_first_won integer, b_second_won integer, b_sv_gms integer,
  b_bp_saved integer, b_bp_faced integer,

  mcp_chart_id  text,
  ta_event_id   text,

  sides_seen    integer not null default 1,
  conflict      integer not null default 0,
  match_id      bigint references matches(id) on delete set null,
  link_status   text not null default 'pending',
  first_seen_at text not null default iso_now(),
  updated_at    text not null default iso_now()
);
create index if not exists idx_ta_matches_link on ta_matches(link_status, event_date);
create index if not exists idx_ta_matches_match on ta_matches(match_id);
create index if not exists idx_ta_matches_a_player on ta_matches(a_player_id);
create index if not exists idx_ta_matches_b_player on ta_matches(b_player_id);

create table if not exists match_stats (
  match_id      bigint not null references matches(id) on delete cascade,
  player_id     bigint not null references players(id),
  serve_points  integer,
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
  ingested_at   text not null default iso_now(),
  primary key (match_id, player_id)
);
create index if not exists idx_match_stats_player on match_stats(player_id);

-- ── Motor punto a punto: perfil de saque walk-forward ────────────────────────
create table if not exists player_serve_stats (
  player_id     bigint primary key references players(id) on delete cascade,
  serve_won     integer not null default 0,
  serve_points  integer not null default 0,
  return_won    integer not null default 0,
  return_points integer not null default 0,
  updated_at    text not null default iso_now()
);

create table if not exists tour_serve_stats (
  id           integer primary key check (id = 1),
  serve_won    integer not null default 0,
  serve_points integer not null default 0
);
insert into tour_serve_stats (id, serve_won, serve_points) values (1, 0, 0)
  on conflict do nothing;

-- ── Paper Trading (simulado, modelo contra el mercado) ───────────────────────
create table if not exists paper_trading_config (
  id               integer primary key check (id = 1),
  initial_bankroll double precision not null default 100,
  kelly_divisor    double precision not null default 4    check (kelly_divisor >= 1),
  max_stake_pct    double precision not null default 0.02 check (max_stake_pct > 0 and max_stake_pct <= 0.05),
  min_edge         double precision not null default 0.02,
  min_confidence   double precision not null default 0.5,
  value_enabled    integer not null default 0,
  updated_at       text not null default iso_now()
);
insert into paper_trading_config (id) values (1) on conflict do nothing;

create table if not exists paper_trades (
  id              bigint generated always as identity primary key,
  match_id        bigint not null references matches(id) on delete cascade,
  market          text    not null default 'ML' check (market in ('ML', 'TOTAL_GAMES', 'GAMES_HCP')),
  selection       text    not null check (selection in ('p1', 'p2', 'over', 'under')),
  line            double precision,
  bookmaker       text    not null,
  odds_taken      double precision not null check (odds_taken > 1),
  implied_prob    double precision not null,
  model_prob      double precision not null,
  edge            double precision not null,
  confidence      double precision,
  stake           double precision not null check (stake > 0),
  bankroll_before double precision not null,
  model_version   text    not null,
  placed_at       text    not null default iso_now(),
  status          text    not null default 'open' check (status in ('open','won','lost','void')),
  profit          double precision,
  closing_odds    double precision,
  clv             double precision,
  settled_at      text,
  unique (match_id, market)
);
create index if not exists idx_paper_trades_status on paper_trades(status);

-- ── Mis apuestas (registro manual, caja propia) ──────────────────────────────
create table if not exists bankrolls (
  id              bigint generated always as identity primary key,
  name            text not null,
  currency        text not null default 'USD',
  initial_balance double precision not null default 0 check (initial_balance >= 0),
  created_at      text not null default iso_now(),
  updated_at      text not null default iso_now()
);

create table if not exists bets (
  id                     bigint generated always as identity primary key,
  bankroll_id            bigint not null references bankrolls(id) on delete cascade,

  tournament             text    not null,
  tour                   text    not null default 'ATP' check (tour in ('ATP', 'WTA', 'Challenger', 'ITF', 'Other')),
  surface                text,
  player_one             text    not null,
  player_two             text    not null,
  event_name             text,

  market                 text    not null,
  selection              text    not null,
  line                   double precision,
  scope                  text    not null default 'match',

  odds_decimal           double precision not null check (odds_decimal > 1),
  stake                  double precision not null check (stake > 0),

  status                 text    not null default 'OPEN'
                          check (status in ('OPEN', 'WON', 'LOST', 'VOID', 'CASHOUT')),
  placed_at              text    not null default iso_now(),
  settled_at             text,
  payout                 double precision,
  profit                 double precision,
  cashout_amount         double precision,

  bookmaker              text,
  is_live                integer not null default 0 check (is_live in (0, 1)),
  live_score_at_entry    text,
  server_at_entry        text,

  model_probability      double precision,
  model_fair_odds        double precision,
  ai_probability         double precision,
  ai_fair_odds           double precision,

  implied_probability    double precision not null,
  edge                   double precision,
  expected_value         double precision,

  notes                  text,
  created_at             text not null default iso_now(),
  updated_at             text not null default iso_now()
);
create index if not exists idx_bets_bankroll_status on bets(bankroll_id, status);
create index if not exists idx_bets_placed_at on bets(placed_at);

create table if not exists bankroll_transactions (
  id           bigint generated always as identity primary key,
  bankroll_id  bigint not null references bankrolls(id) on delete cascade,
  bet_id       bigint references bets(id) on delete set null,
  type         text    not null check (type in (
                  'INITIAL_BALANCE', 'DEPOSIT', 'WITHDRAWAL', 'STAKE',
                  'WIN_RETURN', 'VOID_RETURN', 'CASHOUT_RETURN', 'ADJUSTMENT'
                )),
  amount       double precision not null,
  description  text,
  created_at   text not null default iso_now()
);
create index if not exists idx_bankroll_tx_bankroll on bankroll_transactions(bankroll_id, created_at);
create index if not exists idx_bankroll_tx_bet on bankroll_transactions(bet_id);
