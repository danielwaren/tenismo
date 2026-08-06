# Sistema de diseño TENISMO

## Dirección

Terminal deportiva editorial: alta densidad controlada, jerarquía por tiempo y fiabilidad, tipografía clara y cifras tabulares. Evitar globos de chat, gradientes decorativos y mosaicos de tarjetas equivalentes.

## Tokens

Evolucionar los tokens actuales de `global.css`/Tailwind, no sustituirlos.

- Color: `canvas`, `surface`, `surface-raised`, `ink`, `ink-muted`, `line`; acentos `court`, `clay`; semánticos `live`, `positive`, `warning`, `critical`, `estimated`, `stale`.
- Tipografía: Space Grotesk para titulares; IBM Plex Sans para interfaz; IBM Plex Mono para cuotas, tiempos, ranking, Elo y marcador.
- Escala: 12/14/16/20/24/32/40; línea 1.2 titulares y 1.45 texto.
- Espacio: base 4 px (4/8/12/16/24/32/48).
- Radios: 6 controles, 10 módulos, 999 pills; no redondear cada contenedor.
- Bordes: 1 px; sombra solo para overlays. Capas: canvas 0, sticky 10, popover 30, modal 50.
- Movimiento: 120–200 ms; respetar `prefers-reduced-motion` existente.
- Temas: claro/oscuro con contraste WCAG AA; no codificar significado solo por color.

## Componentes de datos

- `DataProvenance`: fuente, observado/capturado, freshness, calidad y aviso.
- `LiveScore`: estado, sets/game y servidor solo con campo explícito.
- `ProbabilityBar`: modelo/mercado, muestra, versión y texto accesible.
- `Metric`: valor, unidad, periodo, muestra, delta y estado missing.
- `DataTable`: cabecera sticky, columnas prioritarias móvil y vista detalle.
- Gráfico: título, periodo, fuente, muestra, leyenda, tooltip teclado y tabla alternativa.
- `Skeleton`: mismas dimensiones del contenido; `aria-busy`.
- Empty: qué falta y acción disponible; nunca datos ficticios.
- Error: impacto, reintento y timestamp; `role=alert` cuando proceda.

## Layout

- Móvil: 4 columnas, márgenes 16, controles táctiles ≥44 px, navegación inferior solo si se valida su encaje con navegación actual.
- Tablet: 8 columnas; dos carriles.
- Desktop: 12 columnas, máximo de línea 72ch; panel live dominante.
- Ancho: aumentar densidad y comparativas, no líneas de texto.

## Hallazgos

| Severidad | Evidencia | Archivo/módulo | Impacto | Recomendación | Esfuerzo | Riesgo cambio | Prioridad |
|---|---|---|---|---|---|---|---|
| Alta | No existe patrón transversal de procedencia/freshness | UI | Datos ambiguos | Construir `DataProvenance` antes de nuevos gráficos | Medio | Bajo | P0 |
| Media | Tokens actuales cubren base, no estados de calidad | CSS/Tailwind | Inconsistencia futura | Añadir semánticos con pruebas AA | Bajo | Bajo | P1 |
| Media | Loading/error/empty varían por isla | React components | Experiencia desigual | Primitivas comunes accesibles | Medio | Bajo | P1 |
| Baja | Focus y reduced motion ya están definidos | `global.css` | Buena base | Preservar y automatizar axe posteriormente | Bajo | Bajo | P2 |
