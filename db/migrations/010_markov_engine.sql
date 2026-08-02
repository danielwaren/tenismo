-- Motor punto a punto: nueva feature `markov_logit` y el estado que necesita
-- para calcularse walk-forward (ver packages/model/src/markov.ts y
-- docs/09-diseno-pick1.md §2.1-2.5).
--
-- POR QUÉ HACE FALTA UNA TABLA APARTE PARA LOS PERFILES DE SAQUE. `train-elo.ts`
-- mantiene en memoria el estado de cada jugador (Elo, historial reciente,
-- head-to-head) mientras recorre los partidos en orden cronológico, y solo
-- PERSISTE lo necesario para retomar en la siguiente ejecución incremental —
-- exactamente igual que `player_ratings` para el Elo. Sin una tabla propia,
-- cada ejecución sin `--reset` reconstruiría el perfil de saque desde cero y
-- `markovLogit` saldría neutral (0) casi siempre en producción, aunque
-- funcionara perfecto en un backtest completo. Mismo patrón, misma razón.

alter table match_features add column markov_logit real not null default 0;
-- Los partidos con features ya calculadas ANTES de esta migración tienen 0 en
-- esta columna, que no es su valor real. No pasa nada: añadir una feature
-- nueva ya obliga a reajustar el modelo (predict.ts compara FEATURE_NAMES
-- contra el ajuste guardado y para en seco si no coinciden), y reajustar
-- exige antes `npm run db:elo -- --reset`, que recalcula match_features entero.

-- Perfil de saque y resto acumulado de cada jugador, walk-forward.
create table if not exists player_serve_stats (
  player_id     integer primary key references players(id) on delete cascade,
  serve_won     integer not null default 0,
  serve_points  integer not null default 0,
  return_won    integer not null default 0,
  return_points integer not null default 0,
  updated_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Media del circuito (fila única), para el encogimiento bayesiano de
-- estimateServeProb. Separada de player_serve_stats porque se lee en CADA
-- partido (para los dos jugadores), no solo cuando ese jugador tiene una fila.
create table if not exists tour_serve_stats (
  id           integer primary key check (id = 1),
  serve_won    integer not null default 0,
  serve_points integer not null default 0
);
insert or ignore into tour_serve_stats (id, serve_won, serve_points) values (1, 0, 0);
