# Modo Favorito — de perseguir value a perseguir aciertos

## Por qué

[04-backtest-paper-trading.md](./04-backtest-paper-trading.md) cerró con datos duros: sobre 9.861
partidos fuera de muestra, exigirle "ventaja" al modelo es **anti-predictivo** — cuanto más
declara, más se pierde, de forma monótona (2% de ventaja mínima → ROI −5,16%; 15% → ROI −7,80%).
La causa no es el margen de la casa (eso solo cuesta ~1,3% apostando a ciegas al mejor precio):
es que el modelo está peor calibrado que el mercado (Brier 0,2159 frente a 0,2027) y, cuando dos
estimadores discrepan, la discrepancia grande casi siempre viene del peor.

El modo Value ya reflejaba esta conclusión en el banner de `/paper-trading` ("modo auditoría, no
es una estrategia"), pero **seguía colocando apuestas con esa misma lógica** (ventaja mínima 2%,
Kelly/4) — la app avisaba del problema y lo repetía a la vez. Números en rojo, cada día.

## Qué cambia

`paper_trading_config.strategy = 'favorite'` (nuevo valor por defecto, migración
`db/postgres/0005_paper_trading_favoritos.sql`): la selección de a quién apostar deja de hacerla
el modelo y pasa a hacerla el propio mercado.

- **Selección:** de los candidatos de un partido (p1/p2, o over/under en Total de Juegos, o
  p1/p2 en Hándicap), se elige el que tenga mayor probabilidad **devigada** del mercado
  (`devigedProb`), no el de mayor "ventaja" del modelo. El modelo no interviene en la decisión —
  se sigue guardando en `paper_trades.model_prob`/`edge` como dato informativo, para poder seguir
  comparando después.
- **Filtro:** solo se apuesta si esa probabilidad de mercado supera `min_favorite_prob` (0,62 por
  defecto ≈ cuota justa por debajo de 1,61) y la confianza del pronóstico supera `min_confidence`
  (mismo filtro de calidad de dato que antes, sin relación con el modelo esta vez).
- **Stake:** plano (`favorite_stake_pct`, 1,5% de banca por defecto), no Kelly. Kelly necesita una
  ventaja real que aquí no se afirma tener — escalar el stake con "cuánto favorito es" inventaría
  una ventaja que no existe.

Lógica pura en `packages/model/src/value.ts` (`decideFavorite`/`DEFAULT_FAVORITE_RULES`, con
tests en `packages/model/tests/value.test.ts`); aplicada en `scripts/paper-trade.ts`.

## Qué expectativa es honesta

Esto **no es una vuelta a "el modelo tiene razón"**: es lo contrario, es dejar de competir con el
mercado y montarse encima de él. El EV esperado de seguir al favorito del mercado sigue siendo
ligeramente negativo — el margen de la casa no desaparece porque se deje de perseguir "ventaja",
igual que apostar a ciegas al mejor precio disponible perdía ~1,3% en el backtest de 04. Lo que
cambia es la métrica que importa: no ROI, sino **% de aciertos** — la mayoría de los picks
deberían ganar, aunque paguen poco, porque el favorito gana la mayoría de las veces por
definición. `/paper-trading` ahora muestra "% Aciertos" como KPI propio, no solo ROI.

El CLV se sigue midiendo exactamente igual (`closing_odds`/`clv` en `paper_trades`): sigue siendo
la señal más rápida para detectar si alguna vez aparece ventaja real que valga la pena perseguir,
en cualquiera de los dos modos.

## Cómo volver al modo anterior

`strategy` es una columna de configuración, no un cambio de esquema irreversible:

```sql
update paper_trading_config set strategy = 'value' where id = 1;
```

Las apuestas ya colocadas (en cualquiera de los dos modos) no se tocan al cambiar `strategy` —
solo afecta a las que coloque el cron a partir de ese momento. Para arrancar la banca del
simulador en limpio (por ejemplo, para medir el modo Favorito sin arrastrar el rojo acumulado del
modo Value) está el botón de reset en `/paper-trading`
(`src/components/ResetPaperBankroll.tsx` → `POST /api/paper-trading/reset`).
