-- Features de partido y ajustes del modelo. Fase 1.5.
--
-- El Elo por superficie solo, medido contra la cuota de cierre, se quedaba en
-- Brier 0,219 frente a 0,199 del mercado. Estas tablas soportan un modelo que
-- añade lo que el Elo no ve: ranking oficial, head-to-head, fatiga, descanso y
-- forma reciente.
--
-- Todas las features se calculan en el mismo paso cronológico que entrena el
-- Elo, usando SOLO información anterior a cada partido.

create table if not exists match_features (
  match_id          integer primary key references matches(id) on delete cascade,
  -- Diferencias orientadas a p1: positivo = favorece a p1.
  elo_diff_surface  real not null,
  elo_diff_overall  real not null,
  rank_log_diff     real not null,
  points_log_diff   real not null,
  h2h               real not null,
  h2h_surface       real not null,
  fatigue_diff      real not null,
  rest_diff         real not null,
  form_diff         real not null,
  exp_diff          real not null,
  created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Coeficientes ajustados, versionados. Se guarda también el reparto de
-- temporadas para poder auditar que la evaluación fue fuera de muestra.
create table if not exists model_fits (
  id             integer primary key autoincrement,
  model_version  text not null unique,
  feature_names  text not null,          -- JSON: orden canónico de las columnas
  weights        text not null,          -- JSON: pesos, sin término independiente
  l2             real not null,
  train_seasons  text not null,
  valid_seasons  text not null,
  test_seasons   text not null,
  n_train        integer not null,
  metrics        text,                   -- JSON con Brier/LogLoss de test y mercado
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
