# Fase 3 — frontend

Seis páginas SSR sobre Turso, con las islas de React recibiendo los datos ya
resueltos (la base no es accesible desde el navegador).

## Páginas

- **Dashboard** (`/`) — tarjetas de cobertura, próximos partidos (con vacío
  explicado cuando no hay torneo cubierto), aviso de Paper Trading y buscador.
- **Ranking** (`/ranking`) — Elo por circuito y superficie, en pestañas.
- **Ficha de partido** (`/match/[id]`) — pronóstico, modelo vs mercado,
  contribución de cada factor, explicación en palabras y cuotas reales.
- **Paper Trading** (`/paper-trading`) — banca, ROI, CLV y tabla de apuestas
  simuladas, encabezado por el aviso de modo auditoría.
- **Calibración** (`/calibracion`) — Brier/log-loss/skill vs mercado, diagrama
  de fiabilidad en SVG y pesos del modelo.
- **Guía** (`/guia`) — cómo funciona el modelo, qué es el CLV y los límites,
  con las cifras reales interpoladas desde la base.

## Decisiones

**La explicación en palabras se sintetiza, no se guarda.** Solo la línea base
Elo escribía frases en `model_outputs.explanation`; el modelo con features no.
En vez de duplicar texto en la base, la ficha genera las frases a partir de las
contribuciones que ya calcula (valor × peso), así siempre corresponden al modelo
activo. Ver `explainFromContributions` en `src/lib/queries.ts`.

**La contribución de cada factor es la explicación de verdad.** Para cada
partido se multiplica el valor de la feature por el peso del ajuste y se ordena
por magnitud. Es lo que de verdad movió el logit, no una racionalización.

**Honestidad en la UI, no solo en los docs.** La ficha, la calibración y la
guía repiten que el modelo pierde contra el cierre y que una diferencia grande
suele indicar que se equivoca el modelo. El aviso no se esconde en un footer.

## Bug de producción encontrado al verificar

`db()` leía `process.env`, pero **Astro/Vite no copia las variables sin prefijo
PUBLIC_ a process.env** en el servidor SSR. Resultado: `astro dev` no veía
TURSO_* y caía a la base local en silencio — lo delató el aviso que se había
añadido en la Fase 1.5 justo para esto.

No se arregla exponiendo TURSO al `envPrefix` de Vite: eso metería el token en
el bundle del cliente. La solución es cargar `.env` en `process.env` desde el
módulo solo-servidor `db.ts` (`process.loadEnvFile`), que en Vercel no hace nada
porque allí las variables ya están en el entorno.

## Nota operativa

Las migraciones 005 y 006 se habían aplicado solo a la base local durante la
Fase 2. Se aplicaron a Turso al montar el frontend (la página de Paper Trading
las necesita). Recordatorio: `npm run db:migrate` hay que correrlo contra Turso,
no solo contra el fichero local.

## Verificación

Build limpio, 69 tests verde, y las seis páginas comprobadas en el navegador
contra los datos reales de Turso (66.834 partidos). La ficha de ejemplo
—Osorio vs Raducanu, Hobart 2026— muestra el modelo dando 65% a Raducanu frente
al 72% del mercado, con el aviso de que la discrepancia probablemente es error
del modelo. Los screenshots del navegador dan timeout en este entorno; la
verificación fue por lectura de la página renderizada.
