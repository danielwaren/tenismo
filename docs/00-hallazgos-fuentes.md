# Hallazgos de verificación de fuentes — 2026-07-22

Verificación hecha ANTES de escribir código, sobre las fuentes que el brief daba
por "verificadas". Todo lo de abajo se comprobó con peticiones HTTP reales desde
este entorno (no de memoria).

## 1. BLOQUEANTE: los repos de Jeff Sackmann ya no existen

| Repo | api.github.com | github.com |
|---|---|---|
| `JeffSackmann/tennis_atp` | **404** | **404** |
| `JeffSackmann/tennis_wta` | **404** | **404** |
| `JeffSackmann/tennis_pointbypoint` | **404** | **404** |
| `JeffSackmann/tennis_slam_pointbypoint` | **404** | **404** |
| `JeffSackmann/tennis_MatchChartingProject` | 200 | 200 |

La cuenta `JeffSackmann` sigue viva (200) y lista **un solo repo público**:
`tennis_MatchChartingProject` (último push 2026-05-25). Los de resultados,
rankings y punto-a-punto fueron borrados o pasados a privado.

No es un problema de red de este entorno: `withastro/astro` y su README raw
responden 200, y el rate_limit de la API contesta normal. Es específico de esos
repos.

No se encontró un mirror mantenido. `thekasser/tennis-wta-atp` (378 MB, push de
hoy) NO es un mirror: es el proyecto de otra persona que consume los CSV de
Sackmann y solo publica datos derivados en JS; su `CREDITS.md` apunta a los
mismos repos ya caídos.

Nota de licencia, por si aparece un mirror: los datos de Sackmann son
**CC BY-NC-SA 4.0** — no comerciales y con obligación de heredar la licencia en
cualquier obra derivada. Relevante para una app publicada.

## 2. Sustituto verificado: tennis-data.co.uk

Descarga probada con éxito desde este entorno:

- `http://www.tennis-data.co.uk/2025/2025.xlsx` → 200, 426 KB, **2644 filas**
  (una por partido ATP 2025).
- `http://www.tennis-data.co.uk/2025w/2025.xlsx` → 200, 399 KB (WTA 2025).
- Índice en `alldata.php`: ATP **2000–2026** y WTA **2007–2026**, un fichero por
  temporada (`.xls` hasta 2012, `.xlsx` desde 2013).

Columnas confirmadas leyendo el XLSX (no de la documentación):

```
ATP | Location | Tournament | Date | Series | Court | Surface | Round | Best of
Winner | Loser | WRank | LRank | WPts | LPts
W1 L1 W2 L2 W3 L3 W4 L4 W5 L5 | Wsets | Lsets | Comment
B365W B365L | PSW PSL | MaxW MaxL | AvgW AvgL
```

Lo que esto nos da y Sackmann NO daba:

- **Cuotas históricas reales de cierre** en el mismo fichero: Bet365, Pinnacle
  (`PSW/PSL`), máximo del mercado (`Max`) y media del mercado (`Avg`).
- `Surface` (Hard/Clay/Grass/Carpet) y `Court` (Indoor/Outdoor) por partido →
  justo lo que necesita el Elo por superficie.
- `Comment` distingue `Completed` / retirada / walkover → hay que excluir
  retiradas y W.O. del entrenamiento del modelo.

Lo que perdemos frente a Sackmann:

- **No hay estadísticas de saque/resto** (aces, dobles faltas, % de primer
  saque, puntos de break). Eso cierra la puerta al modelo punto-a-punto de la
  "fase posterior" mientras no aparezca otra fuente.
- Los jugadores vienen como texto abreviado (`Vukic A.`, `O Connell C.`), sin
  ID estable → hace falta un normalizador de nombres y una tabla de alias.

## 3. Consecuencia buena para Paper Trading

Con Sackmann, Paper Trading solo podía validarse **hacia adelante**: había que
esperar a que The Odds API fuera acumulando cuotas día a día.

Con tennis-data.co.uk hay ~25 temporadas de cuotas reales de cierre, así que el
simulador se puede **backtestear contra cuotas reales históricas** desde el día
uno, sin romper la regla no negociable (nunca se simula una cuota a partir de la
probabilidad del propio modelo — estas son cuotas reales de casas reales).

The Odds API sigue haciendo falta, pero solo para lo que el histórico no puede
dar: cuotas de partidos **futuros**, que es lo que alimenta el paper trading en
vivo.

## 4. Conflicto en la ubicación del repo

El brief pide "mismo repo git que sports-trader-intelligence" y "carpeta nueva
al mismo nivel". Las dos cosas juntas son imposibles:

- `web/` es un repo git **sin remoto**.
- `web/sports-trader-intelligence/` es un repo git **anidado y distinto**, con
  remoto `https://github.com/danielwaren/deportismo.git`.

Es decir: "mismo repo" = dentro de `sports-trader-intelligence/`; "mismo nivel"
= dentro del repo padre `web`, que no está en GitHub. Hay que elegir.
