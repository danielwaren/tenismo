# Deuda técnica

## Registro

| Severidad | Evidencia | Archivo/módulo | Impacto | Recomendación | Esfuerzo | Riesgo cambio | Prioridad |
|---|---|---|---|---|---|---|---|
| Alta | Dependencias y ejemplos Turso ya no representan runtime | `package.json`, `.env.example`, `README.md`, `astro.config.mjs` | Builds/onboarding inconsistentes | Eliminar `@libsql/client` si `rg` confirma desuso; actualizar docs/config | Bajo | Bajo | P0 |
| Alta | No hay script `lint`; el pedido de lint no puede cumplirse | `package.json` | Calidad no automatizada | Añadir ESLint solo tras acordar reglas; hoy usar `astro check` | Medio | Bajo | P1 |
| Media | `queries.ts` 1367 líneas; `train-elo.ts` 677 | módulos indicados | Alta carga cognitiva | Extraer repositorios/etapas puras en cambios incrementales | Alto | Medio | P1 |
| Media | `any` al parsear ESPN/XLSX/Odds | `src/lib/espn.ts`, `scripts/lib/xlsx.ts`, `scripts/odds-ingest.ts` | Fallos silenciosos ante cambios externos | Schemas runtime y tipos `unknown` con validación | Medio | Bajo | P1 |
| Media | Fechas almacenadas como `text` y mezcladas entre fecha/hora | esquema PostgreSQL | Orden/zonas horarias frágiles | Contrato UTC; migración futura a `date`/`timestamptz` validada | Alto | Alto | P1 |
| Media | Sin pruebas de rutas API de banca ni autorización | `src/pages/api/bets`, tests | Regresiones financieras | Tests de contrato, concurrencia, límites y ownership antes de exponer | Medio | Bajo | P0 |
| Baja | Codificación mojibake visible en salida/documentos | varios comentarios/docs | Mantenibilidad y posible UI defectuosa | Normalizar UTF-8 sin reescritura masiva accidental | Bajo | Medio | P2 |
