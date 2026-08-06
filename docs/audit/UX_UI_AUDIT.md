# Auditoría UX/UI

## Evaluación

La identidad actual ya evita el chatbot genérico: tipografía deportiva/datos, tokens court/clay/live, navegación responsive y densidad razonable. El producto sigue organizado por páginas técnicas (ranking, calibración, paper trading) más que por tareas temporales del aficionado/analista.

| Severidad | Evidencia | Archivo/módulo | Impacto | Recomendación | Esfuerzo | Riesgo cambio | Prioridad |
|---|---|---|---|---|---|---|---|
| Alta | No distingue de forma sistemática confirmado/estimado/no disponible + fuente/freshness | dashboard, match, ranking | Confianza baja | Componente `DataProvenance` con fuente, timestamp, estado y retraso | Medio | Bajo | P0 |
| Alta | Dashboard no prioriza completamente live→hoy→próximos→mi actividad | `src/pages/index.astro` | Menor utilidad diaria | Reordenar usando capacidades reales, sin inventar datos | Medio | Medio | P1 |
| Media | Búsqueda solo jugadores/torneos y sin teclado/agrupación rica | `Buscador.tsx`, `/api/search` | Descubrimiento pobre | Contrato unificado, grupos, highlight, recents locales, combobox accesible | Medio | Bajo | P1 |
| Media | Cargas son texto; faltan skeletons coherentes | componentes React | Saltos y espera percibida | Skeletons reservando dimensiones y `aria-busy` | Bajo | Bajo | P1 |
| Media | Tablas requieren estrategia móvil por prioridad de columnas | ranking/calibración | Lectura difícil | Vista compacta móvil + detalle progresivo | Medio | Bajo | P1 |
| Media | Errores inline no siempre usan `role=alert` | formularios trading | Accesibilidad | Regiones live y foco al error | Bajo | Bajo | P1 |
| Baja | Focus visible y reduced motion ya existen | `global.css` | Base positiva | Mantener y probar AA/teclado | Bajo | Bajo | P2 |

## Propuestas basadas en datos existentes

- Dashboard: Ahora en vivo (solo ESPN verificado), partidos programados con modelo/mercado si existen, torneos activos, ranking/Elo, y banca solo tras autenticar.
- Búsqueda: jugadores, torneos y partidos existentes; sedes/superficies solo cuando el esquema tenga valores normalizados.
- Perfil: identidad disponible, ranking, Elo, forma, resultados, H2H y estadísticas TA únicamente si fuente autorizada y muestra visible.
- Partido: estados prematch/live/final; servidor solo si campo explícito. El esquema live actual no guarda servidor, por lo que debe mostrarse “no disponible”.
