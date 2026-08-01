# Fase 4 — Capa de pronósticos "PICK1": arquitectura, motor matemático y UX

Documento de diseño. **No es un informe de lo construido**: describe lo que habría
que construir sobre lo que ya existe (Fases 1–3.5) para llegar a una app de picks
de valor estilo PICK1.

---

## 0. Realidad antes del diseño (leer primero)

Tres restricciones del proyecto actual condicionan todo lo que sigue. Ignorarlas
produciría un diseño bonito e inservible.

### 0.1 El modelo hoy NO tiene ventaja. Su "ventaja" es anti-predictiva

Backtest de Fase 2, 9.861 partidos fuera de muestra con cuotas reales
(probabilidad justa = Pinnacle devigado, ejecución = mejor precio del mercado):

| Umbral de EV mínimo | ROI |
|---|---|
| 2 % | −5,16 % |
| 5 % | −6,4 % |
| 15 % | −7,80 % |

Banca 100 → 0,50. **Cuanta más ventaja declara el modelo, más pierde**: filtrar por
desacuerdo con el mercado selecciona justamente los partidos donde el modelo está
más equivocado. El margen de la casa al mejor precio es solo 1,33 %, así que no es
la comisión: es el modelo.

Consecuencia de diseño, no negociable:

> El "Gran Pick del Día" construido hoy con el criterio `EV > 0,05` sería una
> máquina de perder dinero con presentación premium. La capa PICK1 se construye
> con el interruptor `value_enabled = 0` y **solo se enciende cuando el CLV
> (Closing Line Value) medio sea positivo y estadísticamente distinguible de cero**
> sobre una muestra prospectiva. Ver §5.5 (Gate de publicación).

Hasta entonces la app es de **análisis y paper trading**, y lo dice en la UI —
como ya hace la página `/calibracion`.

### 0.2 Las stats de saque SÍ existen: están en tennisabstract.com (verificado 2026-07-31)

Lo que estaba caído eran los **repos de GitHub** de Jeff Sackmann
(`tennis_atp`, `tennis_wta`, `tennis_pointbypoint` → 404). **La web
tennisabstract.com está viva, actualizada y sirve los mismos datos**, incluidas las
estadísticas de saque y resto que faltaban. Comprobado con peticiones reales, no
supuesto:

| Fuente | Resultado / cuotas | Stats saque-resto | Challenger | ITF |
|---|---|---|---|---|
| tennis-data.co.uk | ✅ (+cuotas de cierre) | ❌ | ❌ | ❌ |
| ESPN scoreboard | ✅ marcador set a set | ❌ `statistics: []` | ❌ 400 | ❌ |
| The Odds API | ✅ cuotas (41 claves) | ❌ | ❌ | ❌ |
| **tennisabstract.com** | ✅ resultado + ranking | ✅ **9 campos por jugador** | ✅ **con stats** | ⚠️ resultado sí, stats no |

Esto **anula la conclusión anterior de "Challenger = imposible"** y desbloquea el
motor Markov y el mercado de Aces. La especificación completa de la fuente está en
§1.5. Lo que sigue marcado con 🔒 depende de dos permisos que no son técnicos
(robots.txt en WTA y licencia de uso, §1.5.5), no de que el dato exista.

Lo que sigue sin existir: **ITF Futures (M15/M25) tiene resultados pero no stats**
(verificado: 96 partidos ITF de Bellucci, 0 con `svpt`). En ITF hay Elo, no hay
Markov ni Aces.

### 0.3 Lo que sí existe y no hay que reconstruir

Turso `tenismo`: 66.834 partidos, 526.398 cuotas, 64.366 features + predicciones,
Elo por superficie, regresión logística de 13 features (Brier 0,2159 vs mercado
0,2027), paper trading, calendario y marcadores en vivo vía ESPN, 6 páginas SSR.
La capa PICK1 se apoya en eso; no lo sustituye.

---

## 1. Entregable 1 — Esquema técnico de la arquitectura

### 1.1 Flujo de datos

```
┌─ L0 · FUENTES ────────────────────────────────────────────────────────────────┐
│                                                                               │
│  tennis-data.co.uk      ESPN site.api          The Odds API    tennisabstract │
│  ├ ATP 2000-2026        ├ /tennis/atp          ├ /sports (free) ├ ace, df     │
│  ├ WTA 2007-2026        ├ /tennis/wta          ├ /odds (1 créd) ├ svpt,1stIn  │
│  ├ resultado + sets     ├ calendario           └ 41 claves      ├ 1st/2ndWon  │
│  └ CUOTAS DE CIERRE     ├ marcador set a set                    ├ SvGms       │
│    (PSW/PSL/B365/Max)   └ estado pre/in/post                    ├ bpSaved/Fcd │
│         │                      │                     │          └ Challenger  │
│    (autoridad de           (calendario          (cuotas para          │        │
│     RESULTADOS)            y en vivo)            paper trading)   (§1.5)       │
└─────────┼──────────────────────┼─────────────────────┼──────────────────┼─────┘
          ▼                      ▼                     ▼                  ▼
┌─ L1 · INGESTA (scripts/, tsx + GitHub Actions) ───────────────────────────────┐
│  ingest-history.ts   espn-ingest.ts   odds-ingest.ts   ta-ingest.ts (§1.5)    │
│                                                                               │
│  Reglas transversales:                                                        │
│   · UPSERT siempre (la fuente corrige datos a posteriori)                     │
│   · Resolución de nombres por slug + particiones candidatas; lo que no casa    │
│     va a `unmatched_events`, NUNCA se adivina                                  │
│   · Reconciliación programado→jugado: circuito + pareja + ≤3 días              │
│     (nunca por nombre de torneo: difiere entre fuentes)                       │
│   · AUTORIDAD DE FUENTE: solo `source='tennis-data'` entrena Elo. Los `post`   │
│     de ESPN son display; reconcile los retira cuando tennis-data publica.      │
│   · Reintentos solo ante fallo de red (scripts/lib/batch.ts); SQL se propaga.  │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                ▼
┌─ L2 · ALMACÉN · Turso (libSQL/SQLite) ────────────────────────────────────────┐
│  EXISTENTE: tours players player_aliases tournaments matches odds             │
│             match_features model_fits model_outputs live_scores               │
│             paper_bets paper_bankroll unmatched_events schema_migrations      │
│  NUEVO §1.3: 🔒 match_stats  🔒 player_serve_profiles  court_pace             │
│             market_lines  market_projections  picks  pick_grades  pick_copy   │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                ▼
┌─ L3 · MOTOR MATEMÁTICO (packages/model, TypeScript puro y testeable) ─────────┐
│                                                                               │
│  (a) elo.ts        Elo dinámico: decay temporal · K por ronda · margen de      │
│                    victoria · global + superficie + reciente 3m               │
│  (b) features.ts   13 features actuales  →  + markovLogit (nueva, §2.5)       │
│  (c) logreg.ts     IRLS + L2, sin intercepto (antisimetría) → P(gana p1)      │
│  (d) 🔒 serve.ts   f_i, g_i por superficie con encogimiento bayesiano →       │
│                    p_a, p_b ajustados por rival, superficie y CPI             │
│  (e) 🔒 markov.ts  juego → tiebreak → set → partido (cerrado + recursión)     │
│  (f) 🔒 sim.ts     distribución conjunta: total de juegos, hándicaps,          │
│                    ganador set 1, total de puntos (recursión exacta + MC)     │
│  (g) 🔒 aces.ts    Binomial Negativa sobre λ = N̂_saque × tasa ajustada        │
│  (h) devig.ts      cuota → probabilidad justa (Shin / potencia, no simple)    │
│  (i) value.ts      EV, Kelly fraccional, tiers, gate de publicación           │
│  (j) copy.ts       reseña redactada DETERMINISTA desde contribuciones         │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                ▼
┌─ L4 · API / SSR (Astro) ──────────────────────────────────────────────────────┐
│  /api/picks/today   /api/picks/[id]   /api/match/[id]   /api/live   /api/search│
│  El token de Turso NUNCA sale al navegador (no hay RLS: el control vive aquí). │
│  `getLiveNow()` consulta ESPN en la petición (caché 12 s), no en el cron.      │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                ▼
┌─ L5 · UI (Astro + islas React) ───────────────────────────────────────────────┐
│  Home PICK1 · Ficha de partido · Perfil de jugador · Calendario · Paper       │
│  trading · Calibración (la honestidad va EN la UI)                            │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Planificación de trabajos (GitHub Actions — no hay pg_cron en Turso)

| Workflow | Cadencia | Hace |
|---|---|---|
| `historico.yml` | lun 04:00 UTC | tennis-data → ingesta → `train-elo` → `predict` |
| `calendario.yml` | cada 6 h | `espn-ingest` (torneos, cuadros, programados) |
| `cuotas.yml` | cada 3 h **solo si hay torneo activo** | `/sports` gratis primero, luego `/odds` |
| `en-vivo.yml` | cada 15 min | ESPN scoreboard → `live_scores` (contadores) |
| `ta.yml` | diario 05:00 | `ta-ingest` (solo jugadores con partido reciente, 6 s entre peticiones) → `match_stats` → `player_serve_profiles` |
| `picks.yml` | diario 07:00 + 13:00 | motor → `market_projections` → `picks` → copy |
| `resultados.yml` | diario 23:30 | liquidar `picks` y `paper_bets`, recalcular CLV |
| `ajuste.yml` | mensual, manual | `fit-model` (NUNCA a diario: cambiaría el modelo en silencio) |

Regla ya establecida y que se mantiene: **ajustar y predecir van separados**.
`fit-model.ts` guarda pesos en `model_fits`; `predict.ts` los aplica y valida que
`FEATURE_NAMES` del código coincida con el ajuste guardado.

### 1.3 Tablas nuevas (DDL propuesto, migraciones 008–011)

```sql
-- 008_match_stats.sql  — se llena desde tennisabstract (§1.5), columnas 21-38
create table if not exists match_stats (
  match_id        integer not null references matches(id) on delete cascade,
  player_id       integer not null references players(id),
  serve_points    integer,   -- puntos jugados al saque
  serve_won       integer,
  first_in        integer,   -- 1os saques dentro
  first_won       integer,
  second_won      integer,   -- 2os puntos ganados (2os = serve_points - first_in)
  aces            integer,
  double_faults   integer,
  bp_faced        integer,
  bp_saved        integer,
  return_points   integer,
  return_won      integer,
  source          text not null,       -- autoridad de la fila
  ingested_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (match_id, player_id)
);

