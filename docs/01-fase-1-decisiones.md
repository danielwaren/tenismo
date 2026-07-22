# Fase 1 — decisiones y hallazgos

## Decisiones de arquitectura

**Turso sin RLS ⇒ el navegador no toca la base.** En el proyecto de fútbol el
cliente leía Supabase directamente con la anon key, acotada por RLS. Aquí el
token de Turso da acceso total, así que el frontend es SSR (`output: 'server'`)
y las islas de React reciben los datos ya resueltos como props. No hay ninguna
variable `PUBLIC_*` de base de datos.

**Los crons viven en GitHub Actions, no en la base.** Turso no tiene `pg_cron`
ni `pg_net`. Se descartó Vercel Cron para el trabajo pesado: descargar los
ficheros de temporada, parsear miles de partidos y reentrenar el Elo no cabe en
el límite de tiempo de una función serverless del plan Hobby.

**Migraciones propias.** Sin CLI de Turso instalada, `scripts/migrate.ts` aplica
`db/migrations/*.sql` y lleva el control en la tabla `schema_migrations`.

## Decisiones de modelado

**Orden p1/p2 independiente del resultado.** La fuente publica Winner/Loser, no
"A vs B". Guardar los partidos en ese orden le enseñaría al modelo que "p1
siempre gana" — fuga de la variable objetivo. Cada partido se guarda con
`p1_id = min(winner_id, loser_id)` y la etiqueta `p1_won`. Las cuotas se mapean
al mismo orden.

*Efecto lateral detectado:* los ids de jugador se asignan por orden de primera
aparición, así que `p1` tiende a ser el jugador más veterano. p1 gana el **54,7%**
de los partidos (el mercado implica 53,5%). No es fuga del resultado, pero sí una
asimetría real: **en la Fase 4 hay que ajustar solo la pendiente de la
recalibración, no el intercepto**, o se acabaría horneando un "los veteranos
ganan" que además daría probabilidades incoherentes según qué jugador cayera en p1.

**Backtest walk-forward.** `train-elo` guarda la predicción con los ratings
previos al partido antes de actualizarlos. Sin esto, evaluar el modelo sobre su
propio entrenamiento no significaría nada.

**Retiradas y walkovers fuera del entrenamiento** (2.458 de 66.834): el resultado
no mide fuerza relativa. Se conservan en la base.

**Un jugador que estrena superficie parte de su Elo global, no de 1500** — ya
sabemos algo de él. Entra con `matches: 0`, así que ese rating pesa 0 hasta
acumular muestra.

## Hallazgos sobre los datos

**Los repos de Jeff Sackmann están caídos** (404 desde al menos 2026-07-22).
Detalle y verificación en [00-hallazgos-fuentes.md](00-hallazgos-fuentes.md).
Sustituidos por tennis-data.co.uk, que además trae cuotas de cierre reales.

**Errata de fecha en origen.** La final del Iasi Open 2026 viene fechada
`2029-07-20`. El parser detecta desfases de más de un año respecto a la
temporada, corrige el año y lo **reporta por consola** — nunca en silencio. El
desfase de exactamente un año sí es legítimo: hay torneos que empiezan a finales
de diciembre de la temporada anterior (288 partidos).

**Las cuotas de cierre son únicas por partido/casa/selección.** La clave única
original incluía `captured_at`, así que corregir la fecha de un partido duplicaba
sus cuotas. Arreglado con un índice único **parcial** (migración 002) que solo
restringe el histórico: las cuotas en vivo de The Odds API sí necesitarán varias
capturas por partido.

**La ingesta hace upsert, no `insert or ignore`.** La fuente corrige datos y esas
correcciones deben propagarse. Si cambia algún resultado hay que reentrenar con
`npm run db:elo -- --reset`: el Elo es incremental y no sabe deshacer.

**Solo temporadas 2013+.** Las anteriores están en `.xls` (formato binario BIFF,
otro parser entero) y no compensan: 13 temporadas × 2 circuitos ya son 66.834
partidos con cuotas.

## Qué queda abierto para las siguientes fases

- **El modelo no le gana al mercado** (Brier 0,219 vs 0,199). Hasta que se acerque,
  sus "edges" son ruido: el Paper Trading de la Fase 2 debe nacer apagado o
  restringido, igual que se hizo con `flagged_value` en el proyecto de fútbol.
- **Recalibración (Fase 4)**: el ajuste Platt fuera de muestra cierra el 19% de la
  brecha. Ajustar solo la pendiente, por lo dicho arriba sobre p1/p2.
- **Alias de jugadores**: la tabla `player_aliases` está creada pero vacía. Hará
  falta en la Fase 2 para cruzar los nombres completos de The Odds API
  ("Felix Auger-Aliassime") con los abreviados del histórico ("Auger-Aliassime F.").
  Lo que no case debe **registrarse, no adivinarse**.
- **Sin stats de saque/resto** en esta fuente ⇒ el modelo punto a punto (cadena de
  Markov) sigue sin fuente de datos.
- **Deriva de Elo**: los ratings del top inflan con el tiempo (Sinner 2662) porque
  entran jugadores nuevos en 1500 con K alto. No afecta a las probabilidades
  relativas, pero conviene vigilarlo si se comparan temporadas.
