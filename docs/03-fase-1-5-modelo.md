# Fase 1.5 — mejorar el modelo antes de tocar cuotas

Motivo: al cerrar la Fase 1, el Elo por superficie daba Brier 0,2233 frente a
0,2027 del mercado. Montar Paper Trading encima de un modelo que pierde contra
la línea de cierre solo habría documentado pérdidas.

## Qué se añadió

**Regresión logística sobre 13 features**, ajustada por IRLS con penalización L2.
El Elo deja de ser el modelo y pasa a ser una feature (la más importante).

| Feature | Qué aporta |
|---|---|
| `eloDiffSurface`, `eloDiffOverall` | la fuerza estimada, mezclando superficie y global |
| `rankLogDiff`, `pointsLogDiff` | ranking oficial ATP/WTA: información que el Elo no tiene |
| `h2h`, `h2hSurface` | head-to-head encogido hacia 0 con poca muestra |
| `loadDiff`, `intensityDiff` | partidos recientes y cuánto costaron |
| `restDiff` | días desde el último partido, con tope |
| `formDiff` | sorpresa media de los últimos 10 partidos |
| `expDiff`, `surfaceExpDiff` | experiencia global y en esa superficie |
| `bestOf5EloDiff` | la ventaja del favorito crece al mejor de 5 |

**Sin término independiente**, y es deliberado. Todas las features son
diferencias orientadas a p1, así que con intercepto cero el modelo es
antisimétrico: intercambiar a los dos jugadores devuelve exactamente 1-p. Con
intercepto, el mismo partido daría probabilidades distintas según a quién le
tocara ser p1. Además, la Fase 1 midió que p1 (por construcción, el registrado
antes) gana el 54,7%; un intercepto habría horneado ese sesgo de antigüedad
como si fuera señal.

**K por ronda**: una final mueve el Elo un 15% más que una primera ronda.

## El hallazgo del confundido de fatiga

La primera versión tenía una única feature de fatiga (juegos totales en 14 días,
positivo = más fresco). Se ajustó con **peso negativo**: llegar más fresco
empeoraba el pronóstico.

No era un error de signo. En tenis, quien más ha jugado las últimas dos semanas
es precisamente quien **va ganando y avanzando en los cuadros**. La feature
medía éxito reciente tanto como cansancio, y las dos cosas tiran en sentidos
opuestos.

Al partirla en dos, cada efecto se fue a su sitio:

| Feature | Peso | Lectura |
|---|---|---|
| `loadDiff` (cuántos partidos) | **−0,164** | jugar más partidos recientes ayuda → avance en el cuadro |
| `intensityDiff` (juegos por partido) | **+0,058** | partidos menos peleados ayudan → fatiga de verdad |

Es un buen recordatorio de que un coeficiente con signo raro no siempre es un
bug: a veces es la feature la que está midiendo dos cosas a la vez.

## Metodología de evaluación

Reparto **por temporada, nunca aleatorio** — un split al azar mezclaría partidos
de la misma semana entre train y test, y el modelo se estaría evaluando sobre
jugadores cuya forma ya vio.

- train: hasta 2022 (46.255 partidos)
- valid: 2023 (5.005) — solo para elegir la penalización L2
- test: 2024–2026 (9.862 con cuota) — nunca usada para ajustar nada

Con el L2 elegido, el modelo final se reajusta sobre train+valid; el test sigue
limpio. El script avisa si el óptimo de L2 cae en el extremo de la rejilla (pasó
en el primer intento, y por eso la rejilla se amplió).

## Resultados fuera de muestra (2024–2026)

| | Elo solo | Con features | Mercado |
|---|---|---|---|
| Brier | 0,2233 | **0,2159** | 0,2027 |
| LogLoss | 0,6380 | **0,6197** | 0,5890 |
| Acierto del favorito | 63,3% | **64,4%** | 68,0% |

**Se cierra el 36% de la distancia al mercado.** Para comparar: la recalibración
Platt sola, sin features, cerraba el 19%.

La calibración, que era el problema más visible de la Fase 1, queda
prácticamente resuelta como efecto secundario de ajustar bien:

| Rango | Desvío antes | Desvío ahora |
|---|---|---|
| 0,0–0,1 | +0,069 | −0,043 |
| 0,1–0,2 | +0,087 | −0,017 |
| 0,8–0,9 | −0,055 | −0,014 |
| 0,9–1,0 | −0,033 | +0,019 |

El modelo también dejó de dar probabilidades extremas: antes ponía 1.594
partidos por debajo del 10%, ahora 81. Es lo esperable al quitarle la
sobreconfianza.

## Lo que esto NO significa

**El modelo sigue perdiendo contra la línea de cierre** (0,2159 vs 0,2027). La
conclusión de la Fase 1 no cambia, solo se atenúa: sus "edges" siguen sin ser
value demostrado. Si se monta Paper Trading, debe nacer con el flag de value
apagado y usarse para medir CLV honestamente, no para buscar ganancia.

Techo realista de este enfoque: el mercado de tenis incorpora información que
estos datos no tienen — lesiones, estado físico del día, condiciones concretas,
motivación en torneos menores. Sin datos punto a punto (perdidos con la caída de
los repos de Sackmann) ni parte de lesiones, cerrar el 36% restante con features
del mismo tipo es poco probable.

## Separación entre ajustar y predecir

`fit-model.ts` ajusta los pesos y los guarda en `model_fits`; `predict.ts` los
aplica a los partidos que no tienen predicción. El cron diario **solo predice**.

Reajustar a diario sobre datos cada vez más grandes cambiaría el modelo solo, en
silencio, y ninguna métrica publicada seguiría siendo comparable con la del día
anterior. Reajustar es una decisión explícita. `predict.ts` además verifica que
las features guardadas en el ajuste coinciden con las del código, para que un
cambio en `FEATURE_NAMES` sin reajustar falle en vez de aplicar pesos a columnas
equivocadas.
