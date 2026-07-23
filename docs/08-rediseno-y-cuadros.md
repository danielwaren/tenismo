# Rediseño UI, cuadros completos y estadísticas de partido

## Tipografía (sin Inter)

Sistema autohospedado (paquetes `@fontsource`, sin petición externa ni Inter):

- **Display / titulares**: Space Grotesk (geométrica, distintiva, tono deportivo).
- **Cuerpo / interfaz**: IBM Plex Sans (diseñada para interfaces de datos).
- **Cifras**: IBM Plex Mono con `tabular-nums` en toda columna numérica.

## Sistema de color semántico

Un token = un significado, definido una sola vez en `global.css` y expuesto a
Tailwind (`bg`, `surface`, `line`, `ink`/`ink-muted`/`ink-faint`, `court`,
`live`). Los componentes usan tokens, no hex sueltos. Se migraron todas las
páginas y componentes del viejo `slate-*` a estos tokens. Contraste verificado
para AA en texto principal y secundario; foco visible en todo lo interactivo;
se respeta `prefers-reduced-motion`.

## Cuadros completos

Antes, para los torneos en curso solo se importaban de ESPN los partidos
próximos y en vivo, así que las rondas ya jugadas faltaban y el cuadro se veía
incompleto. Ahora `espn-ingest` importa también los partidos **terminados**
(estado `post`), con resultado y marcador set por set.

Para no contaminar el Elo, estos completados de ESPN son **solo para mostrar**:
el entrenamiento se restringió a `source = 'tennis-data'`, que sigue siendo la
única fuente autorizada de resultados. Cuando tennis-data publica el mismo
partido, `reconcile` retira el duplicado de ESPN (moviendo cuotas/apuestas al
partido autorizado).

Resultado verificado: Hamburgo 38 partidos (32 jugados + 6 por jugar, 5 rondas),
Kitzbühel/Generali 29, etc. Los cuadros ya muestran las rondas completas.

## Más información en la ficha de partido

Lo que la fuente da de verdad, sin inventar nada:

- **Marcador set por set** de los partidos jugados, con juegos ganados por cada
  jugador.
- **Comparativa de jugadores**: Elo global y por superficie, nº de partidos,
  % de victorias global y en esa superficie, y forma reciente (últimos 8).
- **Head-to-head**: marcador del historial directo y lista de enfrentamientos
  anteriores con su resultado, enlazables.
- Se mantienen: contribución de cada factor, explicación en palabras, modelo vs
  mercado y cuotas reales.

### Lo que NO se puede mostrar (y por qué)

**Aces, dobles faltas, errores no forzados, % de primer saque**: no existen en
ninguna fuente disponible. tennis-data no los trae (confirmado desde la Fase 1),
ESPN devuelve el array de estadísticas **vacío** (`statistics: []`), y los repos
de Sackmann que sí los tenían están caídos. No se muestran cifras inventadas de
eso. "Juegos ganados" sí se muestra porque se calcula del marcador real.

## Nota de dev

Tras instalar los paquetes de fuentes, el optimizador de Vite en modo dev puede
servir un bundle de React cacheado y romper la hidratación (`jsxDEV is not a
function`). Es un artefacto del dev-server, no del código: el build de
producción compila limpio. Se resuelve con `rm -rf node_modules/.vite .astro` y
un reinicio del dev-server con recarga dura del navegador.
