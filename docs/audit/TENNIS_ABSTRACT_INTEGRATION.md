# Integración con Tennis Abstract

Revisión: 2026-08-05. No es asesoría legal.

## Resultado

No se encontró API pública, feed oficial ni licencia que autorice extraer de forma automatizada las fichas HTML. Que `/cgi-bin/` no aparezca prohibido en `robots.txt` no concede derechos de reutilización. El sitio publica que sus bases reutilizables están disponibles mediante enlaces a GitHub y que, si un dato no está allí, puede haber decidido no compartirlo. Por tanto la automatización actual no cumple el umbral de autorización exigido por TENISMO.

Evidencia pública:

- “Free ATP and WTA Results and Stats Databases”, Tennis Abstract/Heavy Topspin (2015): datasets enlazados a GitHub.
- “Contact Tennis Abstract”: para datos raw remite a GitHub y aclara que lo no disponible puede no haberse compartido deliberadamente.
- Match Charting Project: parte de los datos raw está publicada para investigación; cada repositorio debe revisarse por licencia concreta.
- El repositorio implementa scraping de `player-classic.cgi`, caché, rate limit y reintentos de Cloudflare (`scripts/lib/ta.ts`).

| Severidad | Evidencia | Archivo/módulo | Impacto | Recomendación | Esfuerzo | Riesgo cambio | Prioridad |
|---|---|---|---|---|---|---|---|
| Alta | No hay permiso/licencia archivado | `docs`, scripts TA | Riesgo legal | Deshabilitar schedule; pedir autorización escrita | Bajo | Bajo | P0 |
| Alta | Cloudflare 1015 y backoff evidencian oposición técnica al volumen | `scripts/lib/ta.ts` | Bloqueo/inestabilidad | No tratar rate limiting como permiso; detener automatización | Bajo | Bajo | P0 |
| Media | Robots se codifica como allowlist parcial, pero puede cambiar | `assertAllowedPath` | Cumplimiento temporal | Revalidación automática no basta; requiere permiso contractual | Bajo | Bajo | P1 |
| Media | Atribución/licencia no viaja con campos derivados | DB/UI | Provenance incompleta | Metadatos por dataset/versión/campo | Medio | Medio | P1 |

## Rutas

- Ruta A — oficial: contactar al responsable para API/feed/licencia/partnership, alcance comercial, retención, derivados, atribución, límites y SLA.
- Ruta B — importación controlada: usar únicamente repositorios/datasets con licencia explícita compatible; fijar commit/release, checksum, atribución y frecuencia.
- Ruta C — fallback: fuentes oficiales ATP/WTA/ITF/torneos o proveedor autorizado; si no hay dato, mostrar no disponible. No afirmar que una fuente oficial permite redistribución sin revisar términos.

## Decisión operativa

Conservar parser y datos existentes en cuarentena para trazabilidad, pero no ejecutar nuevas descargas programadas ni promover filas al modelo hasta completar Ruta A o B.
