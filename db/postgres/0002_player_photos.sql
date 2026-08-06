-- Fotos de jugador procedentes de Tennis Abstract.
--
-- Las tres columnas van JUNTAS a propósito: son fotos con licencia (el crédito
-- apunta al autor, normalmente un usuario de Wikipedia) y la fuente las publica
-- acreditadas. Una URL sin a quién acreditar no se puede publicar, así que la
-- ingesta escribe las tres o ninguna (ver extractPhoto en scripts/lib/ta.ts).
--
-- No se guarda la imagen, solo la URL: el sitio la sirve a través de
-- /api/foto-jugador/[id].jpg, que la cachea en el CDN para no cargarle el
-- ancho de banda a una web gratuita en cada visita.
alter table players add column if not exists photo_url        text;
alter table players add column if not exists photo_credit     text;
alter table players add column if not exists photo_credit_url text;
