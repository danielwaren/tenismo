# Auditoría ejecutiva de TENISMO

Fecha: 2026-08-05. Alcance: repositorio completo, producto, datos, modelo, banca, IA, UX/UI, seguridad, rendimiento, observabilidad, pruebas y despliegue. La revisión es estática y de línea base; no certifica producción ni la legalidad de fuentes externas.

## Conclusión

TENISMO ya es un producto especializado: Astro SSR con islas React, PostgreSQL/Supabase, pipelines de datos, Elo por superficie, regresión logística, motor Markov, paper trading y banca manual. No conviene reescribirlo. Sí requiere una fase de estabilización antes de ampliar dashboard, perfiles o IA.

Riesgos dominantes: (1) las APIs de banca son públicas y no aíslan usuarios; (2) el scraping automatizado de Tennis Abstract no tiene licencia o permiso documentado; (3) hay deriva Turso→Supabase en dependencias, configuración y documentación; (4) la trazabilidad de datos y observabilidad son parciales; (5) el modelo está bien planteado, pero no supera al mercado y carece de un registro reproducible completo de datasets/artefactos.

## Capacidades reales

| Capacidad | Estado |
|---|---|
| Partidos y torneos | Históricos, programados y una vista live derivada de ESPN; cobertura no contractual |
| Búsqueda | Jugadores/torneos con filtros básicos; no unificada ni tolerante a errores |
| Perfiles | Ranking, Elo, forma y H2H parciales; no ficha editorial completa |
| Predicción | Elo + features + Markov, probabilidades prepartido y backtest walk-forward |
| Banca | Registro manual y paper trading; sin identidad de usuario |
| IA | Contrato/documentación parcial; no proveedor productivo inventado |
| Datos avanzados | Tennis Abstract ATP mediante scraping; debe pausarse hasta autorización |

## Hallazgos prioritarios

| Severidad | Evidencia | Archivo/módulo | Impacto | Recomendación | Esfuerzo | Riesgo cambio | Prioridad |
|---|---|---|---|---|---|---|---|
| Crítica | GET/POST aceptan `bankrollId` y mutan saldos/apuestas sin sesión ni propietario | `src/pages/api/bets/*`, `db/postgres/0001_initial_schema.sql` | Exposición y alteración de datos financieros | No publicar banca hasta incorporar auth existente o una barrera de acceso y `user_id` con autorización servidor | Alto | Alto | P0 |
| Alta | Rastreo programado de HTML; robots permitido no acredita licencia; TA dirige datos reutilizables a GitHub | `scripts/ta-ingest.ts`, `scripts/lib/ta.ts`, `.github/workflows/ta.yml` | Riesgo legal, bloqueo y pérdida de fuente | Pausar automatización; solicitar permiso; priorizar datasets con licencia explícita | Bajo | Bajo | P0 |
| Alta | README/Astro/.env.example describen Turso, pero runtime usa `postgres` y secretos Supabase | `README.md`, `astro.config.mjs`, `.env.example`, `src/lib/db.ts` | Operación errónea y onboarding inseguro | Unificar configuración y retirar dependencia libSQL si no se usa | Bajo | Bajo | P0 |
| Alta | Errores 500 incluyen `(e as Error).message` | `src/pages/api/bets/*` | Filtración de detalles internos | Registrar en servidor y devolver códigos/mensajes genéricos | Bajo | Bajo | P0 |
| Media | `queries.ts` (1367 líneas) concentra acceso y ensamblado | `src/lib/queries.ts` | Cambios frágiles, baja testabilidad | Separar por dominio detrás de repositorios/proveedores | Medio | Medio | P1 |
| Media | Sin métricas, trazas, SLO ni captura central de errores | aplicación y workflows | Incidentes invisibles y datos obsoletos | Logging estructurado, health de fuentes, freshness y alertas | Medio | Bajo | P1 |

## Decisión

Mantener Astro, React islands, Tailwind, PostgreSQL/Supabase, Vercel y navegación. Próximo hito: seguridad y procedencia; después proveedor desacoplado, búsqueda/perfiles y finalmente expansión visual.
