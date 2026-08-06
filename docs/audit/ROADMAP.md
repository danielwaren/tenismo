# Roadmap priorizado

## P0 — contención y verdad operativa (1–2 semanas)

1. Pausar scraping TA y documentar decisión/licencias.
2. No exponer banca públicamente; diseñar auth/ownership y migración.
3. Unificar Supabase/PostgreSQL en README, env y dependencias.
4. Sanitizar errores 500 y añadir headers/rate limits.
5. Recuperar línea base estable test/typecheck/build y CI.

## P1 — plataforma de datos (2–5 semanas)

1. Introducir `TennisDataProvider` sobre DB actual.
2. Añadir provenance/freshness/capabilities.
3. Validar parsers externos y cuarentena.
4. Separar `queries.ts` por dominio con tests.
5. Observabilidad de jobs, fuentes y endpoints.
6. Evaluación segmentada/model card reproducible.

## P2 — producto (4–8 semanas)

1. Dashboard temporal usando solo capacidades reales.
2. Búsqueda unificada incremental (SQL primero; trigramas si métricas lo justifican).
3. Perfil de jugador y partido con fuentes/muestras/faltantes.
4. Componentes móviles, skeletons y accesibilidad AA.
5. “Mi Tenismo” solo después de auth.

## P3 — expansión

Proveedor autorizado adicional, IA con herramientas de solo lectura y citas, alertas, comparaciones y gráficos avanzados. Motor externo de búsqueda/caché distribuida solo por volumen medido.

| Severidad | Evidencia | Archivo/módulo | Impacto | Recomendación | Esfuerzo | Riesgo cambio | Prioridad |
|---|---|---|---|---|---|---|---|
| Crítica | Banca mutable sin auth | APIs banca | Bloquea publicación | P0 antes de UX expansiva | Alto | Alto | P0 |
| Alta | Fuente TA no autorizada | pipeline TA | Bloquea nueva ingesta | Pausa y Ruta A/B | Bajo | Bajo | P0 |
| Alta | Baseline de calidad no concluyente | toolchain/CI | Cambios sin red | Estabilizar comandos y CI | Medio | Bajo | P0 |
| Media | Features pedidas exceden datos reales | producto | Riesgo de inventar | Capabilities/provider primero | Medio | Bajo | P1 |
