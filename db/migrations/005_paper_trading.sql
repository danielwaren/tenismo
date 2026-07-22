-- Paper Trading: apuestas SIMULADAS con dinero ficticio y cuotas REALES. Fase 2.
--
-- Reglas no negociables (heredadas del proyecto de fútbol):
--   · Solo se simula una apuesta si existe una cuota REAL registrada. Jamás se
--     deriva una cuota de la probabilidad del propio modelo: eso sería validar
--     al modelo contra sí mismo.
--   · Nada aquí ejecuta apuestas, ni habla con casas, ni mueve dinero real.
--   · Se excluyen los partidos cold start por confianza del pronóstico.
--
-- MODO AUDITORÍA (`value_enabled = 0`, que es el valor por defecto):
--   El modelo todavía NO le gana a la línea de cierre (Brier 0,2159 frente a
--   0,2027 del mercado). Por tanto sus "ventajas" no son value demostrado y el
--   simulador NO debe leerse como una estrategia: se usa para medir CLV, que es
--   la única señal que distingue ventaja real de suerte en plazos razonables.
--   Encender `value_enabled` es una decisión que exige antes evidencia de CLV
--   positivo sostenido.

create table if not exists paper_trading_config (
  id               integer primary key check (id = 1),
  initial_bankroll real    not null default 100,
  kelly_divisor    real    not null default 4    check (kelly_divisor >= 1),
  max_stake_pct    real    not null default 0.02 check (max_stake_pct > 0 and max_stake_pct <= 0.05),
  min_edge         real    not null default 0.02,
  min_confidence   real    not null default 0.5,
  -- 0 = auditoría (medir CLV). 1 = se afirma que hay value. Ver cabecera.
  value_enabled    integer not null default 0,
  updated_at       text    not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
insert or ignore into paper_trading_config (id) values (1);

create table if not exists paper_trades (
  id              integer primary key autoincrement,
  match_id        integer not null references matches(id) on delete cascade,
  -- Mercado binario: se apuesta a uno de los dos jugadores, nunca a los dos.
  selection       text    not null check (selection in ('p1', 'p2')),
  bookmaker       text    not null,
  odds_taken      real    not null check (odds_taken > 1),
  -- Implícita DEVIGADA: comparar contra la cruda inflaría la ventaja con el
  -- margen de la casa y haría parecer value lo que solo es overround.
  implied_prob    real    not null,
  model_prob      real    not null,
  edge            real    not null,
  confidence      real,
  stake           real    not null check (stake > 0),
  bankroll_before real    not null,
  model_version   text    not null,
  placed_at       text    not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  status          text    not null default 'open' check (status in ('open','won','lost','void')),
  profit          real,
  closing_odds    real,
  clv             real,
  settled_at      text,
  -- Una sola apuesta por partido: en un mercado de dos vías, cubrir ambos lados
  -- no tiene sentido y falsearía la contabilidad de la banca.
  unique (match_id)
);
create index if not exists idx_paper_trades_status on paper_trades(status);

-- Los partidos FUTUROS no vienen de tennis-data (que solo publica lo jugado)
-- sino de The Odds API, con status 'scheduled'. Este índice sirve al listado
-- del dashboard y al proceso que coloca apuestas.
create index if not exists idx_matches_scheduled on matches(status, played_on);
