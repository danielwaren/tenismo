# Fase 2 — cuotas reales y Paper Trading

## Lo que The Odds API es y no es

Verificado el 2026-07-22 con la key real:

- **No hay una clave "tenis"**: hay **41 claves de torneo**
  (`tennis_atp_wimbledon`, `tennis_wta_madrid_open`…). La cobertura son Grand
  Slams, Masters 1000 y algunos 500. **Los ATP/WTA 250 no están.**
- Hay **semanas enteras sin ningún torneo cubierto**. El día que se integró,
  los 41 estaban inactivos (entre Wimbledon y la gira americana).
- **El histórico no está en el plan gratuito** (401 explícito), así que no se
  puede reconstruir hacia atrás: las capturas empiezan a acumularse desde hoy.
- Cuota: listar deportes es gratis; cada consulta cuesta `markets × regions`
  = 1 crédito con `regions=eu&markets=h2h`. Por eso la ingesta **primero mira
  qué está activo** y solo pide cuotas de esos. En semana sin torneos: 0 créditos.

**Es también la única fuente de calendario futuro del proyecto**, porque
tennis-data.co.uk solo publica partidos ya jugados. Sin esta integración la app
no puede mostrar próximos partidos en absoluto.

## Resolución de nombres: el riesgo principal

The Odds API da nombres completos ("Alex de Minaur") y el histórico los da
abreviados ("De Minaur A."). Un emparejamiento equivocado metería la cuota de un
partido en otro y contaminaría el modelo sin dejar rastro.

`scripts/lib/players.ts` genera varias particiones candidatas del nombre en vez
de asumir que el primer token es el nombre de pila — así "Juan Martin del Potro"
encuentra a "Del Potro J.M.". Si nada casa, **no se adivina**: el evento se
guarda en `unmatched_events` para crear un alias a mano.

Verificado contra los 1.926 jugadores reales de la base
(`npx tsx scripts/check-names.ts`): **49 de 50 nombres resueltos, todos por slug
exacto** (ninguno por el fallback de apellido, que es el arriesgado). El único
fallo fue "Jean-Julien Rojer", que es doblista y no está en la base de
individuales — o sea que el resolutor se negó a adivinar cuando debía.

## Reconciliación

El mismo partido real llega dos veces: primero como `scheduled` desde The Odds
API (con las cuotas previas al cierre), y días después como `completed` desde
tennis-data (con el resultado). `scripts/reconcile.ts` los fusiona.

Criterio deliberadamente estricto: mismo circuito, misma **pareja de jugadores**
y menos de 3 días de diferencia. No se casa por nombre de torneo porque difieren
entre fuentes. Si un par jugó dos veces en la ventana, se deja sin fusionar para
revisión manual — adivinar sería peor que dejarlo pendiente.

## El simulador

`scripts/paper-trade.ts` coloca apuestas ficticias y las liquida. Kelly
fraccionado con tope duro, ventaja medida contra la implícita **devigada**, y
filtro de confianza que excluye los cold start.

Probado de punta a punta con un partido sintético: features → pronóstico →
apuesta → reconciliación → liquidación con CLV. El caso de prueba resultó
didáctico: **la apuesta ganó (+160% de ROI) pero el CLV salió negativo**
(se tomó 2,60 cuando el cierre fue 2,70). Ganar no significa haber acertado el
precio; por eso la métrica que manda es el CLV.

### Por qué nace en modo auditoría

`value_enabled = 0`. No es prudencia: el backtest sobre 9.861 partidos fuera de
muestra demostró que la ventaja declarada por el modelo es **anti-predictiva**
(ver [04-backtest-paper-trading.md](04-backtest-paper-trading.md)). El simulador
existe para medir CLV hacia adelante, que es la única hipótesis que queda viva:
capturando cuotas antes del cierre, ¿anticipa el modelo el movimiento de la
línea? Es una prueba más blanda que batir al cierre, y el dato para responderla
no se puede recuperar después.

## Orden del cron diario

El orden importa y no es arbitrario:

1. `db:ingest` — resultados nuevos de tennis-data.
2. `reconcile` — los programados que ya se jugaron pasan a su fila definitiva,
   arrastrando cuotas y apuestas. **Antes** de colocar nada nuevo.
3. `odds-ingest` — calendario futuro y captura de cuotas del día.
4. `db:elo` — Elo de los jugados y features de los programados.
5. `predict` — aplica los pesos guardados (no reajusta).
6. `paper-trade` — coloca y liquida.
7. `evaluate` — informe al log.

## Limitación conocida: rankings en partidos futuros

`rank_log_diff` y `points_log_diff` son la 3ª y 7ª feature por peso, pero la
fuente solo publica el ranking **junto con el resultado**. Para los partidos
futuros se arrastra el último ranking conocido de cada jugador. El ranking se
mueve despacio, así que es buen proxy, pero no es exacto justo después de un
torneo grande.
