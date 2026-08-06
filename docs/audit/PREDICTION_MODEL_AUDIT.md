# Auditoría del modelo predictivo

## Modelo real

Elo global/superficie por circuitos separados, K dinámico, features prepartido, regresión logística antisimétrica y motor Markov de servicio. El entrenamiento walk-forward evita look-ahead en ratings; el split train/valid/test es temporal. README reconoce que el modelo no supera al mercado.

| Severidad | Evidencia | Archivo/módulo | Impacto | Recomendación | Esfuerzo | Riesgo cambio | Prioridad |
|---|---|---|---|---|---|---|---|
| Alta | Métricas publicadas no están ligadas a hash de datos/código/artefacto | `fit-model.ts`, `model_fits`, README | Reproducibilidad insuficiente | Model card por versión: git SHA, dataset manifest, ventana, features, pesos, métricas | Medio | Bajo | P0 |
| Alta | Fuente TA scrapeada alimenta stats/Challenger y puede afectar Elo | `ta-ingest.ts`, `promote-challenger.ts`, `train-elo.ts` | Riesgo de procedencia y cambio de distribución | Congelar esa ruta hasta autorización; etiquetar lineage por fila/feature | Medio | Medio | P0 |
| Media | Confianza heurística no es intervalo probabilístico | modelo/UI | Usuario puede sobreinterpretar | Renombrar “cobertura/calidad de muestra” o calibrarla empíricamente | Bajo | Bajo | P1 |
| Media | No evidencia de calibración segmentada robusta ATP/WTA/superficie/nivel/año | evaluación | Sesgos ocultos | Brier/logloss/ECE con IC bootstrap por segmento y drift temporal | Medio | Bajo | P1 |
| Media | Odds son benchmark y feature indirecta de decisión, pero vig/snapshot requieren contrato | odds/evaluate/paper | Edge inflado | Quitar margen por mercado y registrar timestamp/cierre/proveedor | Medio | Medio | P1 |
| Media | Paper backtest puede inducir selección múltiple/optimización retrospectiva | scripts paper | Riesgo de sobreajuste | Protocolo pre-registrado, holdout intocable, CLV primario | Bajo | Bajo | P1 |
| Baja | Antisimetría y tests unitarios son fortalezas | `packages/model/tests` | Reduce inconsistencias | Conservar invariantes en CI | Bajo | Bajo | P2 |

## Salida responsable

Mostrar probabilidad, cuota justa, versión, fecha de cálculo, cobertura de datos, calibración del segmento y riesgos. Nunca presentar “IA” o edge como recomendación garantizada.
