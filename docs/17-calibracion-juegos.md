# Calibración del total de juegos (sept 2026)

El motor punto a punto predecía **~1,9 juegos de más** en cada partido, de
forma sistemática. Esto lo mide, lo corrige y —tan importante como lo
anterior— delimita qué NO arregla.

## De dónde salió

El simulador perdía en Total de Juegos con un patrón raro: eligió **OVER en
334 de 343 apuestas** y terminó 167G/167P. Elegir siempre el mismo lado y
salir exactamente 50/50 no es mala suerte, es un sesgo.

Una primera medición rápida dio +0,46 juegos. **Estaba mal**: usaba
`getMarkovInputs`, que agrega TODO el historial del jugador —incluidos
partidos POSTERIORES al que evalúa—. Con look-ahead el motor parece 4 veces
más preciso de lo que es. Sirve para pintar una ficha, no para medir
calibración histórica.

## Metodología

`scripts/calibrate-games.ts` (no escribe nada, se puede reproducir):

- **Walk-forward real**: replica el acumulador cronológico de `train-elo.ts`.
  Cada partido se simula con el perfil de saque PREVIO y solo después se
  actualiza con sus estadísticas. Sin look-ahead.
- **Separación temporal, nunca aleatoria** (mismo criterio que
  [docs/03](./03-fase-1-5-modelo.md)):
  - calentamiento ≤2022 — solo acumula perfil
  - **train** 2023-2024 (4.240 partidos) — se ajusta acá
  - **test** 2025-2026 (3.242) — jamás usado para ajustar

## Resultado: el sesgo es real, grande y estable

| | Train (2023-24) | Test (2025-26) |
|---|---|---|
| Sesgo sin corregir | **+1,953** | **+1,858** |
| Con corrección aditiva | — | −0,094 |
| Con corrección lineal | — | −0,055 |
| MAE sin corregir → lineal | — | 5,876 → 5,494 |

Media simulada 28,06 contra 26,10 real. Que el sesgo se sostenga casi idéntico
entre train y test (+1,95 vs +1,86) es lo que lo convierte en un defecto del
motor y no en ruido de una muestra.

El ajuste lineal es `real ≈ 2,58 + 0,8384 · simulado`. **β = 0,838 < 1**
significa que el motor además **exagera la dispersión ~16%**: no solo corre el
centro, reparte demasiada probabilidad en la cola alta. Por eso la corrección
aplicada es lineal y no una resta.

## Lo que importa para apostar: `probOver`

Evaluado en la línea donde la pondría el MERCADO (cerca de la media real, no
de la del motor — usar la del motor sesgaría la prueba a su favor):

| Variante | Predice | Observado | Error de calibración |
|---|---|---|---|
| Cruda (lo de antes) | 53,9% | 42,5% | **11,39 pp** |
| Aditiva | 48,5% | 42,5% | 6,40 pp |
| **Lineal (aplicada)** | 48,2% | 42,5% | **5,72 pp** |

Un motor que dice "53,9% over" cuando la realidad es 42,5% apuesta OVER
constantemente y pierde. Eso explica exactamente las 334 de 343.

## Lo que esta corrección NO arregla

Queda **5,7pp de error** y, peor, el motor **sigue sin poder ordenar** qué
partidos van over: en el test los tramos no salen monótonos (0,4-0,5 observa
42,9% y 0,5-0,6 observa 41,8%). Una probabilidad más alta del motor no
significa que pase más seguido.

**Conclusión honesta**: la calibración hace que los números publicados sean
ciertos, no que haya ventaja sobre el mercado de totales. Es la misma lección
de [docs/04](./04-backtest-paper-trading.md): calibrar es necesario, no
suficiente.

## Qué se aplicó

`GAMES_CALIBRATION = { alfa: 2.58, beta: 0.8384 }` en
`packages/model/src/markov.ts`, con dos helpers:

- `calibratedMeanGames(sim)` → `α + β·sim`
- `calibratedProbOver(sim, L)` → `sim.probOver((L − α) / β)`, que traduce la
  línea al espacio del simulador antes de preguntarle.

Usados en:

- **`src/lib/queries.ts`** (ficha del partido): media, dispersión, percentiles,
  histograma y la tabla de over/under salen todos de la muestra ya calibrada,
  para que no se contradigan entre sí. Antes se publicaba un total ~1,9 juegos
  alto — un partido que decía "25,7 juegos esperados" ahora dice ~24,1.
- **`scripts/paper-trade.ts`**: la decisión de TOTAL_GAMES usa
  `calibratedProbOver`. El efecto práctico es que deja de decir "over" casi
  siempre.

## Hándicap de juegos: distinto problema, sin arreglo por acá

La misma corrida midió que el motor acierta el **51,2%** en algo tan básico
como quién gana más juegos — moneda al aire. Con esa señal las apuestas de
hándicap dieron 37G/132P (21,9%) en el lado "da juegos". Calibrar el total no
arregla la dirección del margen. Por eso el mercado está **pausado** (no
eliminado): `ODDS_API_MARKETS` no pide `spreads` por defecto, y reactivarlo es
una variable de entorno. Ver [docs/15](./15-monetizacion.md).