-- Perfil agregado con encogimiento; se recalcula, no se acumula a mano.
create table if not exists player_serve_profiles (
  player_id     integer not null references players(id),
  surface       text not null,          -- 'Hard'|'Clay'|'Grass'|'Indoor'|'ALL'
  as_of         text not null,          -- fecha de corte (walk-forward)
  n_matches     integer not null,
  n_serve_pts   integer not null,
  spw           real not null,          -- f_i : % puntos ganados al saque (encogido)
  rpw           real not null,          -- g_i : % puntos ganados al resto (encogido)
  ace_rate      real,                   -- aces / punto de saque
  ace_against   real,                   -- aces concedidos / punto de resto
  df_rate       real,
  bp_save_rate  real,
  bp_conv_rate  real,
  tb_win_rate   real,                   -- forma bajo presión
  primary key (player_id, surface, as_of)
);

-- 009_court_pace.sql — CPI estimado, no comprado
create table if not exists court_pace (
  tournament_id integer not null references tournaments(id),
  season        integer not null,
  cpi           real,        -- índice normalizado 0..100 (§2.7)
  hold_rate     real,        -- % juegos al saque ganados en el torneo
  ace_rate      real,
  n_matches     integer,
  primary key (tournament_id, season)
);

-- 010_markets.sql
create table if not exists market_lines (      -- lo que ofrece el mercado
  id           integer primary key autoincrement,
  match_id     integer not null references matches(id) on delete cascade,
  market       text not null,   -- 'ML'|'GAMES_HCP'|'SETS_HCP'|'TOTAL_GAMES'
                                -- |'ACES_MATCH'|'ACES_PLAYER'|'SET1_WINNER'|'TOTAL_POINTS'
  selection    text not null,   -- 'p1'|'p2'|'over'|'under'
  line         real,            -- 3.5, 22.5, -4.5 … null en mercados sin línea
  player_id    integer,         -- solo mercados por jugador
  book         text not null,
  price        real not null,
  captured_at  text not null
);
create index if not exists idx_ml_match on market_lines(match_id, market);

create table if not exists market_projections (  -- lo que dice el modelo
  id             integer primary key autoincrement,
  match_id       integer not null references matches(id) on delete cascade,
  model_version  text not null,
  market         text not null,
  selection      text not null,
  line           real,
  player_id      integer,
  probability    real not null,      -- p̂
  mean           real,               -- λ o media proyectada (juegos, aces…)
  sd             real,
  method         text not null,      -- 'markov'|'nbinom'|'mc'|'logreg'
  computed_at    text not null,
  unique (match_id, model_version, market, selection, line, player_id)
);

-- 011_picks.sql
create table if not exists picks (
  id             integer primary key autoincrement,
  match_id       integer not null references matches(id),
  projection_id  integer not null references market_projections(id),
  pick_date      text not null,             -- día de publicación (UTC)
  is_top_pick    integer not null default 0, -- "Gran Pick del Día"
  tier           integer not null,          -- 1 | 2 | 3
  p_model        real not null,
  p_market_fair  real not null,             -- devigado (§2.8)
  price_taken    real not null,
  book           text not null,
  ev             real not null,
  kelly_full     real not null,
  stake_pct      real not null,             -- Kelly fraccional ya capado
  confidence     real not null,             -- 0..1 (§5.4)
  data_quality   real not null,             -- 0..1: completitud de los inputs
  value_enabled  integer not null default 0, -- 0 = informativo, no apostable
  status         text not null default 'open', -- open|won|lost|void
  closing_price  real,                      -- para CLV
  clv            real,
  pnl            real,
  published_at   text not null,
  settled_at     text
);
create index if not exists idx_picks_date on picks(pick_date, tier);

create table if not exists pick_copy (        -- reseña redactada + trazabilidad
  pick_id     integer primary key references picks(id) on delete cascade,
  headline    text not null,
  reasoning   text not null,      -- 3–4 oraciones
  drivers     text not null,      -- JSON: [{feature, value, weight, contrib}]
  generator   text not null,      -- 'deterministic-v1' | 'llm-polish-v1'
  created_at  text not null
);
```

### 1.4 Fuentes descartadas y por qué

- **Repos GitHub de Sackmann** (`tennis_atp`, `tennis_wta`, `tennis_pointbypoint`):
  404. La web los sustituye por completo.
- **`tennis_MatchChartingProject`** (único repo suyo vivo): punto a punto real,
  pero muestra pequeña y sesgada por voluntarios. Sirve para **validar** el motor
  Markov contra secuencias reales de puntos, no para alimentarlo a diario. La
  columna 40 de `matchmx` da el id del partido charteado, así que el enlace es
  directo.
- **Sofascore / Flashscore**: endpoints internos no publicados; cambian sin aviso.
  Innecesarios ahora que Tennis Abstract cubre el hueco.
- **APIs de pago** (Sportradar, Goalserve, api-tennis): siguen siendo la opción si
  el proyecto se monetiza y la licencia de §1.5.5 lo impide.

---

## 1.5 Especificación de la fuente: tennisabstract.com

Todo lo de esta sección está **verificado con peticiones reales el 2026-07-31**,
no inferido.

### 1.5.1 Endpoints

| Circuito | URL | Estado |
|---|---|---|
| ATP | `https://www.tennisabstract.com/cgi-bin/player-classic.cgi?p={NombreSinEspacios}` | ✅ `matchmx` **inline**, autocontenido (371–775 KB) |
| WTA | `https://www.tennisabstract.com/cgi-bin/wplayer-classic.cgi?p={NombreSinEspacios}` | ⚠️ renderiza, pero carga los datos de `/jsmatches/` (ver §1.5.5) |

El nombre es el nombre completo sin espacios ni acentos: `NovakDjokovic`,
`MattiaBellucci`, `ArynaSabalenka`.

Frescura verificada: Djokovic → último partido **2026-06-29** (SF Wimbledon);
Bellucci → **2026-06-22**. La web está al día.

La página ATP es autocontenida: solo carga jQuery, `navbar.js` y
`jsplayers/curr_rank_atp.js`. Los partidos vienen dentro del HTML.

### 1.5.2 Formato de `matchmx` — 48 columnas por partido

Mapeo **confirmado** contra dos partidos reales (Doha 2017 F Djokovic–Murray
6-3 5-7 6-4 → 16+15 = 31 juegos ✓; Wimbledon 2026 SF Djokovic–Sinner 6-4 6-4 6-4
→ 15+15 = 30 juegos, Sinner 1 BP en contra y lo salva ✓):

