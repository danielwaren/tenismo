-- Bug de datos (encontrado ago 2026, ver scripts/lib/ta.ts normalizeSurface):
-- Tennis Abstract publica la superficie en Title Case ("Hard", "Clay",
-- "Grass", "Carpet"); el resto de fuentes (tennis-data, ESPN, The Odds API)
-- usan minúscula. Sin normalizar, un jugador con historial de Challenger o
-- pre-2013 (fuente tennis-abstract) tenía su Elo de superficie partido en DOS
-- filas nunca mezcladas ("Clay" y "clay" son valores distintos para un
-- `group by`/`Map`) — cada una viendo solo la mitad de su historial real.
-- 33.556 partidos afectados (16.829 Clay + 15.397 Hard + 818 Grass + 512
-- Carpet). El código ya no vuelve a escribir así (ta.ts normaliza al
-- ingerir); esto arregla los datos YA escritos.
update matches set surface = lower(surface)
  where surface in ('Hard', 'Clay', 'Grass', 'Carpet');

update tournaments set surface = lower(surface)
  where surface in ('Hard', 'Clay', 'Grass', 'Carpet');

update ta_matches set surface = lower(surface)
  where surface in ('Hard', 'Clay', 'Grass', 'Carpet');

-- `player_ratings`/`rating_history`/`match_features` heredan el desorden a
-- través del Elo walk-forward ya calculado con la superficie mal escrita —
-- normalizar la columna no arregla retroactivamente un rating que se calculó
-- viendo solo la mitad del historial. Un `npm run db:elo -- --reset` después
-- de esta migración recalcula todo desde cero con datos ya consistentes (y de
-- paso aplica la fusión Challenger/TA de `train-elo.ts`, validada en
-- scripts/backtest-elo-ta.ts pero nunca aplicada en producción: --reset es la
-- única vía que la activa). Se corre aparte, no dentro de esta migración —
-- una migración de `npm run db:migrate` no es el lugar para una recomputación
-- de larga duración sobre ~80.000 partidos.
