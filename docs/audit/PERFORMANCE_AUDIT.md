# Auditoría de rendimiento

## Hallazgos

| Severidad | Evidencia | Archivo/módulo | Impacto | Recomendación | Esfuerzo | Riesgo cambio | Prioridad |
|---|---|---|---|---|---|---|---|
| Alta | SSR/API sin estrategia de caché y muchas respuestas `no-store` | `src/pages/api`, Astro pages | Latencia/lecturas DB | Cachear solo datos públicos por TTL/freshness; nunca banca | Medio | Bajo | P1 |
| Alta | Adaptador batch ejecuta sentencias secuenciales por transacción | `src/lib/db.ts` | Jobs lentos | Mantener multi-row inserts y medir `COPY`/upsert por lote | Medio | Medio | P1 |
| Media | Consultas agregadas extensas en módulo único | `src/lib/queries.ts` | Riesgo de scans | `EXPLAIN ANALYZE` en producción anonimizada; índices guiados por métricas | Medio | Bajo | P1 |
| Media | Live consulta cada 60 s por cliente con `no-store` | `src/components/LiveMatches.tsx`, `/api/live` | Carga multiplicada | Cache servidor corta + pausa en pestaña oculta + backoff | Bajo | Bajo | P1 |
| Media | React islands grandes para trading | `TradingPage.tsx` y componentes | JS móvil | Lazy islands por sección y medición de bundle | Medio | Bajo | P2 |
| Media | No presupuesto de Core Web Vitals/bundle | CI | Regresiones invisibles | Budget de JS/CSS y Lighthouse en CI después de baseline | Medio | Bajo | P2 |
| Baja | Fuentes locales múltiples | `Base.astro`, dependencias fontsource | Peso de fuentes | Subset y preload solo de pesos usados | Bajo | Bajo | P2 |

## Línea base

Verificación final fuera del sandbox y con telemetría desactivada: 246 tests pasaron, `astro check` terminó con 0 errores (8 hints por imports no usados) y el build SSR de Vercel finalizó correctamente. El bundle cliente más grande fue el runtime React (136,54 kB; 44,02 kB gzip) y la isla propia más grande fue `TradingPage` (41,96 kB; 9,56 kB gzip). No existe script de lint en `package.json`; por tanto no se declara lint como validado.