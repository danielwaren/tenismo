# Backtest del Paper Trading — la ventaja del modelo es anti-predictiva

Antes de conectar The Odds API se probó el simulador contra las cuotas reales
que ya teníamos: 9.861 partidos de 2024-2026 (fuera de muestra), con la
probabilidad justa devigada de Pinnacle y ejecución al mejor precio del mercado.

## Resultado

Banca inicial 100, cuarto de Kelly, tope 2% por apuesta, confianza mínima 0,5.

| Ventaja mínima exigida | Apuestas | Ventaja **declarada** | **ROI real** |
|---|---|---|---|
| 2% | 2.839 | 9,34% | −5,16% |
| 5% | 2.645 | 11,44% | −4,97% |
| 10% | 2.465 | 15,36% | −6,48% |
| 15% | 991 | 20,11% | **−7,80%** |

Con el umbral por defecto la banca pasa de 100 a **0,50**: ruina prácticamente
total, con una caída máxima del 99,7%.

## Lo importante no es que pierda, es CÓMO pierde

**Cuanta más ventaja declara el modelo, más dinero se pierde.** La relación es
monótona en la práctica: exigir 15% de ventaja en vez de 2% empeora el ROI de
−5,16% a −7,80%.

Si la "ventaja" contuviera información, subir el listón debería mejorar el
resultado — estaríamos quedándonos con las mejores oportunidades. Que lo
empeore significa lo contrario: **filtrar por mayor desacuerdo con el mercado
selecciona los partidos donde el modelo está más equivocado**, no aquellos donde
sabe algo que el mercado ignora.

Es lógico visto lo de la Fase 1.5: el modelo está peor calibrado que el mercado
(Brier 0,2159 frente a 0,2027). Cuando dos estimadores discrepan y uno es peor,
la discrepancia grande casi siempre viene del peor.

## No es el margen de la casa

Margen medio por casa en el mismo periodo:

| Casa | Margen |
|---|---|
| market_max (mejor precio disponible) | **1,33%** |
| pinnacle | 2,79% |
| bet365 | 5,21% |
| market_avg | 5,70% |

Apostando a ciegas al mejor precio se perdería en torno al 1,3%. El modelo
pierde entre 5,2% y 7,8%, o sea que **destruye entre 4 y 6,5 puntos por encima
del coste de operar**. Las selecciones no son neutras: son activamente peores
que seguir al mercado.

## Consecuencias

1. **`value_enabled` se queda en 0.** No es una precaución conservadora, es lo
   que dicen los datos.
2. **Ajustar el umbral de ventaja no lo arregla.** Es la conclusión más útil del
   experimento: ahorra el tiempo que se habría ido en buscar el filtro mágico.
3. **Cualquier panel que muestre "ventaja" debe mostrar esto al lado.** Enseñar
   un 15% de ventaja sin decir que históricamente eso predice perder un 7,8% es
   engañoso, aunque el número sea correcto.

## Lo que este backtest NO responde

Se apuesta a la cuota de **cierre**, así que el CLV es cero por construcción y no
se mide. Queda abierta una pregunta distinta: capturando cuotas **antes** del
cierre, ¿anticipa el modelo el movimiento de la línea? Es una prueba más blanda
y solo puede hacerse hacia adelante, acumulando capturas diarias.

Dado el resultado de arriba, la expectativa razonable es que tampoco, pero es la
única hipótesis que queda viva y el dato que la respondería no se puede
recuperar más tarde: el histórico solo trae cierres.

## Reproducirlo

```bash
npx tsx scripts/paper-backtest.ts
npx tsx scripts/paper-backtest.ts --min-edge 0.15 --book market_max
npx tsx scripts/paper-backtest.ts --book pinnacle
```
