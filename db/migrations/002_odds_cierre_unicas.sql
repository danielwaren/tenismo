-- Las cuotas de CIERRE históricas son únicas por partido/casa/mercado/selección:
-- hay exactamente un cierre por casa. La clave única original incluía
-- `captured_at`, así que al corregirse la fecha de un partido la reingesta
-- insertaba una fila nueva en vez de actualizar la existente (detectado con la
-- errata de fecha del Iasi Open 2026).
--
-- Las cuotas EN VIVO de The Odds API (Fase 2) sí necesitan varias capturas a lo
-- largo del tiempo, así que el índice es PARCIAL: solo restringe el histórico.

-- Limpieza de los duplicados que dejó el error: se conserva la fila más
-- reciente (id mayor) de cada combinación.
delete from odds
where source = 'tennis-data'
  and id not in (
    select max(id) from odds
    where source = 'tennis-data'
    group by match_id, bookmaker, market, selection
  );

create unique index if not exists idx_odds_cierre_unica
  on odds (match_id, bookmaker, market, selection)
  where source = 'tennis-data';
