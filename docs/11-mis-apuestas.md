# Mis apuestas (`/trading`)

Registro **manual** de las apuestas reales que jugamos, con caja propia
llevada por movimientos. No ejecuta apuestas, no se conecta a ninguna casa y
no mueve dinero: es un libro contable y una calculadora.

**Distinto del Paper Trading** (`/paper-trading`), que simula con dinero
ficticio lo que el *modelo* habría apostado. Aquí las apuestas las decide una
persona; la app solo lleva la cuenta y contrasta contra el modelo y la IA.

## Ruta y navegación

- Página: `src/pages/trading.astro` → `/trading`
- Enlace en la navegación principal (`src/layouts/Base.astro`), etiqueta
  «Mis apuestas», con la misma barra de scroll horizontal en móvil que el
  resto.

## Migraciones

`db/migrations/014_apuestas_personales.sql` crea tres tablas:

| Tabla | Para qué |
|---|---|
| `bankrolls` | La caja: nombre, moneda, saldo inicial. |
| `bets` | Cada apuesta registrada, con su contexto y las probabilidades del modelo/IA. |
| `bankroll_transactions` | **La fuente de verdad del saldo.** Cada movimiento con su signo. |

Aplicar con:

```bash
npm run db:migrate
```

## Cómo se calcula la caja

La caja **nunca** es un campo editable. `currentBalance` es literalmente la
suma de `bankroll_transactions.amount`. Eso la hace auditable movimiento a
movimiento y evita que «cuánto tengo» dependa de la memoria de una
conversación o de lo que muestre la casa de apuestas.

Tipos de movimiento y su signo:

| Tipo | Signo | Cuándo |
|---|---|---|
| `INITIAL_BALANCE` | + | Al crear la banca. |
| `DEPOSIT` | + | Ingreso manual. |
| `WITHDRAWAL` | − | Retiro manual. |
| `STAKE` | − | Al registrar una apuesta. |
| `WIN_RETURN` | + | Apuesta ganada: retorno completo (stake × cuota). |
| `VOID_RETURN` | + | Apuesta anulada: devuelve el stake. |
| `CASHOUT_RETURN` | + | Cashout: el importe realmente recibido. |
| `ADJUSTMENT` | ± | Corrección manual. |

Conceptos que **no** se mezclan:

- **Caja disponible** — lo que hay ahora (el stake abierto ya está descontado).
- **Exposición abierta** — suma de stakes de apuestas `OPEN`. Dinero
  comprometido, todavía no resuelto.
- **Retorno potencial** — `stake × cuota` (incluye el stake).
- **Beneficio potencial** — `retorno − stake`.
- **Beneficio realizado** — solo de apuestas ya liquidadas.

## Uso

### Crear la banca inicial

La primera vez, la página muestra el formulario de creación. El saldo inicial
**lo pones tú a mano** — deliberadamente no se toma de ninguna captura ni del
saldo de una casa de apuestas.

### Registrar una apuesta

Pestaña «Registrar». Obligatorios: los dos jugadores, mercado, selección,
alcance, cuota (> 1) y stake (> 0). Antes de guardar se muestra una
confirmación con retorno potencial, beneficio potencial y **cómo queda la caja
después**. Un stake mayor que la caja disponible se rechaza (en cliente y
otra vez en servidor).

### Liquidar

Pestaña «Abiertas» → botones Ganada / Perdida / Anular / Cashout, con
confirmación previa. La liquidación es **atómica y no repetible**: el `UPDATE`
lleva `where status = 'OPEN'`, así que dos peticiones simultáneas no pueden
liquidar dos veces (la segunda recibe HTTP 409).

## Card «Mi pronóstico»

Tres columnas:

1. **Modelo Tenismo** — reutiliza el modelo que ya existe (`predictMatch` de
   Elo por superficie y `simulateMatch` del motor Markov), vía el adaptador
   `src/lib/model-forecast.ts`. No se duplicó ni se creó un modelo nuevo.

   Cobertura real, sin inventar nada:
   - ✅ Ganador del partido, total de juegos del partido, hándicap de juegos
     del partido.
   - ❌ Cualquier mercado de **set** → «Modelo no disponible para este
     mercado».
   - ❌ **Challenger / ITF** → el Elo solo cubre ATP/WTA.
   - ❌ Jugador cuyo nombre no se resuelve contra nuestra base.

