# Torneos, calendario y marcadores en vivo

## Qué se pidió y qué es posible

Se pidió: torneos en vivo y próximos en el dashboard, página propia por torneo
con todas las rondas y predicciones, ATP **y Challenger**, y tarjetas de
partidos en vivo con etiqueta "VIVO" y marcador en directo.

Verificado antes de construir:

| Pieza | ¿Posible? | Por qué |
|---|---|---|
| Páginas de torneo con todas las rondas | **Sí** | 1.584 torneos en base; los Grand Slams traen 127 partidos y 7 rondas |
| Predicción por partido | **Sí** | ya calculada para todos los partidos |
| Torneos recientes / próximos | **Sí** | recientes desde la base; próximos desde los partidos programados |
| Marcadores en vivo + "VIVO" | **Sí, con límites** | The Odds API `/scores` funciona en free, pero solo de torneos cubiertos y cuando hay uno en curso |
| **Challenger** | **No** | **cero datos**: no está en tennis-data, no está en The Odds API, y los repos de Sackmann (que sí lo tenían) están caídos |

**Challenger es un muro de datos, no una decisión.** Sin historial de partidos no
hay Elo, y sin Elo no hay predicción. Inventar pronósticos sobre jugadores de los
que no existe ni un dato sería un fraude. Haría falta una fuente nueva (raspar la
web de la ITF/ATP Challenger, o una API de pago), que es un proyecto aparte.

## Marcadores en vivo

`scripts/scores-ingest.ts` consulta The Odds API `/scores` para los torneos
cubiertos activos y llena `live_scores`. Un partido en vivo YA existe en
`matches` como `scheduled` (lo creó odds-ingest con el mismo `event_id`), así que
aquí solo se añade el estado en vivo, casando por ese id — no se resuelven
nombres de cero.

Límites honestos, reflejados en la UI:

- **Marcador grueso**: sets ganados por jugador, no punto a punto. Es lo que
  expone el proveedor.
- **Solo torneos cubiertos**: Grand Slams, Masters 1000, algunos 500. Nada de
  Challenger ni 250.
- **Solo cuando hay uno en curso**. Ahora mismo no hay ninguno, así que la
  sección "En vivo" no se pinta.

El dashboard trae una tarjeta que se **auto-refresca cada 30 s** consultando
`/api/live` (sin recargar la página), con etiqueta "VIVO" pulsante, marcador y el
pronóstico del modelo.

### Coste de cuota (clave)

`scores-ingest` llama primero a `/sports` (GRATIS) y **solo pide `/scores` si hay
un torneo cubierto activo**. Por eso el workflow `en-vivo.yml` puede correr cada
30 minutos gastando **cero créditos** fuera de un torneo grande.

Durante un Grand Slam sí gasta ~1-2 créditos por corrida; a 30 min, dos semanas
de torneo se acercan o pasan los 500 créditos/mes del plan gratis. El workflow lo
documenta y da las salidas: subir el intervalo o desactivarlo y quedarse con el
refresco diario.

## Verificación

- Página de torneo (`/tournament/35`, ATP Wimbledon 2026): las 7 rondas en orden,
  de 1ª ronda a la final, con predicción por partido.
- Flujo en vivo probado con un partido sintético (Alcaraz 2-1 Sinner): la API
  `/api/live` lo devolvió, el dashboard pintó la tarjeta "VIVO" con marcador y
  pronóstico, y apareció en "Torneos en vivo". Dato sintético borrado después.
- Build limpio, 69 tests verde.