| Col | Campo | Col | Campo |
|---|---|---|---|
| 0 | fecha `YYYYMMDD` | 20 | minutos |
| 1 | torneo | **21** | **aces** (propio) |
| 2 | superficie | **22** | **dobles faltas** |
| 3 | nivel (ver 1.5.3) | **23** | **puntos al saque** (`svpt`) |
| 4 | `W` / `L` | **24** | **1os saques dentro** |
| 5 | ranking propio | **25** | **puntos ganados con 1º** |
| 6 | cabeza de serie | **26** | **puntos ganados con 2º** |
| 7 | entrada (`WC`/`Q`/`LL`) | **27** | **juegos al saque** |
| 8 | ronda | **28** | **BP salvados** |
| 9 | marcador | **29** | **BP afrontados** |
| 10 | al mejor de (3/5) | **30–38** | **idem del rival** |
| 11 | nombre del rival | 39 | (sin identificar) |
| 12 | ranking del rival | 40 | id Match Charting Project |
| 13 | cabeza de serie rival | 43 | id torneo-partido |
| 14 | entrada rival | 47 | id TA del rival |
| 15 | mano del rival | | |
| 16 | fecha nacimiento rival | | |
| 17 | altura rival | | |
| 18 | país rival | | |

Las columnas 21–38 son **exactamente los 9 campos** que `match_stats` necesita
(§1.3), en el mismo orden. `spw = (1stWon + 2ndWon) / svpt` y
`rpw` sale del bloque del rival. Nada que estimar.

### 1.5.3 Cobertura real por nivel (medida, no prometida)

Códigos de nivel en la columna 3: `G` Grand Slam · `M` Masters · `A` ATP/WTA Tour ·
`C` Challenger · `D` Davis/BJK Cup · `S` exhibición · `15`/`25` ITF Futures.

| Jugador | Nivel | Partidos | Con stats |
|---|---|---|---|
| Bellucci (#96) | `C` Challenger | 167 | **167 (100 %)** |
| Bellucci | `A` ATP Tour | 63 | 63 (100 %) |
| Bellucci | `15`+`25` ITF | **96** | **0 (0 %)** |
| Djokovic | total carrera | 1.514 | 1.365 (90 %) |
| Djokovic | `C` Challenger (2005-06) | 36 | **0** |

Conclusiones:

- **Challenger con stats desde ≈2021**, incluida la **fase previa** (hay filas `Q1`
  con estadísticas completas). Los Challengers antiguos (2005) no las tienen.
- **ITF Futures: resultados sí, stats no.** En ITF se puede calcular Elo, no
  Markov ni Aces. La UI lo dirá.
- Rango de stats verificado: Bellucci 2021-11-01 → 2026-06-22.

Esto además **repara una limitación conocida** del proyecto: tennis-data solo da el
ranking junto al resultado; Tennis Abstract lo da por partido, con cabeza de serie
y tipo de entrada.

### 1.5.4 Trampas operativas (las tres muerden)

**1. Nombre desconocido → devuelve otro jugador, con HTTP 200.**
`player-classic.cgi?p=ArynaSabalenka` (una jugadora WTA pedida al endpoint ATP)
devolvió 605 KB de **Benoit Paire**. Sin error, sin 404. Es el mismo patrón que ya
costó un diagnóstico falso en este proyecto con el default silencioso de `db()`:
*un default que apunta a otro sitio no falla, miente.*

> Validación obligatoria en `ta-ingest.ts`: comparar `var fullname` de la respuesta
> con el nombre solicitado (normalizado) y **abortar la fila** si no coincide.
> Nunca ingerir por confianza en la URL.

**2. Cloudflare limita el ritmo.** A ~6 peticiones seguidas devuelve
`error code: 1015`. El ingester necesita:

```ts
// scripts/lib/ta-fetch.ts
const DELAY_MS = 6_000;          // ~10 jugadores/minuto
const MAX_RETRIES = 4;           // backoff exponencial 15s → 2min ante 1015/429
// + caché en disco por (jugador, día): no repedir lo ya bajado hoy
```

Con ~1.900 jugadores en la base actual, una carga completa son **≈3 h**. Después es
incremental: solo jugadores con partido reciente (~120/día ⇒ 12 min). Encaja en un
workflow diario sin acercarse al límite.

**3. El crawl es por jugador, no por partido**, así que **cada partido llega dos
veces** (una por cada ficha). Eso obliga a deduplicar por
`(fecha, jugadores, torneo)` — y regala una **validación cruzada gratis**: los
`svpt` de A vistos desde su ficha deben coincidir con los del bloque rival en la
ficha de B. Discrepancia ⇒ la fila va a `unmatched_events`, no a `match_stats`.

### 1.5.5 🔒 Los dos permisos que hay que resolver — no son técnicos

Esto es lo único que queda bloqueando, y **es decisión tuya, no mía**:

**a) `robots.txt` prohíbe justo el camino que necesita la WTA.**

```
User-agent: *
Disallow: /jsfrags/
Disallow: /jsmatches/
Disallow: /jsplayers/
```

`/cgi-bin/` **no** está prohibido, así que la ruta ATP (`player-classic.cgi`, datos
inline) es conforme. Pero `wplayer-classic.cgi` carga los partidos desde
`/jsmatches/`, que sí lo está. Opciones, en orden de preferencia:

1. **Escribir a Jeff Sackmann pidiendo permiso** para el uso automatizado. Es
   accesible, publica su contacto y lleva 15 años animando a investigadores a usar
   sus datos. Un correo de dos párrafos explicando el proyecto resuelve el punto
   (a) y el (b) a la vez. **Es la opción recomendada y debería ser el primer paso.**
2. Buscar una ruta WTA bajo `/cgi-bin/` que sirva los datos inline como la de ATP.
3. Lanzar solo con ATP y decirlo en la UI hasta tener respuesta.

**b) Licencia de uso.** El sitio no publica términos (verificado en la página
"About"). Los repos de Sackmann eran **CC BY-NC-SA 4.0 — no comercial**. Si esta
app va a cobrar por picks, hay conflicto y hace falta permiso explícito o una API
de pago. Si es de uso personal / no comercial, la atribución visible
("Datos: Tennis Abstract, Jeff Sackmann") es lo mínimo exigible, y hay que ponerla
en el pie de todas las páginas.

**Mi recomendación**: manda el correo. El ingester de ATP (ruta conforme) ya está
escrito y funcionando; el permiso decide si se puede añadir la WTA y si el
proyecto puede monetizarse.

### 1.5.6 Estado: ingester de ATP IMPLEMENTADO

`db/migrations/008_tennis_abstract.sql` · `scripts/lib/ta.ts` ·
`scripts/lib/ta.test.ts` (23 tests) · `scripts/ta-ingest.ts` · `npm run db:ta`

```bash
npm run db:ta -- --max 200      # rastrea 200 fichas y enlaza
npm run db:ta -- --link-only    # sin red: solo re-enlaza lo ya guardado
npm run db:ta -- --relink       # re-verifica también lo ya enlazado
```

**Cómo encuentra a los jugadores.** No hay índice bajo `/cgi-bin/` (el que existe
está en `/jsplayers/`, prohibido), así que el rastreo es en **bola de nieve**:
cada ficha nombra a todos los rivales de ese jugador y de ahí salen las
siguientes. Verificado: 14 semillas → 1.278 jugadores en la frontera a
profundidad 1, incluidos Challenger puros. Se autocorrige sola — una semilla mal
escrita (`AlexdeMinaur` en vez de `AlexDeMinaur`) solo cuesta una petición: el
nombre bueno aparece igualmente como rival en otra ficha.

**Regla de enlace con `matches`.** Circuito + pareja + ventana de 21 días +
**marcador**, y el marcador se comprueba SIEMPRE, no solo para desempatar.
La primera versión lo usaba únicamente cuando había varios candidatos y con un
candidato único enlazaba a ciegas: pegó un round robin de la Laver Cup (6-3 6-2)
a la final de Tokio (6-4 6-4), un partido de ATP Cup al Open de Australia y una
previa de Lyon al cuadro principal. 11 enlaces falsos de 1.464, y solo 3
detectables por colisión — los otros 8 habrían pasado inadvertidos.
*Un candidato único no es prueba de nada.*

**Resultado medido** (20 fichas, base local):

| | |
|---|---|
| partidos distintos vistos | 11.535 |
| con estadísticas | 9.703 |
| enlazados a `matches` | 5.694 |
| **vistos por las dos fichas** | **389** |
| **discrepancias entre ambas** | **0** |
| sin candidato (Challenger/ITF/pre-2013) | 3.521 |
| marcador distinto (rechazados) | 20 |
| ambiguos | 0 |

