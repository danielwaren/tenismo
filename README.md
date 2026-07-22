# Tennis Trader Intelligence

App hermana de `sports-trader-intelligence` (fútbol), para tenis: Elo por
superficie de ATP y WTA, contrastado contra cuotas reales de cierre.

**Herramienta de análisis y auditoría.** No ejecuta apuestas, no se conecta a
ninguna casa y no gestiona dinero real. El Paper Trading (Fase 2) usa dinero
simulado y cuotas reales.

## Stack

| Pieza | Elección | Nota |
|---|---|---|
| Frontend | Astro + React (islands) + Tailwind | mismo patrón que el proyecto de fútbol |
| Base de datos | **Turso (libSQL/SQLite)** vía `@libsql/client` | no Supabase |
| Trabajos programados | **GitHub Actions** | Turso no tiene pg_cron ni Edge Functions |
| Despliegue | Vercel | `output: 'server'` |

### Qué cambia respecto al proyecto de fútbol

- **Sin RLS.** El token de Turso da acceso total. El navegador NUNCA habla con
  la base: todo pasa por páginas SSR y API routes. (En fútbol el cliente sí leía
  Supabase, protegido por RLS.)
- **Sin cron en la base.** No hay `pg_cron` ni `pg_net`: la ingesta y el
  reentrenamiento los dispara `.github/workflows/ingesta-diaria.yml`.
- **Sin empate.** El resultado es binario, así que la logística Elo da
  directamente la probabilidad final — sin el término de empate ni la localía
  que necesitaba el 1X2 del fútbol.

## Puesta en marcha

```bash
npm install
cp .env.example .env      # por defecto usa un fichero local, sin cuenta Turso
npm run db:migrate        # crea el esquema
npm run db:ingest         # descarga e ingiere 2013..año actual (ATP + WTA)
npm run db:elo            # entrena el Elo y guarda el backtest
npm run dev
```

Para trabajar contra Turso en vez del fichero local, basta con cambiar
`TURSO_DATABASE_URL` y añadir `TURSO_AUTH_TOKEN`: el resto del código es idéntico.

### Comandos

| Comando | Qué hace |
|---|---|
| `npm run db:migrate` | aplica `db/migrations/*.sql` una sola vez |
| `npm run db:ingest` | descarga e ingiere temporadas (`--from`, `--to`, `--tour`, `--force`) |
| `npm run db:elo` | entrena el Elo y calcula features (incremental; `--reset` reentrena todo) |
| `npx tsx scripts/fit-model.ts` | ajusta los pesos y los evalúa fuera de muestra |
| `npx tsx scripts/predict.ts` | aplica los pesos guardados a los partidos sin predicción |
| `npx tsx scripts/evaluate.ts` | compara el modelo contra la cuota de cierre |
| `npm test` | tests del modelo (`@tti/model`) |

Ajustar y predecir están separados a propósito: el cron diario **solo predice**.
Reajustar a diario cambiaría el modelo en silencio y las métricas dejarían de ser
comparables entre días.

## Datos

Fuente histórica: **tennis-data.co.uk** (ATP 2013–2026, WTA 2013–2026 en `.xlsx`).
Trae resultado, superficie, ronda, ranking, marcador por set **y cuotas de cierre
reales** de Pinnacle, Bet365 y media/máximo del mercado.

Los repos de Jeff Sackmann, que eran la fuente prevista, devuelven 404 desde al
menos julio de 2026 — ver [docs/00-hallazgos-fuentes.md](docs/00-hallazgos-fuentes.md).

Estado actual de la base local: **66.834 partidos**, 64.366 completados,
526.398 cuotas de cierre (99,9% de los partidos con cuota), 1.926 jugadores.

## El modelo

`@tti/model` — TypeScript puro, sin dependencias, testeado con vitest (43 tests).

Elo por superficie **como feature** de una regresión logística:

- **Elo logístico binario**: `P(gana A) = 1 / (1 + 10^((eloB - eloA)/400))`.
- **K dinámico** (parametrización de FiveThirtyEight para tenis):
  `k = 250 / (partidos + 5)^0.4`, escalado por categoría de torneo y por ronda.
- **Rating por superficie encogido hacia el global**: el peso de la superficie es
  `n / (n + 20)` con tope 0,75. Tres partidos afortunados en hierba no convierten
  a nadie en especialista.
- **13 features** encima: ranking oficial, head-to-head encogido, carga e
  intensidad recientes, descanso, forma, experiencia y la interacción con el
  formato al mejor de 5.
- **Sin término independiente**: todas las features son diferencias orientadas a
  p1, así que el modelo es antisimétrico — intercambiar a los jugadores devuelve
  exactamente `1-p`.
- **Confianza 0..1** según el historial del jugador con menos partidos y la
  muestra en esa superficie. Gobierna qué partidos son aptos para Paper Trading.

ATP y WTA son **pools de Elo separados**: nunca se enfrentan, así que sus ratings
no son comparables entre circuitos.

### Backtest sin look-ahead

`train-elo` recorre los partidos en orden cronológico y, en cada uno, guarda la
predicción calculada con los ratings **previos** al partido antes de
actualizarlos. `model_outputs` es por tanto un backtest walk-forward legítimo.

### Resultados fuera de muestra (test 2024–2026, 9.862 partidos con cuota)

Train hasta 2022, validación 2023 (solo para elegir el L2), test de 2024 en
adelante — nunca usado para ajustar nada. El reparto es por temporada, no
aleatorio.

| | Elo solo | Con features | Mercado |
|---|---|---|---|
| Brier | 0,2233 | **0,2159** | 0,2027 |
| LogLoss | 0,6380 | **0,6197** | 0,5890 |
| Acierto del favorito | 63,3% | **64,4%** | 68,0% |

Las features cierran el **36%** de la distancia al mercado (la recalibración
Platt sola cerraba el 19%), y la calibración queda prácticamente resuelta:
los desvíos del diagrama de fiabilidad bajan de ±0,09 a ±0,02.

**Aun así el modelo NO le gana al mercado**, y así hay que leerlo: sus "edges"
todavía no son value demostrado. Si se monta el Paper Trading de la Fase 2, debe
nacer con el flag de value apagado y servir para medir CLV, no para buscar
ganancia. Detalle en [docs/03-fase-1-5-modelo.md](docs/03-fase-1-5-modelo.md).

## Fases

1. **Cimientos** — esquema, scaffold, ingesta histórica, Elo por superficie. ✅
1.5. **Modelo** — features (ranking, h2h, fatiga, forma, K por ronda) y ajuste
   logístico evaluado fuera de muestra. ✅
2. **Cuotas reales + Paper Trading** — The Odds API, simulador binario.
3. **Frontend** — dashboard, ficha de partido, ranking, buscador.
4. **Calibración** — en buena parte resuelta ya en la 1.5; queda revisarla
   cuando haya muestra de partidos futuros reales.

Puesta en producción (GitHub + Turso): [docs/02-git-y-turso.md](docs/02-git-y-turso.md).
