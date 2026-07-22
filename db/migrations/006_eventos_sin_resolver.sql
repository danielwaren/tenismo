-- Eventos de The Odds API cuyos jugadores no se pudieron resolver.
--
-- No se descartan en silencio ni se emparejan "a lo que más se parezca": un
-- emparejamiento equivocado mete la cuota de un partido en otro y contamina el
-- modelo sin dejar rastro. Quedan aquí para crear el alias a mano.

create table if not exists unmatched_events (
  id          integer primary key autoincrement,
  source      text not null default 'the-odds-api',
  event_id    text not null,
  sport_key   text not null,
  home_team   text not null,
  away_team   text not null,
  commence_at text,
  reason      text not null,
  seen_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved    integer not null default 0,
  unique (source, event_id)
);
create index if not exists idx_unmatched_pendientes on unmatched_events(resolved, seen_at);
