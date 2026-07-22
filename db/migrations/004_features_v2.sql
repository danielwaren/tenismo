-- Features v2. La tabla se reconstruye entera en cada `db:elo --reset`, así que
-- se recrea en vez de migrar columna a columna.
--
-- Cambios respecto a v1, todos motivados por lo que se midió al ajustar:
--
--  · `fatigue_diff` se PARTE en `load_diff` e `intensity_diff`. La versión
--    original (juegos totales en 14 días) se ajustó con peso negativo: "llegar
--    más fresco empeora el pronóstico". No era un error de signo sino un
--    confundido — quien más ha jugado es quien va ganando y avanzando en el
--    cuadro. Separando "cuántos partidos" de "cuánto costaron", el modelo puede
--    distinguir el avance en el torneo del desgaste real.
--
--  · `surface_exp_diff`: experiencia en ESA superficie, distinta de la global.
--
--  · `best_of5_elo_diff`: interacción entre la ventaja Elo y el formato al
--    mejor de 5. Un partido más largo deja menos margen a la sorpresa.

drop table if exists match_features;

create table match_features (
  match_id           integer primary key references matches(id) on delete cascade,
  -- Diferencias orientadas a p1: positivo = favorece a p1.
  elo_diff_surface   real not null,
  elo_diff_overall   real not null,
  rank_log_diff      real not null,
  points_log_diff    real not null,
  h2h                real not null,
  h2h_surface        real not null,
  load_diff          real not null,
  intensity_diff     real not null,
  rest_diff          real not null,
  form_diff          real not null,
  exp_diff           real not null,
  surface_exp_diff   real not null,
  best_of5_elo_diff  real not null,
  created_at         text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
