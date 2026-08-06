# Arquitectura actual

## Inventario

- Framework: Astro `^5.3.0`, SSR (`output: server`) y adaptador Vercel `^8.0.0`.
- Lenguaje: TypeScript estricto; vistas `.astro` e islas React 18.
- Router: file router de Astro (`src/pages`); endpoints en `src/pages/api`.
- UI: Tailwind 3, CSS global con tokens propios, Space Grotesk/IBM Plex.
- Estado: estado local React; no store global.
- Auth/autorización: no existe en el repositorio.
- Datos: PostgreSQL de Supabase vía `postgres.js`; adaptador compatible con el antiguo cliente libSQL.
- Migraciones: `db/postgres/0001_initial_schema.sql`; siguen presentes migraciones SQLite históricas.
- Jobs: GitHub Actions para ingesta diaria, live y Tennis Abstract.
- Despliegue: Vercel SSR.
- Caché: caché HTML diaria local para TA; respuestas API generalmente `no-store`; sin caché distribuida.
- Tests: Vitest en raíz y paquete `@tti/model`.
- Observabilidad: logs de consola y resúmenes de Actions; sin APM/SLO.

```mermaid
flowchart LR
  U[Usuario] --> V[Vercel / Astro SSR]
  V --> P[Pages Astro]
  V --> A[API routes]
  P --> Q[queries.ts]
  A --> Q
  A --> B[bets.ts]
  Q --> D[(Supabase PostgreSQL)]
  B --> D
  G[GitHub Actions] --> S[Scripts de ingesta/modelo]
  S --> D
  S --> E[ESPN / tennis-data / Odds API]
  S -. scraping sin licencia documentada .-> T[Tennis Abstract HTML]
  M[@tti/model] --> S
  M --> A
```

## Hallazgos

| Severidad | Evidencia | Archivo/módulo | Impacto | Recomendación | Esfuerzo | Riesgo cambio | Prioridad |
|---|---|---|---|---|---|---|---|
| Alta | Dos esquemas y comentarios incompatibles conviven | `db/migrations`, `db/postgres`, `src/lib/db.ts` | Fuente de verdad ambigua | Declarar PostgreSQL canónico y archivar migraciones legacy con nota explícita | Bajo | Bajo | P0 |
| Media | Adaptador traduce `?` a `$n` con parser artesanal de comillas | `src/lib/db.ts:39-55` | SQL complejo puede traducirse mal | Añadir tests de escapes/comentarios/dollar quoting y migrar gradualmente a consultas nativas parametrizadas | Medio | Medio | P1 |
| Media | Acceso de datos, DTOs y agregados en archivo monolítico | `src/lib/queries.ts` | Acoplamiento UI-esquema | Repositorios por dominio + `TennisDataProvider` | Medio | Medio | P1 |
| Baja | No ORM | repositorio | No es defecto por sí mismo | Mantener SQL explícito; tipar resultados y centralizar consultas | Medio | Bajo | P2 |