Las **0 discrepancias sobre 389 partidos vistos por partida doble** son la
validación fuerte del mapeo de columnas: los números de la ficha de A coinciden
exactamente con el bloque del rival en la ficha de B.

**Verificación cruzada del resultado.** Perfiles reconstruidos desde
`match_stats`, comparables con las cifras públicas de carrera:

| Jugador | 1º dentro | Gana con 1º | Gana con 2º | BP salvados |
|---|---|---|---|---|
| Djokovic (738) | 65,7 % | 75,2 % | 56,5 % | 65,5 % |
| Sinner (413) | 60,6 % | 75,8 % | 55,6 % | 67,2 % |
| Alcaraz (339) | 65,0 % | 72,2 % | 55,9 % | 63,9 % |

**Dos detalles con consecuencias para el motor Markov:**

1. **El tie-break NO cuenta como juego al saque** (el saque alterna dentro). Sobre
   los partidos enlazados, `juegos del marcador − nº de tie-breaks = Σ serve_games`
   en el 96 %. Hay que tenerlo en cuenta al derivar
   $\mathbb{E}[\text{puntos al saque}]$ en §2.8.
2. **El 4 % restante son erratas de tennis-data, no de TA.** Ejemplo real: la final
   del Masters de París 2021 está guardada como `[[4,5],[4,6],[6,3],[6,3]]` — un
   set fantasma de 4-5. Tennis Abstract da el marcador correcto (4-6 6-3 6-3), y
   por eso ese partido queda en `score_mismatch` en vez de enlazarse. **Efecto
   colateral útil: esta ingesta detecta errores en la fuente de resultados.**

**Lo que NO hace, a propósito**: no crea filas en `matches` ni toca el Elo.
`tennis-data` sigue siendo la única fuente autorizada de resultados. Los 3.521
partidos que TA conoce y nosotros no (Challengers sobre todo) quedan en
`ta_matches` esperando una decisión consciente de promoverlos.

**Pendiente**: el workflow `ta.yml` de GitHub Actions y correr las migraciones
contra Turso (008 se ha aplicado solo en local, el mismo descuido de las 005/006
en la Fase 2).

---

## 2. Entregable 2 — Fórmulas matemáticas

Notación: jugador $A$ al saque gana un punto con probabilidad $p$; jugador $B$,
con $q$. Superficie $s \in \{\text{Hard}, \text{Clay}, \text{Grass}, \text{Indoor}\}$.

### 2.1 Estimación de $p_a$ y $p_b$ (Barnett–Clarke)

Punto de partida: no se usa el % de puntos ganados al saque en crudo, porque está
contaminado por la calidad de los rivales. Se descompone contra la media del
circuito en esa superficie:

$$
p_a \;=\; f_A^{(s)} \;-\; g_B^{(s)} \;+\; \bar{g}^{(s)}
\qquad\text{equivalentemente}\qquad
p_a \;=\; \bar f^{(s)} + \underbrace{(f_A^{(s)} - \bar f^{(s)})}_{\text{saque de A}} - \underbrace{(g_B^{(s)} - \bar g^{(s)})}_{\text{resto de B}}
$$

con $\bar f^{(s)} + \bar g^{(s)} = 1$ por construcción. Simétricamente
$p_b = f_B^{(s)} - g_A^{(s)} + \bar g^{(s)}$.

**Encogimiento bayesiano** (imprescindible: un Challenger tiene 3 partidos de
muestra). Con $n_i$ puntos de saque observados y prior $\bar f^{(s)}$:

$$
\hat f_A^{(s)} \;=\; \frac{n_A \, f_A^{(s)} + \kappa \, \bar f^{(s)}}{n_A + \kappa},
\qquad \kappa \approx 400 \text{ puntos de saque (}\approx 6\text{ partidos)}
$$

$\kappa$ se ajusta empíricamente minimizando el error cuadrático fuera de muestra,
no a ojo.

**Decaimiento temporal**: cada partido pesa $w = 2^{-\Delta t / H}$ con vida media
$H = 365$ días para el perfil global y $H = 540$ para el de superficie (hay menos
partidos por superficie; decaer igual de rápido deja la muestra vacía).

**Ajustes aditivos sobre $p_a$** (en escala logit para no salirse de $[0,1]$):

$$
\operatorname{logit}(p_a) \;=\; \operatorname{logit}(p_a^{\text{base}})
+ \beta_{\text{cpi}}\,\widetilde{\text{CPI}} + \beta_{\text{alt}}\,\widetilde{\text{alt}}
+ \beta_{\text{zurdo}}\,\mathbb{1}[\text{B zurdo}] \cdot \delta_A^{L}
- \beta_{\text{fat}}\,F_A
$$

donde $\widetilde{\cdot}$ son variables centradas y $F_A$ es el índice de fatiga de §2.6.

> ⚠️ Todo §2.1 depende del spike S0. Sin `match_stats` no hay $f_A$ ni $g_B$.

### 2.2 Probabilidad de ganar un juego al saque

Cadena de Markov sobre los 18 estados de puntuación de un juego. Forma cerrada
(la deuce es una serie geométrica):

$$
D(p) \;=\; \frac{p^2}{p^2 + (1-p)^2}
\qquad \text{(ganar desde deuce)}
$$

$$
G(p) \;=\; p^4 + 4p^4(1-p) + 10\,p^4(1-p)^2 + 20\,p^3(1-p)^3 \, D(p)
$$

Los cuatro términos son: 40-0, 40-15, 40-30 y llegar a deuce (20 caminos a 3-3).

### 2.3 Tiebreak

No hay forma cerrada cómoda: se resuelve por recursión sobre el estado
$(i, j, \sigma)$ = puntos de A, puntos de B, quién saca. Con el patrón de saque
1-2-2 del tiebreak a 7:

$$
T(i,j,\sigma) =
\begin{cases}
1 & i \ge 7,\; i - j \ge 2\\
0 & j \ge 7,\; j - i \ge 2\\
\dfrac{p^2}{p^2+(1-p)^2}\Big|_{\text{alterna}} & i = j \ge 6 \;\text{(estado absorbente por pares)}\\
r\,T(i{+}1,j,\sigma') + (1-r)\,T(i,j{+}1,\sigma') & \text{resto}
\end{cases}
$$

con $r = p$ si saca A y $r = 1-q$ si saca B, y $\sigma'$ determinado por
$(i+j+1) \bmod 4 \in \{1,2\}$. Se memoiza: son ~80 estados, coste despreciable.
$T(p,q) \equiv T(0,0,A)$.

### 2.4 Set y partido

Recursión sobre juegos $(g_A, g_B)$ alternando el saque, con el tiebreak a 6-6:

$$
S(g_A,g_B) =
\begin{cases}
1 & g_A = 6,\ g_B \le 4 \ \ \text{o}\ \ g_A = 7,\ g_B \in \{5,6\}\\
0 & \text{simétrico}\\
T(p,q) & g_A = g_B = 6\\
h\,S(g_A{+}1,g_B) + (1-h)\,S(g_A,g_B{+}1) & \text{resto}
\end{cases}
$$

con $h = G(p)$ si le toca sacar a A y $h = 1 - G(q)$ si saca B. $S \equiv S(0,0)$.

Partido, asumiendo sets i.i.d. (aproximación estándar; el sesgo real es pequeño y
se absorbe en la recalibración de §2.9):

$$
M_3 = S^2\,(1 + 2(1-S)) = S^2(3 - 2S)
$$
$$
M_5 = S^3\,\big(1 + 3(1-S) + 6(1-S)^2\big)
$$

**Ganador del Set 1** = $S$ directamente (con el saque inicial asignado; si no se
conoce, $\tfrac12 S_{A\text{ saca}} + \tfrac12 S_{B\text{ saca}}$).

**Total de juegos, hándicaps y total de puntos**: la misma recursión devuelve la
distribución completa si en vez de propagar una probabilidad escalar se propaga un
vector sobre marcadores. En la práctica:

- **exacto** para juegos por set (la recursión ya enumera los marcadores 6-0…7-6),
  y convolución entre sets → $P(\text{total juegos} = k)$ → Over/Under y hándicap
  de juegos;
- **Monte Carlo** (50.000 simulaciones punto a punto) para el total de puntos y
  cualquier mercado conjunto. La MC además da los intervalos de confianza que
  alimentan el `confidence` del pick (§5.4).

### 2.5 Elo dinámico por superficie

$$
E_A = \frac{1}{1 + 10^{(R_B - R_A)/400}}
$$

