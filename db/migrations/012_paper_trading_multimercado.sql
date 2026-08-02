-- Paper Trading multi-mercado: Ganador (ya existía) + Total de Juegos +
-- Hándicap de Juegos. Verificado contra The Odds API real (2026-08-02): esos
-- tres tienen cuota real para tenis. Set y Aces NO — se pidieron expresamente
-- y la API los rechazó ("Invalid markets"), así que se quedan como proyección
-- informativa sin apuesta simulada: la regla del proyecto es que la cuota
-- SIEMPRE viene de una casa real, nunca de la probabilidad del propio modelo.

-- `line` solo tiene valor para mercados con margen (total_games, games_hcp);
-- en match_winner se queda NULL. No rompe el unique existente (match_id,
-- bookmaker, market, selection, captured_at): dos líneas del mismo mercado
-- para el mismo book solo colisionarían si además compartieran captured_at
-- exacto, y cada corrida del ingester usa una marca de tiempo propia.
alter table odds add column line real;

-- `paper_trades` se recrea entera: no hay filas que preservar ("Sin apuestas
-- registradas todavía" en ambas bases a fecha de esta migración) y el cambio
-- de forma (selection amplía a over/under, se añade market/line, y una sola
-- apuesta por partido pasa a ser una por partido-Y-mercado) no es expresable
-- con ALTER TABLE sobre un CHECK existente.
drop table if exists paper_trades;

create table paper_trades (
  id              integer primary key autoincrement,
  match_id        integer not null references matches(id) on delete cascade,
  -- 'ML' ganador · 'TOTAL_GAMES' total de juegos · 'GAMES_HCP' hándicap de juegos.
  market          text    not null default 'ML' check (market in ('ML', 'TOTAL_GAMES', 'GAMES_HCP')),
  -- p1/p2 para ML y GAMES_HCP (a quién se apuesta el hándicap); over/under para TOTAL_GAMES.
  selection       text    not null check (selection in ('p1', 'p2', 'over', 'under')),
  -- Línea del mercado. NULL en ML (no tiene margen). En GAMES_HCP va orientada
  -- a p1 (positivo = p1 recibe juegos), igual que `scripts/lib/odds-api.ts`
  -- orienta `spreadsFromEvent` al lado home antes de traducirlo a p1/p2.
  line            real,
  bookmaker       text    not null,
  odds_taken      real    not null check (odds_taken > 1),
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
  -- Una apuesta por partido Y POR MERCADO: se puede tener a la vez una en
  -- Ganador y otra en Total de Juegos del mismo partido, pero no dos en Ganador.
  unique (match_id, market)
);
create index if not exists idx_paper_trades_status on paper_trades(status);
