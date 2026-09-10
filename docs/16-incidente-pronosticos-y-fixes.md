# Incidente: 60+ días sin pronósticos nuevos, y los tres bugs detrás (ago 2026)

Pedido: revisar el código en busca de más aciertos, y arreglar información
incompleta en las fichas de partido. Se encontraron tres bugs reales en el
pipeline de entrenamiento/predicción, no solo margen de mejora del modelo.

## Lo que se encontró

**`player_serve_stats` tenía 0 filas** en producción, y **ningún partido
programado o jugado en los últimos 60 días tenía predicción**
(`model_outputs.prob_p1` null). El cron diario (GitHub Actions,
`ingesta-diaria.yml`) llevaba semanas "teniendo éxito" (sin errores, ~5-12
min por corrida) sin producir nada nuevo — el tipo de fallo más peligroso,
porque no dispara ninguna alerta.

### Causa raíz: filtro de fuente demasiado estrecho

`scripts/train-elo.ts` solo procesaba partidos completados con
`source in ('tennis-data', 'tennis-abstract')`. Un partido que se completa
vía `reconcile.ts` (que ingiere de ESPN/The Odds API) se queda con
`source='espn'` o `'the-odds-api'` **para siempre**, salvo que
tennis-data.co.uk publique el mismo partido por su cuenta y el bloque de
deduplicación de `reconcile.ts` lo fusione. Si tennis-data nunca lo cubre
—pasa con eventos menores o simplemente por retraso de publicación— ese
resultado no entraba jamás al entrenamiento. **590 partidos** en 90 días.
Fix: se amplió el filtro a incluir también `'espn'` y `'the-odds-api'`,
confirmando primero (leyendo `reconcile.ts`) que no hay riesgo de contar un
partido dos veces — el duplicado de ESPN se borra cuando tennis-data sí
llega a publicarlo.

### Bug de datos: superficie con casing inconsistente

Tennis Abstract publica la superficie en Title Case ("Hard", "Clay"); el
resto de fuentes usa minúscula. **33.556 partidos** (todo Challenger +
circuito pre-2013) tenían el Elo de superficie de cada jugador partido en dos
filas nunca mezcladas ("Clay" y "clay" nunca calzan en un `group by`/`Map`) —
cada jugador afectado veía solo la mitad de su historial real en esa
superficie, silenciosamente, para `eloDiffSurface` (la feature top del
modelo). Fix en origen (`scripts/lib/ta.ts::normalizeSurface`) + migración
`0007_normaliza_superficie_ta.sql` para los datos ya escritos.

### Bug menor: scope mal etiquetado

`updateRatings()` en `packages/model/src/elo.ts` marcaba las cuatro
actualizaciones de rating con `scope='all'`, incluidas las de superficie. Sin
efecto real (nada consumía `.updates`), pero mentía si algo llegara a
leerlo. Arreglado con un parámetro `surface` opcional.

## La recuperación

Con los tres fixes en código, se corrió `npm run db:elo -- --reset` para
recomputar todo desde datos limpios (y de paso aplicar la fusión
Challenger/TA en el entrenamiento del Elo, ya validada en
`scripts/backtest-elo-ta.ts` pero nunca antes aplicada en producción). La
corrida completó features (78.926), predicciones base y el historial completo
(452.372 filas) — pero **se cayó la conexión a Supabase** (`CONNECTION_CLOSED`)
después de ~1h40 de ejecución continua, a mitad de escribir `player_ratings`.

En vez de repetir la corrida entera, se reconstruyó lo que faltaba con SQL
puro contra lo que sí había quedado completo:
- `player_ratings`: se puede derivar entero de `rating_history` (que sí
  terminó al 100%) — el elo final es el `elo_after` de la fila más reciente
  por `(player_id, surface)`, y `matches` es el conteo de filas.
- `player_serve_stats` / `tour_serve_stats`: sumas puras sobre `match_stats`
  (conmutativas, no dependen de orden cronológico) — se recalculan enteras
  con una sola consulta, replicando exactamente la lógica de
  `train-elo.ts` líneas ~474-484.