**K adaptativo** (estilo Sackmann/538): jugadores con pocos partidos se mueven más:

$$
K_i = \frac{K_0}{(m_i + \nu)^{\sigma}} \cdot \rho_{\text{ronda}} \cdot \rho_{\text{categoría}},
\qquad K_0 = 250,\ \nu = 5,\ \sigma = 0{,}4
$$

$m_i$ = partidos disputados. $\rho_{\text{ronda}}$ ya está implementado (final pesa
más que primera ronda); $\rho_{\text{categoría}}$ escala Grand Slam > M1000 > 250 >
Challenger > ITF.

**Margen de victoria** con corrección de autocorrelación (si no se corrige, los
favoritos que ganan 6-0 6-0 inflan su Elo sin fin):

$$
\text{MOV} = \ln\!\big(1 + |\Delta_{\text{juegos}}|\big) \cdot
\frac{2{,}2}{0{,}001\,(R_{\text{gan}} - R_{\text{perd}}) + 2{,}2}
$$

**Actualización**:

$$
R_A' = R_A + K_A \cdot \text{MOV} \cdot (\text{resultado} - E_A)
$$

**Decaimiento por inactividad** hacia la media del circuito $\mu$ (una lesión de
8 meses no debería dejar el rating intacto):

$$
R \leftarrow \mu + (R - \mu)\cdot 2^{-\Delta t / H_{\text{elo}}}, \qquad H_{\text{elo}} = 270\ \text{días}
$$

Se mantienen tres ratings por jugador: **global**, **por superficie**, y
**reciente (90 días)**. La probabilidad Elo usa la mezcla

$$
R^{\text{eff}} = w_s R^{(s)} + w_g R^{\text{glob}} + w_r R^{\text{rec}},
\qquad w_s + w_g + w_r = 1
$$

con $w_s$ mayor en tierra y hierba (superficies más específicas) que en pista dura.
**Los pesos se ajustan por validación, no por intuición.**

**Cómo entra Markov en el modelo actual** — punto clave de integración: el motor
Markov no sustituye a la regresión logística, entra como feature número 14:

```ts
// packages/model/src/features.ts
export const FEATURE_NAMES = [
  'eloDiffSurface', 'eloDiffOverall', 'rankLogDiff', 'pointsLogDiff',
  'h2h', 'h2hSurface', 'loadDiff', 'intensityDiff', 'restDiff',
  'formDiff', 'expDiff', 'surfaceExpDiff', 'bestOf5EloDiff',
  'markovLogit',   // 🔒 nueva: logit(M) del motor punto a punto
] as const;
```

Así el ajuste IRLS decide *cuánto* vale el Markov en vez de que lo decidamos
nosotros. Y sigue sin intercepto: las features son diferencias orientadas a p1 y un
intercepto hornearía el sesgo de antigüedad de p1 (54,7 %).

> ⚠️ Añadir `markovLogit` **invalida los ajustes guardados**. `predict.ts` ya valida
> que `FEATURE_NAMES` coincida con el ajuste, así que fallará ruidosamente — que es
> lo correcto. Hay que reajustar y publicar como versión de modelo nueva.

### 2.6 Fatiga y calendario

$$
F_A = \alpha_1 \underbrace{\frac{\text{juegos}_{7d}}{\overline{\text{juegos}}_{7d}}}_{\text{intensidad}}
    + \alpha_2 \underbrace{\big(\text{minutos}_{\text{torneo}}\big)}_{\text{acumulado}}
    - \alpha_3 \underbrace{\min(d_{\text{descanso}}, 4)}_{\text{recuperación}}
    + \alpha_4 \underbrace{|\Delta \text{husos}|}_{\text{viaje}}
    + \alpha_5 \mathbb{1}[\text{cambio de superficie} \le 7\text{d}]
$$

**Lección ya aprendida y que hay que respetar**: la carga bruta (nº de partidos)
sale con **peso negativo** — no es un error de signo, es confusión: quien más ha
jugado es quien va ganando y avanzando en el cuadro. Por eso se separa en
**carga** (avance en el cuadro) e **intensidad** (juegos por partido = fatiga real).
Cualquier nueva feature de fatiga tiene que pasar el mismo control.

### 2.7 Court Pace Index estimado

No hay CPI oficial gratis. Se estima por torneo-temporada a partir de lo observado,
comparado con la media de la superficie:

$$
\text{CPI}_{t} = 50 + 25\cdot z\big(\text{hold}_t\big) + 25\cdot z\big(\text{ace rate}_t\big)
$$

con $z$ el z-score contra el conjunto de torneos de la misma superficie y
temporada. Requiere ≥ 30 partidos; por debajo se usa el CPI del torneo el año
anterior, y si no existe, la media de la superficie. Se marca `cpi_confidence`.
🔒 depende de S0 para la parte de aces.

### 2.8 Proyección de Aces — Poisson y Binomial Negativa

**Paso 1 — puntos de saque esperados.** Del propio motor Markov (§2.4), por Monte
Carlo o por esperanza sobre la distribución de juegos:

$$
\hat N_A = \mathbb{E}[\text{juegos al saque de } A] \times \mathbb{E}[\text{puntos por juego al saque}]
$$

Esto es lo que hace que la proyección sea coherente: si el modelo cree que el
partido será largo, proyecta más aces automáticamente.

**Paso 2 — tasa de aces ajustada por rival y pista.** Modelo log-lineal:

$$
\log \lambda_A = \log \hat N_A + \log \bar a^{(s)}
+ \gamma_1 \log\!\frac{a_A^{(s)}}{\bar a^{(s)}}
+ \gamma_2 \log\!\frac{d_B^{(s)}}{\bar d^{(s)}}
+ \gamma_3 \widetilde{\text{CPI}}
+ \gamma_4 \mathbb{1}[\text{indoor}]
$$

donde $a_A$ = aces por punto de saque de A, $d_B$ = aces concedidos por punto de
resto de B, $\bar a, \bar d$ las medias de la superficie. $\log \hat N_A$ entra como
**offset** (coeficiente fijo a 1), que es la forma correcta de modelar un conteo con
exposición variable. $\gamma$ se estima por regresión de Poisson.

**Paso 3 — Poisson NO basta.** Los aces están sobredispersos: se agrupan (rachas de
saque, un jugador que sube la marcha en el tiebreak). Empíricamente
$\operatorname{Var}/\mathbb{E} \approx 1{,}3\text{–}1{,}8$. Se usa **Binomial Negativa**:

$$
P(X = k) = \binom{k + r - 1}{k}\left(\frac{r}{r+\lambda}\right)^{r}\left(\frac{\lambda}{r+\lambda}\right)^{k},
\qquad \operatorname{Var}(X) = \lambda + \frac{\lambda^2}{r}
$$

$r$ (dispersión) se estima por máxima verosimilitud sobre el histórico, segmentado
por superficie. Con $r \to \infty$ se recupera Poisson, así que Poisson queda como
caso particular y como *fallback* cuando la muestra no permite estimar $r$.

**Paso 4 — mercados**:

- Aces por jugador: $P(X_A > L) = 1 - \sum_{k \le \lfloor L \rfloor} P(X_A = k)$.
- Aces del partido: $X_A + X_B$. La suma de dos NB con distinto $r$ no es NB, así
  que se convoluciona numéricamente (soporte 0–60, coste trivial) o se toma de la
  misma MC del §2.4.
- **Línea entera** (ej. "over 20.0"): hay empate posible → devolver también
  $P(X = L)$ y tratar el push explícitamente en el EV. Olvidar esto es un error
  clásico que infla el EV en mercados de aces y de juegos.

**Total de juegos** con la misma lógica pero sin NB: la distribución sale exacta de
la recursión de §2.4, que es mejor que ajustar una paramétrica.

### 2.9 Devigging: de cuota a probabilidad justa

Nunca normalización simple ($p_i = (1/o_i)/\sum_j (1/o_j)$): sesga a favor del
outsider. Método de **potencia** (o Shin), sobre Pinnacle cuando esté disponible:

$$
p_i = \left(\frac{1}{o_i}\right)^{\!1/\tau}, \qquad \tau \text{ tal que } \sum_i p_i = 1
$$

$\tau$ se resuelve por bisección. Con margen bajo (1,33 % al mejor precio) la
diferencia con la normalización simple es pequeña en moneyline pero **relevante en
totales y aces**, donde los libros cargan más.

### 2.10 Valor esperado y stake

$$
\text{EV} = \hat p \cdot o - 1
$$

$$
f^{*}_{\text{Kelly}} = \frac{\hat p \, o - 1}{o - 1} = \frac{\text{EV}}{o-1}
$$