2. **Análisis IA** — segunda lectura independiente. **No hay proveedor
   configurado** en este despliegue: `src/lib/ai-analysis.ts` define el
   adaptador `AiBetAnalysisProvider` y hoy sólo existe
   `NotConfiguredAiProvider`, que devuelve un estado explícito «IA no
   configurada» en vez de fallar o inventar. No se añadió ninguna dependencia
   ni clave ficticia.

3. **Comparación** — probabilidad del modelo, de la IA, diferencia, cuota de
   mercado, implícita, cuotas justas y EV de cada uno, más un estado de
   consenso (Coinciden / Parcialmente / En desacuerdo / Datos insuficientes) y
   una explicación en una línea. Nunca se presenta como certeza.

### Conectar un proveedor de IA más adelante

Todo el cambio queda dentro de `src/lib/ai-analysis.ts` (la página y la API
no se tocan):

1. Añadir la clave como variable de entorno **del servidor** — nunca con
   prefijo `PUBLIC_`, que la expondría al navegador.
2. Implementar `analyze()` con el SDK real, **validando la forma de la
   respuesta** contra `AiBetAnalysis` antes de devolverla.
3. En `getAiProvider()`, devolver la nueva clase cuando la variable esté
   presente y seguir devolviendo `NotConfiguredAiProvider` cuando no — así un
   despliegue sin clave degrada con un aviso, no con un error 500.

## Reglas del análisis en vivo

La interfaz las refuerza a propósito:

- **Nunca se asume quién saca.** `server_at_entry` se guarda explícitamente y,
  si se deja vacío, la ficha lo dice («saque no registrado»). Sin ese dato, un
  30-40 o una ventaja no se pueden interpretar.
- Se guarda el **marcador exacto** de entrada y la **línea exacta** del
  mercado.
- Los mercados de partido y de set son distintos y no se mezclan (campo
  `scope`).
- Todo análisis muestra su hora de actualización.

## Resumen diario

La caja **no se cierra sola** por cambio de fecha. La pestaña «Día» consulta
cualquier fecha a demanda y avisa si aún hay apuestas abiertas de ese día
(el resultado todavía puede cambiar).

## API

Todos bajo `src/pages/api/bets/`. Validación completa en servidor —
la del formulario es solo la primera barrera.

| Endpoint | Qué hace |
|---|---|
| `GET /api/bets` | Lista apuestas con filtros (estado, circuito, torneo, mercado, casa, live, fechas). |
| `POST /api/bets` | Registra apuesta + transacción STAKE, atómico. Recalcula el pronóstico del modelo **en servidor**. |
| `POST /api/bets/settle` | Liquida (WON/LOST/VOID/CASHOUT) o actualiza notas. 409 si ya estaba liquidada. |
| `GET /api/bets/bankroll` | `view=list\|summary\|transactions\|daily`. |
| `POST /api/bets/bankroll` | Crea banca, o registra depósito/retiro/ajuste. |
| `POST /api/bets/forecast` | Modelo + IA + comparación, para la card. |

## Variables de entorno

**Ninguna nueva.** Usa la conexión a base que ya existe (`TURSO_DATABASE_URL`,
`TURSO_AUTH_TOKEN`). Cuando se conecte un proveedor de IA, esa clave será la
primera variable nueva.

## Limitaciones de esta primera versión

- **Cuotas y marcador en vivo se introducen a mano.** No hay scraping de casas
  de apuestas ni proveedor de datos en vivo (deliberado, estaba fuera de
  alcance). El esquema ya tiene los campos para automatizarlo después.
- **IA no configurada** — adaptador listo, sin proveedor.
- **Sin usuarios.** El proyecto no tiene autenticación ni tabla de usuarios
  (herramienta de un solo operador, sin RLS — ver `src/lib/db.ts`), así que no
  hay `user_id` ni comprobación de propiedad. Si se añade multiusuario,
  `src/lib/bets.ts` es el primer sitio a revisar.
- **El modelo no cubre mercados de set** ni Challenger/ITF. Se dice
  explícitamente en vez de estimar.
- **Sin CLV todavía**: haría falta guardar la cuota de cierre de cada apuesta,
  que hoy no se captura para apuestas registradas a mano.
