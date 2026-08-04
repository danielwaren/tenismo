/**
 * "Análisis IA" — segunda lectura para la card "Mi pronóstico". NO reemplaza
 * al modelo de Tenismo (ver model-forecast.ts): interpreta, señala riesgos y
 * opina aparte, con su propia probabilidad cuando hay datos suficientes.
 *
 * No hay integración de IA en este proyecto todavía (no hay OPENAI_API_KEY
 * ni cliente equivalente en ningún sitio del repo). Por eso esto es un
 * adaptador — `AiBetAnalysisProvider` — con una única implementación real
 * hoy: `NotConfiguredAiProvider`, que devuelve un estado explícito en vez de
 * fallar en silencio o inventar una respuesta.
 *
 * CÓMO CONECTAR UN PROVEEDOR DE VERDAD MÁS ADELANTE (sin tocar la página ni
 * la API que la sirve, solo este fichero):
 *   1. Añadir la clave del proveedor como variable de entorno del servidor
 *      (nunca `PUBLIC_*` — ver src/lib/db.ts sobre por qué el secreto no
 *      debe llegar al navegador).
 *   2. Implementar `AiBetAnalysisProvider.analyze()` con el SDK real,
 *      validando la forma de la respuesta contra `AiBetAnalysis` antes de
 *      devolverla — si el proveedor devuelve algo que no encaja, tratarlo
 *      como fallo, no como un intento de "arreglarlo" adivinando.
 *   3. Cambiar `getAiProvider()` para devolver la nueva clase cuando la
 *      variable de entorno esté presente, y seguir devolviendo
 *      `NotConfiguredAiProvider` si no lo está — así un despliegue sin la
 *      clave configurada degrada con un aviso, no con un 500.
 */

export type AiAction = 'ENTER_NOW' | 'WAIT_ONE_EVENT' | 'NO_BET';

export interface AiBetAnalysis {
  action: AiAction;
  estimatedProbability: number | null;
  fairOdds: number | null;
  confidence: number | null;
  reasoning: string;
  risks: string[];
  missingData: string[];
  waitTrigger?: string;
  minimumAcceptableOdds?: number;
  updatedAt: string;
}

export interface AiAnalysisRequest {
  tour: string;
  tournament: string;
  playerOne: string;
  playerTwo: string;
  market: string;
  selection: string;
  line: number | null;
  oddsDecimal: number;
  isLive: boolean;
  liveScoreAtEntry: string | null;
  serverAtEntry: string | null;
  modelProbability: number | null;
}

export interface AiBetAnalysisProvider {
  readonly configured: boolean;
  analyze(req: AiAnalysisRequest): Promise<AiBetAnalysis>;
}

export class NotConfiguredAiProvider implements AiBetAnalysisProvider {
  readonly configured = false;

  async analyze(_req: AiAnalysisRequest): Promise<AiBetAnalysis> {
    return {
      action: 'NO_BET',
      estimatedProbability: null,
      fairOdds: null,
      confidence: null,
      reasoning: 'El análisis de IA no está configurado en este despliegue todavía.',
      risks: [],
      missingData: ['Proveedor de IA no configurado — ver src/lib/ai-analysis.ts para cómo conectar uno.'],
      updatedAt: new Date().toISOString(),
    };
  }
}

let cached: AiBetAnalysisProvider | null = null;

/** Punto único de entrada: la API y la página solo conocen esta función. */
export function getAiProvider(): AiBetAnalysisProvider {
  if (!cached) cached = new NotConfiguredAiProvider();
  return cached;
}