$$
\text{stake} = \min\!\big(\phi \cdot f^{*} \cdot \psi_{\text{conf}} \cdot \psi_{\text{calidad}},\; \text{cap}\big),
\qquad \phi = 0{,}25,\ \text{cap} = 2\,\%
$$

$\phi = 0{,}25$ (cuarto de Kelly) porque Kelly pleno asume que $\hat p$ es correcta,
y aquí *sabemos* que no lo es. $\psi_{\text{conf}} \in [0,1]$ es la confianza del
modelo (§5.4) y $\psi_{\text{calidad}}$ penaliza inputs incompletos (jugador con
pocos partidos, sin stats de superficie).

**Calibración obligatoria antes de cualquier EV.** La probabilidad cruda del
logreg no es una probabilidad de apuesta hasta pasar por recalibración isotónica o
Platt sobre datos fuera de muestra. Y en este proyecto, con el orden p1/p2 =
min/max de id, la recalibración **ajusta solo la pendiente, no el intercepto**:
tocar el intercepto hornearía el sesgo de antigüedad de p1.

---

## 3. Entregable 3 — Estructura JSON de salida

`GET /api/picks/today` → objeto del día. Ejemplo con un Challenger, tal como
saldría **una vez S0 esté en verde** (los campos `data_quality` y `source` son los
que hacen honesta la respuesta cuando no lo esté):

```json
{
  "date": "2026-08-01",
  "generated_at": "2026-08-01T07:00:12Z",
  "model_version": "tti-markov-elo-2.0.0",
  "value_enabled": false,
  "disclaimer": "Modo informativo. El backtest fuera de muestra del modelo actual tiene ROI negativo; los picks se registran en paper trading y no se publican como apostables hasta que el CLV medio sea positivo.",

  "top_pick": {
    "pick_id": 48211,
    "is_top_pick": true,
    "tier": 1,
    "match": {
      "match_id": 71204,
      "tour": "ATP",
      "level": "Challenger",
      "tournament": { "id": 933, "name": "Cordenons Challenger 100", "location": "Cordenons, ITA", "surface": "Clay", "indoor": false },
      "round": "QF",
      "best_of": 3,
      "scheduled_at": "2026-08-01T11:30:00Z",
      "court_pace": { "cpi": 34.8, "label": "Lenta", "confidence": 0.71, "method": "estimated_from_holds_and_aces" },
      "players": {
        "p1": { "id": 1487, "name": "Bellucci M.", "country": "ITA", "rank": 96, "elo_overall": 1712, "elo_surface": 1758, "elo_recent": 1741, "hand": "R" },
        "p2": { "id": 1622, "name": "Barrios Vera T.", "country": "CHI", "rank": 112, "elo_overall": 1689, "elo_surface": 1701, "elo_recent": 1655, "hand": "R" }
      }
    },

    "selection": { "market": "GAMES_HCP", "side": "p1", "line": -3.5, "label": "Bellucci M. -3.5 juegos" },

    "probability": {
      "model": 0.642,
      "market_fair": 0.535,
      "market_implied_raw": 0.549,
      "devig_method": "power",
      "edge_pct": 10.7,
      "ci95": [0.601, 0.681]
    },

    "price": { "book": "Pinnacle", "decimal": 2.02, "captured_at": "2026-08-01T06:58:03Z", "best_available": { "book": "Pinnacle", "decimal": 2.02 } },

    "value": {
      "ev": 0.297,
      "kelly_full": 0.2912,
      "stake_pct_bankroll": 1.5,
      "kelly_fraction": 0.25,
      "confidence": 0.78,
      "risk_label": "Medio"
    },

    "engine": {
      "point_probabilities": { "p_a_serve": 0.6410, "p_b_serve": 0.6015, "tour_avg_serve_clay": 0.6180 },
      "markov": { "hold_p1": 0.8112, "hold_p2": 0.7476, "set_p1": 0.6389, "match_p1": 0.7233, "expected_games_total": 20.4, "expected_margin_games": 4.9 },
      "blend": { "logreg_p1": 0.6885, "markov_logit_weight": 0.31, "calibration": "isotonic-2026-07" }
    },

    "reasoning": {
      "headline": "El saque de Bellucci en tierra pesa más de lo que refleja la línea",
      "text": "Bellucci gana el 64,1 % de sus puntos al saque en tierra, 2,3 puntos por encima de la media del circuito Challenger en esta superficie, mientras que Barrios Vera solo devuelve al 37,0 % en el mismo contexto. El modelo proyecta que Bellucci mantiene el 81,1 % de sus juegos frente al 74,8 % del chileno, una brecha que en una pista lenta (CPI 34,8) se traduce en juegos, no en aces. Con esa diferencia de hold, la mediana simulada del margen es de 5 juegos y el 64,2 % de las simulaciones superan el -3,5. La línea del mercado equivale a un 53,5 % justo, así que el desacuerdo se concentra en el resto de Barrios Vera, que ha caído un 4,1 % en los últimos tres meses.",
      "drivers": [
        { "feature": "eloDiffSurface", "value": 57.0, "weight": 0.0041, "contribution": 0.2337, "direction": "p1" },
        { "feature": "markovLogit",    "value": 0.961, "weight": 0.3100, "contribution": 0.2979, "direction": "p1" },
        { "feature": "formDiff",       "value": 0.180, "weight": 0.6120, "contribution": 0.1102, "direction": "p1" },
        { "feature": "intensityDiff",  "value": -1.40, "weight": 0.0580, "contribution": -0.0812, "direction": "p2" }
      ],
      "generator": "deterministic-v1"
    },

    "data_quality": {
      "score": 0.68,
      "flags": ["challenger_small_sample", "serve_stats_shrunk_k400"],
      "p1_serve_points_sample": 612,
      "p2_serve_points_sample": 438,
      "h2h_matches": 1,
      "sources": { "results": "tennis-data", "schedule": "espn", "odds": "the-odds-api", "serve_stats": "tennisabstract", "serve_stats_last_seen": "2026-07-30" }
    },

    "other_markets": [
      { "market": "ML", "side": "p1", "probability": 0.723, "market_fair": 0.671, "price": 1.44, "ev": 0.041, "qualifies": false, "reason": "EV < 0.05" },
      { "market": "TOTAL_GAMES", "side": "under", "line": 21.5, "probability": 0.612, "market_fair": 0.571, "price": 1.83, "ev": 0.120, "qualifies": true, "tier": 2, "distribution": { "mean": 20.4, "sd": 3.1, "p_push": 0.0 } },
      { "market": "ACES_PLAYER", "player_id": 1487, "side": "over", "line": 5.5, "probability": 0.548, "market_fair": 0.524, "price": 1.95, "ev": 0.069, "qualifies": true, "tier": 3, "distribution": { "model": "negative_binomial", "lambda": 6.12, "r": 4.7, "variance": 14.1, "p_push": 0.0 } },
      { "market": "SET1_WINNER", "side": "p1", "probability": 0.639, "market_fair": 0.618, "price": 1.66, "ev": 0.061, "qualifies": true, "tier": 3 }
    ]
  },

  "secondary_picks": [
    {
      "pick_id": 48212, "tier": 2,
      "match": { "match_id": 71190, "tour": "WTA", "level": "WTA250", "tournament": { "name": "Praga Open", "surface": "Clay" }, "round": "R16",
                 "players": { "p1": { "id": 2201, "name": "Bouzkova M." }, "p2": { "id": 2418, "name": "Parry D." } } },
      "selection": { "market": "TOTAL_GAMES", "side": "over", "line": 20.5, "label": "Más de 20.5 juegos" },
      "probability": { "model": 0.601, "market_fair": 0.552, "edge_pct": 4.9 },
      "price": { "book": "Bet365", "decimal": 1.90 },
      "value": { "ev": 0.142, "stake_pct_bankroll": 0.9, "confidence": 0.63, "risk_label": "Medio-alto" },
      "reasoning": { "headline": "Dos jugadoras que rompen mucho en tierra lenta", "text": "…" }
    }
  ],

  "filters": {
    "tours": ["ATP", "WTA"],
    "levels": ["Grand Slam", "Masters 1000", "ATP500", "ATP250", "WTA1000", "WTA500", "WTA250", "Challenger", "ITF"],
    "markets": ["ML", "GAMES_HCP", "SETS_HCP", "TOTAL_GAMES", "ACES_MATCH", "ACES_PLAYER", "SET1_WINNER", "TOTAL_POINTS"],
    "odds_range": [1.40, 4.00],
    "tiers": [1, 2, 3]
  },

  "coverage": {
    "matches_scheduled": 148,
    "matches_predicted": 121,
    "matches_skipped": [
      { "reason": "sin_stats_de_saque_en_la_fuente", "count": 19, "levels": ["ITF"], "note": "ITF Futures: resultados sí, stats no. Solo mercado de ganador vía Elo." },
      { "reason": "sin_cuotas", "count": 8, "levels": ["Challenger"] }
    ]
  },

  "performance": {
    "window": "últimos 90 días",
    "picks": 214, "roi_pct": -4.8, "clv_mean_pct": -1.9, "brier": 0.2161, "market_brier": 0.2027,
    "note": "CLV negativo: el modelo aún no le gana al cierre. Por eso value_enabled=false."
  }
}
```

