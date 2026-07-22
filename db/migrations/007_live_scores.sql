-- Marcadores en vivo desde The Odds API (/scores). Fase 3.5.
--
-- LÍMITE HONESTO: The Odds API solo da scores de torneos CUBIERTOS (Grand
-- Slams, Masters 1000, algunos 500) y solo mientras hay uno en curso. No hay
-- datos en vivo de Challenger ni de torneos 250. El marcador es GRUESO (sets
-- ganados por jugador), no punto a punto: es lo que expone el proveedor.
--
-- Un partido en vivo YA existe en `matches` como 'scheduled' (lo creó
-- odds-ingest desde el mismo event_id de The Odds API). Esta tabla solo añade
-- el estado en vivo, sin duplicar el partido. Se vacía y reescribe en cada
-- corrida de scores-ingest, así que nunca conserva un "en vivo" fantasma.

create table if not exists live_scores (
  match_id     integer primary key references matches(id) on delete cascade,
  event_id     text not null,
  -- 'live' mientras se juega, 'finished' cuando el proveedor lo marca completo.
  state        text not null check (state in ('live', 'finished')),
  -- Marcador orientado al MISMO orden p1/p2 de matches (no home/away de la API).
  score_p1     text,
  score_p2     text,
  updated_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index if not exists idx_live_scores_state on live_scores(state);
