-- Índices que faltaban por jugador en ta_matches. Sin ellos, `getH2H` (que se
-- ejecuta en CADA carga de una ficha de partido) hace un table scan completo de
-- ta_matches para resolver `a_player_id = ? and b_player_id = ?` — con 91.665
-- filas y sin índice, cada ficha de partido cuesta decenas de miles de lecturas
-- que no hacían falta.
--
-- Sospecha fundada (no confirmada, Turso no deja inspeccionar el consumo real
-- con las lecturas bloqueadas): esto, sumado al panel "en vivo" recalculando
-- agregados de aces sobre toda `match_stats` en cada refresco automático de
-- 20s, agotó los 500 millones de lecturas/mes del plan gratuito en un solo día
-- de trabajo — un volumen que el TAMAÑO de los datos por sí solo no explica.

create index if not exists idx_ta_matches_a_player on ta_matches(a_player_id);
create index if not exists idx_ta_matches_b_player on ta_matches(b_player_id);
