-- "Mis apuestas": registro manual de las apuestas REALES que jugamos (dinero
-- de verdad, fuera de esta app) — distinto del Paper Trading, que simula con
-- dinero ficticio lo que el MODELO habría apostado. Aquí el usuario es quien
-- decide y registra; la app solo lleva la contabilidad y compara contra el
-- modelo y un análisis de IA.
--
-- No hay tabla de usuarios en este proyecto (herramienta de un solo operador,
-- sin RLS — ver src/lib/db.ts): no se añade user_id. Si el proyecto gana
-- autenticación multiusuario más adelante, se añade entonces.
--
-- REGLA CONTABLE: la banca NUNCA es un saldo editable a mano. Se calcula
-- sumando `bankroll_transactions`. Cada apuesta que se coloca escribe una
-- transacción STAKE negativa; cada liquidación escribe la transacción de
-- retorno que corresponda. Esto hace la caja auditable partido a partido y
-- evita que "cuánto tengo" dependa de la memoria de una conversación o de
-- lo que muestre la casa de apuestas.

create table if not exists bankrolls (
  id              integer primary key autoincrement,
  name            text    not null,
  currency        text    not null default 'USD',
  initial_balance real    not null default 0 check (initial_balance >= 0),
  created_at      text    not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      text    not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table if not exists bets (
  id                     integer primary key autoincrement,
  bankroll_id            integer not null references bankrolls(id) on delete cascade,

  tournament             text    not null,
  tour                   text    not null default 'ATP' check (tour in ('ATP', 'WTA', 'Challenger', 'ITF', 'Other')),
  surface                text,
  player_one             text    not null,
  player_two             text    not null,
  event_name             text,

  market                 text    not null,
  selection              text    not null,
  line                   real,
  -- 'match' | 'set1' | 'set2' | 'set3' | 'set4' | 'set5' | 'other'
  scope                  text    not null default 'match',

  odds_decimal           real    not null check (odds_decimal > 1),
  stake                  real    not null check (stake > 0),

  status                 text    not null default 'OPEN'
                          check (status in ('OPEN', 'WON', 'LOST', 'VOID', 'CASHOUT')),
  placed_at              text    not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  settled_at             text,
  payout                 real,
  profit                 real,
  cashout_amount         real,

  bookmaker              text,
  is_live                integer not null default 0 check (is_live in (0, 1)),
  live_score_at_entry    text,
  -- Nunca se asume quién saca: si no se registra explícitamente, no se
  -- interpreta el marcador (ver docs/11-mis-apuestas.md).
  server_at_entry        text,

  -- "Mi pronóstico" — modelo propio de Tenismo. NULL si el mercado no es
  -- ganador de partido (el único que el Elo actual sabe predecir) o si no se
  -- pudieron identificar los dos jugadores en la base.
  model_probability      real,
  model_fair_odds        real,
  -- "Análisis IA" — solo se rellena si hay proveedor configurado.
  ai_probability         real,
  ai_fair_odds           real,

  implied_probability    real    not null,
  edge                   real,
  expected_value         real,

  notes                  text,
  created_at             text    not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at             text    not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index if not exists idx_bets_bankroll_status on bets(bankroll_id, status);
create index if not exists idx_bets_placed_at on bets(placed_at);

create table if not exists bankroll_transactions (
  id           integer primary key autoincrement,
  bankroll_id  integer not null references bankrolls(id) on delete cascade,
  bet_id       integer references bets(id) on delete set null,
  type         text    not null check (type in (
                  'INITIAL_BALANCE', 'DEPOSIT', 'WITHDRAWAL', 'STAKE',
                  'WIN_RETURN', 'VOID_RETURN', 'CASHOUT_RETURN', 'ADJUSTMENT'
                )),
  amount       real    not null,
  description  text,
  created_at   text    not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index if not exists idx_bankroll_tx_bankroll on bankroll_transactions(bankroll_id, created_at);
create index if not exists idx_bankroll_tx_bet on bankroll_transactions(bet_id);
