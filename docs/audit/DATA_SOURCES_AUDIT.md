# Auditoría de fuentes de datos

| Fuente | Uso actual | Naturaleza | Estado recomendado |
|---|---|---|---|
| tennis-data.co.uk | resultados/cuotas históricas XLSX | descarga web | Verificar licencia/atribución vigente antes de producción |
| The Odds API | cuotas futuras | API con key | Mantener según plan/ToS; registrar captura y cuota |
| ESPN | scoreboard/live | endpoint no contractual | Fallback frágil; no prometer SLA ni servidor |
| Tennis Abstract HTML | stats ATP/Challenger | scraping automatizado | Pausar hasta permiso/licencia explícita |
| Repositorios públicos de Jeff Sackmann | históricos/MCP | datasets con licencia por repo | Ruta preferida si licencia/cobertura encajan |
| Datos propios | banca/apuestas | usuario | Requiere auth, privacidad, retención y export/delete |

| Severidad | Evidencia | Archivo/módulo | Impacto | Recomendación | Esfuerzo | Riesgo cambio | Prioridad |
|---|---|---|---|---|---|---|---|
| Alta | No catálogo de licencia, ToS, atribución, SLA, owner y freshness por fuente | scripts/docs | Cumplimiento y confianza | Registro de fuentes versionado + revisión legal | Medio | Bajo | P0 |
| Alta | TA HTML se rastrea automáticamente | `ta.yml`, `ta-ingest.ts` | Legal/operativo | Pausar; usar datasets licenciados o acuerdo | Bajo | Bajo | P0 |
| Alta | No provenance uniforme por campo; algunos outputs solo tienen `source` de fila | esquema/queries | Mezcla difícil de auditar | `DataEnvelope` y lineage de derivaciones | Medio | Medio | P1 |
| Media | ESPN y formatos XLSX se parsean con shapes débiles | parsers | Rotura silenciosa | Validación runtime + cuarentena + alertas | Medio | Bajo | P1 |
| Media | Freshness no tiene SLO ni estado visible consistente | jobs/UI | Datos obsoletos parecen actuales | Tabla de ejecuciones/fuentes y badges UI | Medio | Bajo | P1 |
| Media | Fechas textuales sin contrato de timezone | DB | Emparejamientos erróneos | UTC ISO y fecha local del torneo separadas | Alto | Alto | P1 |
