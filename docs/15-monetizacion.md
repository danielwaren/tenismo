# Monetización — punto de partida, ago 2026

Pedido: empezar a generar ingresos para pagar APIs de pago (Sportradar sin
trial, más datos de estadísticas) y financiar mejoras del modelo. Esto NO se
puede automatizar del todo — crear una cuenta de AdSense, darse de alta en un
programa de afiliados, o conectar una cuenta bancaria para cobrar son pasos
que solo puede hacer el dueño del sitio (ver reglas de la sesión: nunca creo
cuentas ni entro credenciales de pago). Lo que sí se dejó listo: la
infraestructura de código para que activarlo sea pegar una clave, no escribir
nada nuevo — y esta nota, con la decisión pendiente explicada para que se
tome con información, no a ciegas.

## La decisión pendiente: AdSense tiene un riesgo real acá

Este sitio no es una casa de apuestas, pero **es contenido sobre apuestas**:
cuotas reales, un simulador de picks, probabilidades. Las políticas de
contenido de Google AdSense para "Gambling and games" son estrictas — en
muchos países exigen certificación adicional, y en algunos directamente no
sirven anuncios sobre ese contenido. Vale la pena revisar
[Google AdSense — Gambling and games policy](https://support.google.com/adsense/answer/9724)
ANTES de crear la cuenta: el riesgo no es "no funciona", es que la cuenta
completa de AdSense (si algún día sirve anuncios para otro proyecto) puede
quedar marcada.

## Tres caminos, no necesariamente excluyentes

1. **Afiliación con casas de apuestas** (el modelo clásico de un sitio de
   picks/análisis). El sitio YA muestra cuotas reales de varias casas en cada
   ficha de partido (`m.odds`, tabla "Cuotas reales") — el hueco natural es
   que esos nombres de casa sean links de afiliado en vez de texto plano.
   Suele pagar mejor que AdSense para esta audiencia, pero cada casa tiene su
   propio programa (Bet365, Pinnacle, etc.) con alta y aprobación manual.
   Regulación de apuestas por país aplica — revisar antes de firmar nada.
2. **Google AdSense** (u otra red display: Ezoic, Mediavine — Mediavine pide
   50k sesiones/mes mínimo, probablemente muy pronto para este tráfico).
   Camino más simple de activar (`AdSlot.tsx` ya deja el hueco), pero con la
   nota de arriba sobre la política de contenido.
3. **Extender "Premium" de la app móvil a la web.** Ya existe un stub
   Premium del lado servidor (`src/lib/profiles.ts`,
   `api/mobile/bets/premium.ts`) pensado para RevenueCat (compra in-app) en
   `tenismo-app/`. La web hoy no tiene login en absoluto, así que traer esto
   implicaría añadir autenticación al sitio web — bastante más trabajo que
   los otros dos caminos, pero es la única vía que no depende de mostrar
   publicidad a nadie.

**Sugerencia, no decisión tomada:** empezar por (1) — encaja mejor con el
contenido (la gente que lee una ficha de partido con cuotas reales ya está en
modo "voy a apostar"), tiene mejor techo de ingreso por visitante, y no
arriesga una cuenta de AdSense por contenido de apuestas. (2) queda como
respaldo de bajo esfuerzo si (1) tarda en aprobarse. (3) es la jugada de más
largo plazo, cuando haya tráfico suficiente para que valga la pena construir
auth en la web.

## Qué queda listo en el código

- `src/components/AdSlot.tsx` — hueco de anuncio inerte (no renderiza nada)
  hasta que `PUBLIC_ADSENSE_CLIENT_ID` tenga un valor. Ya colocado en
  `index.astro` (debajo de las tarjetas de estadísticas) y en
  `MatchDetail.tsx` (al final de la ficha). Cuando se elija red, el snippet
  real de esa red reemplaza el placeholder dentro de este componente — un
  solo archivo para tocar.
- `public/ads.txt` — vacío con instrucciones; la red elegida da la línea
  exacta que va acá para verificar el dominio.
- `.env.example` — `PUBLIC_ADSENSE_CLIENT_ID` documentado.

## Próximos pasos (para el dueño del sitio, no automatizables)

1. Decidir camino (afiliación / AdSense / Premium web) — o empezar por
   afiliación mientras se decide el resto.
2. Si es afiliación: revisar programas de afiliados de las casas que ya
   aparecen en `odds` (bet365, pinnacle, market_max/consensus son fuentes de
   datos, no necesariamente las casas con programa de afiliados — hay que
   verificar cuál de las reales lo tiene).
3. Si es AdSense: crear la cuenta, leer la política de "Gambling and games"
   primero, pegar `PUBLIC_ADSENSE_CLIENT_ID` en Vercel (mismo patrón que las
   claves VAPID en [docs/14](./14-notificaciones-push.md)) y en `ads.txt`.
4. Cualquiera sea el camino: los ingresos que se destinen a APIs de pago
   (Sportradar full, por ejemplo) son una decisión de presupuesto separada,
   no algo que este código automatice.

## Costo YA presente: The Odds API (sept 2026)

El plan gratis de [The Odds API](https://the-odds-api.com/#get-access) son
**500 créditos/mes**. Cada corrida diaria pide `h2h,totals,spreads` (3
mercados) × `eu` (1 región) = **3 créditos por torneo**; con ATP + WTA de un
Slam activo son 6/día ≈ 180/mes, holgado. Pero en sept 2026 la cuota se
agotó igual (posiblemente por semanas con más torneos cubiertos, corridas
manuales, o el ciclo del plan no alineado al mes calendario) — y `odds-ingest.ts`
tiraba un 401 duro que **frenaba todo el pipeline diario** (ver
[docs/16](./16-incidente-pronosticos-y-fixes.md)). Ya está arreglado para que
sea un no-op, pero el simulador se queda sin cuotas frescas hasta que se
restablezca.

Opciones, de menos a más plata:
- **Bajar el costo por corrida**: pedir solo `h2h` (1 crédito) en vez de los 3
  mercados. El simulador perdería los mercados de Total de Juegos y Hándicap
  (se quedaría solo con Ganador), pero triplica el margen de cuota. Cambio de
  una línea en `scripts/lib/odds-api.ts::fetchOdds` (`markets=h2h`).
- **Pedir cuotas cada 2-3 días** en vez de a diario para partidos que ya
  tienen cuota y están a >48h — la cuota de cierre es lo que importa para el
  CLV, no las capturas intermedias.
- **Subir de plan**: The Odds API arranca en ~USD 30/mes (20.000 créditos).
  Este es exactamente el tipo de gasto que la monetización tendría que cubrir.
- **Otra fuente**: si al final se paga Sportradar (que ya se usa para el
  calendario Challenger), verificar si su plan incluye cuotas de tenis y
  consolidar en un solo proveedor.