Tres cosas del payload que no son decorativas:

- `coverage.matches_skipped` — se dice qué **no** se cubre y por qué. Es lo que
  evita fingir cobertura Challenger/ITF.
- `other_markets[].qualifies` + `reason` — el mercado que no llega al 5 % de EV se
  devuelve igualmente con el motivo. Ocultarlo invita a que alguien lo reintente
  bajando el umbral, que es exactamente lo que el backtest demuestra que empeora.
- `performance` viaja **en la misma respuesta que el pick**. El rendimiento real no
  vive escondido en otra pantalla.

---

## 4. Entregable 4 — Wireframes / UX estilo PICK1

Mobile-first, 390 px. Tipografía ya establecida: Space Grotesk titulares,
IBM Plex Sans cuerpo, IBM Plex Mono para cifras. Tokens semánticos existentes
(`bg`, `surface`, `line`, `ink`, `ink-muted`, `ink-faint`, `court`, `live`).

### 4.1 Home — "El Pick del Día"

```
┌──────────────────────────────────────────────┐
│ ⌁ TTI            1 ago              ⌕   ☰    │  header sticky, 56px
├──────────────────────────────────────────────┤
│ ⚠ MODO ANÁLISIS · picks no apostables    ⓘ  │  banner ámbar, dismissible
│   El modelo aún no le gana al cierre.        │  solo si value_enabled=false
├──────────────────────────────────────────────┤
│                                              │
│   GRAN PICK DEL DÍA                          │  ink-faint, 11px, tracking
│  ┌────────────────────────────────────────┐  │
│  │ ATP CHALLENGER · Cordenons · QF   TIER1│  │  chip tier: acento
│  │ 🟠 Arcilla · CPI 34.8 Lenta      11:30 │  │
│  │                                        │  │
│  │  Bellucci M.        vs   Barrios V. T. │  │  20px, Space Grotesk
│  │  #96 · elo 1758          #112 · 1701   │  │  mono, ink-muted
│  │                                        │  │
│  │  ┌──────────────────────────────────┐  │  │
│  │  │  BELLUCCI -3.5 JUEGOS      2.02  │  │  │  la selección, grande
│  │  └──────────────────────────────────┘  │  │
│  │                                        │  │
│  │  MODELO ████████████████░░░░░  64.2%   │  │  dos barras superpuestas
│  │  MERCADO ██████████████░░░░░░░  53.5%  │  │  la brecha se VE
│  │                          ▲ +10.7 pts   │  │
│  │                                        │  │
│  │  EV +29.7%   ·   Stake 1.5%   ·  ●●●○  │  │  confianza en puntos
│  │                                        │  │
│  │  "El saque de Bellucci en tierra pesa  │  │  headline, 15px
│  │   más de lo que refleja la línea"      │  │
│  │                                        │  │
│  │            Ver análisis  →             │  │
│  └────────────────────────────────────────┘  │
│                                              │
│   PICKS DE HOY                    12         │
│  ┌─[ Todos ][ Ganador ][ Juegos ][ Aces ]─┐  │  chips scroll horizontal
│  └─[ Cuota 1.40–4.00 ▾ ][ Torneo ▾ ]─────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ T2 │ WTA250 Praga · R16        1.90    │  │  fila compacta, 88px
│  │    │ Bouzkova – Parry                  │  │
│  │    │ Más de 20.5 juegos                │  │
│  │    │ IA 60.1% · Mdo 55.2% · EV +14.2%  │  │  mono
│  └────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │ T3 │ ATP250 Kitzbühel · R16     1.95   │  │
│  │ …                                      │  │
│                                              │
│   EN VIVO                          ● 3       │  live pulsante
│  ┌────────────────────────────────────────┐  │
│  │ Hamburgo · SF   Zverev  6-4 3-2  Rune  │  │  refresco 20s + al volver
│  └────────────────────────────────────────┘  │     a la pestaña
├──────────────────────────────────────────────┤
│  ⌂ Hoy   ⊞ Torneos   ⚇ Jugadores   ◷ Banca │  tab bar
└──────────────────────────────────────────────┘
```

Decisiones de UX que importan:

- **Una sola tarjeta grande**. PICK1 funciona porque no obliga a elegir. Si hay
  12 picks, 11 son lista y 1 es protagonista.
- **La brecha modelo↔mercado se dibuja, no se lee.** Dos barras superpuestas
  comunican "ventaja" mejor que "EV +29,7 %", que no significa nada para el 90 %
  de los usuarios.
- **El banner de modo análisis no se puede ocultar permanentemente** mientras
  `value_enabled = false`. Es la diferencia entre una herramienta y un tipster.

### 4.2 Ficha de partido

```
┌──────────────────────────────────────────────┐
│ ←  Bellucci – Barrios Vera            ⤴     │
├──────────────────────────────────────────────┤
│ ATP Challenger Cordenons · QF · 🟠 Arcilla   │
│ 1 ago 11:30 · CPI 34.8 (Lenta)               │
├──────────────────────────────────────────────┤
│  [ PRONÓSTICO ][ MERCADOS ][ H2H ][ FORMA ]  │  tabs
├──────────────────────────────────────────────┤
│  ▸ PRONÓSTICO                                │
│                                              │
│      MODELO          vs        MERCADO       │
│       64.2%                     53.5%        │
│    ┌────────────────────────────────┐        │
│    │ ███████████████████░░░░░░░░░░ │        │  barra comparativa
│    └────────────────────────────────┘        │
│      IC 95%: 60.1% – 68.1%                   │
│                                              │
│  POR QUÉ                                     │
│  ┌────────────────────────────────────────┐  │
│  │ Bellucci gana el 64,1 % de sus puntos  │  │  la reseña completa,
│  │ al saque en tierra, 2,3 puntos por     │  │  3–4 oraciones,
│  │ encima de la media Challenger…         │  │  generada determinista
│  └────────────────────────────────────────┘  │
│                                              │
│  QUÉ LO EMPUJA                               │  contribuciones valor×peso
│   markovLogit      ████████████▶  +0.298     │  barras divergentes
│   eloDiffSurface   ██████████▶    +0.234     │  desde el centro
│   formDiff         █████▶         +0.110     │
│   intensityDiff       ◀████       -0.081     │  rojo = favorece a p2
│                                              │
│  MOTOR PUNTO A PUNTO                         │
│  ┌──────────────┬───────────┬─────────────┐  │
│  │              │ Bellucci  │ Barrios V.  │  │
│  │ Pto al saque │  64.1 %   │   60.2 %    │  │  mono
│  │ Mantiene sq. │  81.1 %   │   74.8 %    │  │
│  │ Gana el set  │  63.9 %   │   36.1 %    │  │
│  └──────────────┴───────────┴─────────────┘  │
│   Juegos totales proyectados: 20.4 ± 3.1     │
│   ┌ distribución ─────────────────────────┐  │  histograma de la
│   │      ▁▃▅███▇▅▃▁                       │  │  simulación, con la
│   │   16 18 20│22 24  ← línea 21.5        │  │  línea del mercado
│   └───────────────────────────────────────┘  │  marcada encima
│                                              │
│  ▸ MERCADOS                                  │
│  ┌─────────────┬──────┬──────┬──────┬─────┐  │
│  │ Mercado     │ IA   │ Mdo  │Cuota │ EV  │  │
│  ├─────────────┼──────┼──────┼──────┼─────┤  │
│  │ Ganador p1  │ 72.3 │ 67.1 │ 1.44 │+4.1 │  │  gris: no califica
│  │ Hcp -3.5 ✓  │ 64.2 │ 53.5 │ 2.02 │+29.7│  │  acento: es el pick
│  │ Under 21.5 ✓│ 61.2 │ 57.1 │ 1.83 │+12.0│  │
│  │ Aces +5.5 ✓ │ 54.8 │ 52.4 │ 1.95 │ +6.9│  │
│  │ Set 1 p1 ✓  │ 63.9 │ 61.8 │ 1.66 │ +6.1│  │
│  └─────────────┴──────┴──────┴──────┴─────┘  │
│                                              │
│  CALIDAD DE DATOS              0.68  ●●○○    │
│  ⚠ Muestra Challenger pequeña (438 pts de    │  siempre visible cuando
│    saque de Barrios Vera). Perfiles          │  score < 0.8
│    encogidos hacia la media (κ=400).         │
└──────────────────────────────────────────────┘
```

