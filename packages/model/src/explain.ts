/**
 * EXPLICABILIDAD EN PUNTOS PORCENTUALES.
 *
 * El modelo (`logreg.ts`) es lineal en logit: `logit = Σ valorᵢ·pesoᵢ`, sin
 * intercepto. La contribución de cada feature YA es exacta en espacio logit
 * (`queries.ts` la calcula como `value * weight`; la suma de todas reconstruye
 * el logit completo por construcción de un modelo lineal — no hay approximación
 * ahí).
 *
 * El problema es distinto: pasar esas contribuciones a "puntos porcentuales de
 * probabilidad final" no es lineal, porque `sigmoid` no lo es. No existe una
 * única forma "correcta" de repartir una transformación no lineal entre varias
 * variables (es el mismo problema que resuelve SHAP con valores de Shapley,
 * promediando sobre todas las permutaciones posibles — computacionalmente caro
 * para explicar un solo partido en tiempo de render).
 *
 * LA SOLUCIÓN AQUÍ: waterfall secuencial. Se parte de sigmoid(0) = 50% (la
 * probabilidad "sin información", coherente con que el modelo no tiene
 * intercepto) y se suma un feature a la vez, en un orden FIJO y documentado
 * (por |contribución| descendente — el mismo orden que ya usa la ficha de
 * partido). El delta de probabilidad de cada paso es
 * `sigmoid(acumulado_después) − sigmoid(acumulado_antes)`.
 *
 * Por qué esto es honesto y no una cifra inventada:
 *   1. Es una suma telescópica: el total de los deltas + 50% da EXACTAMENTE
 *      la probabilidad final, sin redondeo ni ajuste posterior (comprobado en
 *      el test, no solo asumido).
 *   2. Es la misma técnica que usan los "waterfall plots"/"force plots" de
 *      SHAP en producción cuando no se puede pagar el coste combinatorio real.
 *   3. Limitación declarada (no escondida): los splits INTERMEDIOS dependen
 *      del orden elegido — dos features con signos opuestos y magnitud
 *      parecida pueden "compensarse" de forma distinta según cuál vaya primero.
 *      El total no cambia nunca; el reparto intermedio sí. Por eso el orden se
 *      fija (mismo criterio en toda la app) y se documenta aquí, en vez de
 *      dejarlo implícito.
 */

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export interface WaterfallStep {
  name: string;
  /** Contribución en espacio logit (value × weight), tal como ya se calculaba. */
  logitContribution: number;
  /** Probabilidad acumulada de p1 justo ANTES de sumar este factor. */
  probBefore: number;
  /** Probabilidad acumulada de p1 justo DESPUÉS de sumar este factor. */
  probAfter: number;
  /** Lo que se muestra: cuánto sube/baja la probabilidad de p1, en pp (puede ser negativo). */
  pp: number;
}

export interface ProbabilityWaterfall {
  /** sigmoid(intercepto). En este modelo, intercepto=0 → siempre 50%. */
  baseProb: number;
  steps: WaterfallStep[];
  /** Probabilidad final de p1. Coincide con sigmoid(logit total) del modelo. */
  finalProb: number;
}

/**
 * Convierte las contribuciones YA calculadas (value × weight, en logit) en un
 * desglose en puntos porcentuales que reconcilia exactamente con la
 * probabilidad final. `contributions` debe venir en el orden en que se quiere
 * mostrar el waterfall (la ficha usa |contribución| descendente).
 */
export function contributionsToWaterfall(
  contributions: { name: string; contribution: number }[],
  intercept = 0,
): ProbabilityWaterfall {
  const baseProb = sigmoid(intercept);
  let cumulative = intercept;
  const steps: WaterfallStep[] = contributions.map((c) => {
    const probBefore = sigmoid(cumulative);
    cumulative += c.contribution;
    const probAfter = sigmoid(cumulative);
    return {
      name: c.name,
      logitContribution: c.contribution,
      probBefore,
      probAfter,
      pp: (probAfter - probBefore) * 100,
    };
  });
  return { baseProb, steps, finalProb: sigmoid(cumulative) };
}
