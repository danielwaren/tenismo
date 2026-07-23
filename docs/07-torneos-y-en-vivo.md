# Torneos, calendario y marcadores en vivo

## Corrección tras el primer intento: ESPN es la fuente, no The Odds API

El primer montaje sacaba el calendario y los marcadores de The Odds API. Estaba
mal por dos razones que el usuario señaló:

1. The Odds API no cubre los torneos 250, así que los torneos que se jugaban ese
   día (Estoril, Kitzbühel, Hamburgo, Praga, Palermo) **no aparecían por ningún
   lado**.
2. El proyecto de fútbol ya sacaba los marcadores en vivo de **ESPN**, que es
   gratis, sin cuota, con marcador set por set y con mucha más cobertura.

Ahora el calendario, los torneos en curso y los marcadores en vivo salen de
**ESPN** (`site.api.espn.com/apis/site/v2/sports/tennis/{atp,wta}/scoreboard`).
The Odds API queda **solo** para las cuotas reales que necesita el Paper Trading.

Verificado en real (2026-07-22): ESPN devolvió los 5 torneos en curso con 22
partidos próximos resueltos contra nuestra base y con predicción, todos en
arcilla. Los que no resuelven (29) son clasificados y jugadores sin historial;
se descartan, no se inventan.

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
| Torneos en curso, incluidos 250 | **Sí** | ESPN los da todos (Estoril, Kitzbühel, Hamburgo, Praga, Palermo…) |
| Marcadores en vivo + "VIVO" | **Sí** | ESPN da marcador set por set de ATP y WTA, gratis |
| **Challenger** | **No** | **cero datos en NINGUNA fuente**: no está en tennis-data, ni en The Odds API, ni en ESPN (rutas challenger dan 400), y los repos de Sackmann están caídos |

**Challenger es un muro de datos, no una decisión.** Se comprobó en las tres
fuentes: ninguna lo tiene. Sin historial de partidos no hay Elo, y sin Elo no
hay predicción. Inventar pronósticos sobre jugadores de los que no existe ni un
dato sería un fraude. Haría falta una fuente nueva (raspar la web de la ATP
Challenger/ITF, o una API de pago), que es un proyecto aparte.

## Marcadores en vivo y calendario (ESPN)

`scripts/espn-ingest.ts` lee los scoreboards de ATP y WTA de ESPN y hace tres
cosas:

- **Torneos en curso**: crea/actualiza el torneo. Intenta enlazarlo con uno
  existente de la misma temporada por coincidencia de palabra distintiva
  (Estoril, Hamburg…); si no, lo crea.
- **Calendario**: por cada partido `pre` (próximo) o `in` (en vivo) de
  individuales, resuelve los dos jugadores contra nuestra base y crea un partido
  `scheduled`. Los `post` (terminados) NO se importan como resultado: tennis-data
  sigue siendo la fuente de verdad de los completados, para no contaminar el Elo.
- **Marcadores en vivo**: por cada partido `in`, llena `live_scores` con el
  marcador set por set, orientado al orden p1/p2 de la base.

**Dedup**: antes de crear un partido comprueba si ya existe uno `scheduled` con
la misma pareja y fecha (±3 días). Así, durante un torneo cubierto, no duplica el
partido que odds-ingest ya creó desde The Odds API — le adjunta el marcador.

Límites honestos, reflejados en la UI:

- **Solo individuales** (los dobles se descartan por slug de grouping).
- **ATP y WTA de circuito principal, incluidos los 250**. Nada de Challenger:
  ESPN tampoco lo tiene.
- **Solo cuando hay torneos en curso**.

El dashboard trae una tarjeta que se **auto-refresca cada 30 s** consultando
`/api/live`, con etiqueta "VIVO" pulsante, marcador set por set, indicador del
líder por sets ganados y el pronóstico del modelo.

### Sin coste de cuota

ESPN es gratis y sin límite de peticiones conocido, así que `en-vivo.yml` corre
cada 15 minutos sin gastar créditos de ninguna API de pago. The Odds API se
reserva para las cuotas del Paper Trading, no para el calendario ni los
marcadores.

## Verificación

- Página de torneo (`/tournament/35`, ATP Wimbledon 2026): las 7 rondas en orden,
  de 1ª ronda a la final, con predicción por partido.
- Flujo en vivo probado con un partido sintético (Alcaraz 2-1 Sinner): la API
  `/api/live` lo devolvió, el dashboard pintó la tarjeta "VIVO" con marcador y
  pronóstico, y apareció en "Torneos en vivo". Dato sintético borrado después.
- Build limpio, 69 tests verde.
