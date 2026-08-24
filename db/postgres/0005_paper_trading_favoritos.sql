-- Paper Trading: modo Favorito (ago 2026).
--
-- docs/04-backtest-paper-trading.md concluyó, con 9.861 partidos fuera de
-- muestra, que exigir "ventaja" del modelo es anti-predictivo: cuanta más
-- ventaja declara, más se pierde, porque el mercado está mejor calibrado que
-- el modelo. Este modo deja de perseguir value y persigue ACIERTOS: coloca la
-- apuesta en el lado que el propio mercado (cuota devigada) da como favorito
-- fuerte, con stake plano — ver DEFAULT_FAVORITE_RULES / decideFavorite en
-- packages/model/src/value.ts para la lógica pura y por qué el EV esperado
-- aquí es ligeramente negativo por diseño (el margen de la casa no desaparece
-- solo porque se deje de perseguir "ventaja").
--
-- `strategy` decide qué usa scripts/paper-trade.ts al colocar apuestas nuevas.
-- Se puede volver a 'value' en cualquier momento sin migración (solo update).
alter table paper_trading_config
  add column if not exists strategy text not null default 'favorite'
    check (strategy in ('value', 'favorite'));

alter table paper_trading_config
  add column if not exists min_favorite_prob double precision not null default 0.62
    check (min_favorite_prob > 0.5 and min_favorite_prob <= 1);

alter table paper_trading_config
  add column if not exists favorite_stake_pct double precision not null default 0.015
    check (favorite_stake_pct > 0 and favorite_stake_pct <= 0.05);

-- Las apuestas ya colocadas (modo valor, en rojo) no se tocan: quedan en la
-- tabla como lo que fueron. `strategy` solo afecta a las apuestas NUEVAS que
-- coloque el cron a partir de aquí. Para arrancar la banca en limpio ya existe
-- el botón de reset en /paper-trading (src/components/ResetPaperBankroll.tsx).
update paper_trading_config set strategy = 'favorite' where id = 1;