### 4.3 Perfil de jugador

```
┌──────────────────────────────────────────────┐
│ ←  Bellucci M.  🇮🇹                     ⤴    │
│    #96 ATP · 24 años · Diestro               │
├──────────────────────────────────────────────┤
│   ELO                                        │
│   Global 1712  ·  Arcilla 1758 ▲ ·  90d 1741 │
│                                              │
│   ┌─── RADAR ────────────────────────────┐   │
│   │            Saque                      │   │  hexágono, escala
│   │         ╱────●────╲                   │   │  percentil vs
│   │  Presión●        ●Resto               │   │  circuito+superficie
│   │       ╱ ╲      ╱ ╲                    │   │
│   │  Aces●   ●────●   ●Consistencia       │   │  ⚠ requiere S0
│   │           BP conv.                    │   │
│   └───────────────────────────────────────┘   │
│                                              │
│   POR SUPERFICIE                             │
│   ┌────────┬──────┬───────┬───────┬───────┐  │
│   │        │ V-D  │ %Vict │Ace/Jg │ %BP+  │  │
│   │ Arcilla│ 34-12│ 73.9  │ 0.41  │ 44.2  │  │
│   │ Dura   │ 18-19│ 48.6  │ 0.52  │ 38.1  │  │
│   │ Hierba │  3-5 │ 37.5  │ 0.61  │ 31.0  │  │
│   └────────┴──────┴───────┴───────┴───────┘  │
│                                              │
│   FORMA (10 últimos, ajustada por rival)     │
│   ● ● ○ ● ● ● ○ ● ● ●     +38 elo neto      │  puntos, tooltip con
│   ↑ tamaño = calidad del rival               │  rival y marcador
│                                              │
│   TIEBREAKS  14-9 (60.9 %)   ·  5º set 3-1   │
└──────────────────────────────────────────────┘
```

### 4.4 Banca / Paper trading

Extiende la página `/paper-trading` existente: curva de banca, ROI, **CLV como
métrica principal** (arriba del ROI: el CLV es la señal, el ROI es el ruido a corto
plazo), desglose por mercado y por tier, y un contador de "picks hasta poder
encender `value_enabled`" basado en el tamaño de muestra necesario para detectar
CLV > 0 (§5.5).

---

## 5. Reglas del motor de picks

### 5.1 Selección del Gran Pick del Día

No es simplemente el EV máximo — el EV máximo tiende a ser el mercado más ilíquido
y peor estimado. Ranking:

$$
\text{score} = \text{EV} \times \psi_{\text{conf}} \times \psi_{\text{calidad}} \times \psi_{\text{liquidez}}
$$

con $\psi_{\text{liquidez}}$ = 1,0 para moneyline de torneo cubierto, 0,8 totales,
0,6 aces por jugador, 0,4 mercados exóticos. El Gran Pick es el máximo de `score`
**entre los que superan el gate de §5.5**; si ninguno lo supera, la home muestra
"Hoy no hay ninguna oportunidad que cumpla los criterios" — y eso es un resultado
válido, no un fallo.

### 5.2 Tiers

| Tier | EV | Confianza | Calidad de datos |
|---|---|---|---|
| 1 | ≥ 12 % | ≥ 0,75 | ≥ 0,80 |
| 2 | ≥ 8 % | ≥ 0,60 | ≥ 0,65 |
| 3 | ≥ 5 % | ≥ 0,45 | ≥ 0,50 |

Por debajo de cualquier umbral, no se publica (pero sí se registra en paper).

### 5.3 Reseña redactada — determinista, no inventada

`copy.ts` genera el texto desde las contribuciones ya calculadas, con plantillas por
tipo de driver. Nada de números que no vengan de la base:

```ts
// pseudo
const top = drivers.sort(byAbsContribution).slice(0, 3);
const frases = top.map(d => PLANTILLAS[d.feature](d, ctx));   // ctx = stats reales
const cierre = PLANTILLAS.mercado(pModel, pMarketFair, line);
return [headline(top[0]), ...frases, cierre].join(' ');
```

Si más adelante se quiere pulir con un LLM, la regla es: **se le pasan los números
ya calculados y solo puede reformular**; cualquier cifra generada que no esté en
`drivers` se rechaza en validación. Un modelo de lenguaje inventando un "14 % más
de puntos de primer servicio" es exactamente el fallo que destruye la credibilidad
de un producto de pronósticos.

### 5.4 Confianza

$$
\psi_{\text{conf}} = \sigma\!\left( c_0 - c_1 \cdot \text{ancho IC}_{95} - c_2 \cdot \mathbb{1}[\text{muestra corta}] - c_3 \cdot \text{disp. entre libros} \right)
$$

El IC sale del bootstrap de los pesos del logreg + la varianza de la Monte Carlo.
La dispersión entre casas es señal genuina: cuando los libros discrepan mucho entre
sí, nadie sabe nada, incluidos nosotros.

### 5.5 Gate de publicación (la parte que evita repetir el desastre del backtest)

`value_enabled` pasa a 1 **solo si se cumplen las cuatro**:

1. **CLV medio > 0** con $t > 2$ sobre ≥ 500 picks prospectivos (no backtest).
2. **Brier del modelo ≤ Brier del mercado** en la misma ventana fuera de muestra.
3. **La relación EV↔ROI es monótona creciente** por deciles de EV. Hoy es
   decreciente: más ventaja declarada, más pérdida. Este es el test que el modelo
   actual suspende y el que hay que vigilar.
4. Calibración con desvíos ≤ ±0,03 en los 10 deciles.

Se evalúa en `resultados.yml` y queda registrado. **Nadie lo enciende a mano.**

---

## 6. Orden de implementación sugerido

| # | Trabajo | Depende de | Desbloquea |
|---|---|---|---|
| S0 | **Correo a Sackmann** pidiendo permiso de uso automatizado + licencia (§1.5.5) | — | la WTA y el uso comercial |
| 1 | Migraciones 008–011 | — | esquema |
| 2 | `ta-ingest.ts` (§1.5) + `player_serve_profiles` | 1 | $p_a$, $p_b$ |
| 3 | `markov.ts` + tests (juego/tiebreak/set/partido) | 2 | Markov |
| 4 | `markovLogit` como feature 14 + reajuste | 3 | modelo v2 |
| 5 | `sim.ts` — juegos, hándicaps, set 1, puntos | 3 | 4 mercados |
| 6 | `aces.ts` — NB + estimación de $r$ | 2, 5 | mercado aces |
| 7 | `devig.ts` (potencia/Shin) + `value.ts` v2 | — | EV correcto |
| 8 | `picks.yml` + `copy.ts` determinista | 4–7 | picks |
| 9 | UI: home PICK1, ficha, perfil | 8 | producto |
| 10 | Gate + `resultados.yml` + CLV | 8 | encender o no |

Los pasos 3, 5, 6 y 7 son TypeScript puro con tests unitarios — se pueden validar
contra valores conocidos de la literatura (p. ej. $p = 0{,}65 \Rightarrow
G(p) = 0{,}8296$) sin tocar la base. El paso 4 es el que **invalida los ajustes
guardados** y obliga a versionar el modelo.

---

## 7. Lo que este diseño deliberadamente no hace

- **No promete stats de ITF Futures.** Tennis Abstract da resultados de ITF pero no
  estadísticas de saque (0 de 96 partidos comprobados). En ITF hay Elo; no hay
  Markov ni Aces, y la UI lo dice en vez de fingirlo. Challenger sí está cubierto
  desde ≈2021.
- **No ingiere de rutas prohibidas por `robots.txt`.** La ruta ATP es conforme; la
  de WTA no lo es hasta tener permiso (§1.5.5).
- **No enciende el value betting por defecto.** La evidencia disponible dice que el
  modelo pierde dinero justo donde más confía.
- **No baja el umbral de EV para tener más picks.** El backtest muestra que ese
  botón empeora el resultado, no lo mejora.
- **No genera texto con un LLM libre.** Las cifras de la reseña salen de la base.