- `elo_applied`: se marca 1 para todo lo que ya tiene fila en
  `match_features` y es un partido completado.

Un segundo `npm run db:elo` (incremental, sin `--reset`) procesó los 590
partidos que el filtro viejo había dejado fuera. Ese proceso SÍ estaba
avanzando con normalidad (no colgado) cuando se lo mató por error creyendo
que estaba trabado — la misma reconstrucción por SQL de arriba, re-ejecutada,
lo recuperó sin pérdida (es idempotente: se puede correr las veces que haga
falta mientras `rating_history`/`match_stats` no cambien).

## Resultado verificado

```
Antes:  Brier modelo 0,2136  ·  acierto ATP 66,2%
Después: Brier modelo 0,2130  ·  acierto ATP 66,6%
```

Mejora modesta pero real y medida — consistente con lo que ya documentaba
[docs/03](./03-fase-1-5-modelo.md): no hay margen para un salto grande sin
datos punto a punto que este proyecto no tiene. Lo que sí cambia mucho: **las
fichas de partido y la home vuelven a mostrar pronóstico** para los 104
partidos programados y para los partidos en vivo — confirmado navegando el
sitio después del fix (antes: 0 de 104 con pronóstico).

## Lección para la próxima vez

Un cron "verde" en GitHub Actions no prueba que hizo algo útil, solo que no
lanzó una excepción. Vale la pena que `ingesta-diaria.yml` compare
`stats.predictions`/`lastResult` antes y después de correr, y falle
explícitamente si un día normal no avanzó nada — el mismo espíritu que ya
tiene el aviso de `datosViejos` en `index.astro`, pero aplicado al pipeline
en vez de a la vista. No se implementó hoy por alcance, queda como pendiente.

---

## Segundo incidente, mismo patrón (sept 2026): cuota de The Odds API

"El motor de simulación dejó de funcionar." Diagnóstico:

- `odds` sin captura nueva desde el **2 sept**.
- Última liquidación de apuestas: **26 ago**. 115 apuestas abiertas, 63 sobre
  partidos ya jugados y sin liquidar.
- 173 partidos completados sin `elo_applied`. 97 partidos "scheduled" con
  fecha ya pasada (reconcile no corría).

Causa: el plan gratis de The Odds API son **500 créditos/mes** y el US Open
los agotó. `odds-ingest.ts` tiraba `throw` ante el `HTTP 401
OUT_OF_USAGE_CREDITS`, y ese paso está en medio de `ingesta-diaria.yml`, así
que todo lo de después (reconcile, elo, predict, **paper-trade**) dejó de
correr. Exactamente el mismo patrón que el primer incidente: un fallo duro en
un paso no crítico frena el pipeline entero.

Fixes (commits `bc54d9d`, `2f71d4d`):
1. `odds-ingest.ts`: cuota agotada = no-op explícito con warning, exit 0
   (guarda proactiva por `x-requests-remaining` + reactiva por si se agota a
   mitad). Igual que ya hacía ante "sin ODDS_API_KEY".
2. `continue-on-error: true` en el paso de The Odds API del workflow — las
   cuotas son "mejor esfuerzo una vez al día" y nunca deben poder frenar el
   núcleo.
3. Manual, para destapar: `reconcile.ts` (fusionó 61 partidos jugados),
   `paper-trade.ts --settle-only` (liquidó 77 apuestas). El simulador quedó
   al día. Los 173 partidos sin `elo_applied` los procesa el cron ya
   destrabado (localmente `train-elo.ts` se cuelga en la escritura a Supabase
   — el mismo problema de conexión del primer incidente, que en GitHub
   Actions no aparece).

**La lección refuerza la anterior**: `evaluate.ts` ya tenía `|| true`. Los
otros pasos de ingesta de fuentes externas (`ingest` de temporada,
`espn-ingest`, `odds-ingest`) deberían tener el mismo trato — una fuente
caída no puede tumbar el pipeline. Hoy solo se hizo `odds-ingest`; los otros
dos quedan pendientes.

**Costo pendiente de decisión**: la cuota de The Odds API. Ver
[docs/15](./15-monetizacion.md) §"Costo YA presente".
