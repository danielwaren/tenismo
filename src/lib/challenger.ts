const BASE = 'https://api.sportradar.com/tennis';
const CATEGORY_ID = 'sr:category:72';
const CACHE_MS = 300_000;

export interface ChallengerMatch {
  id: string; startsAt: string; tournamentId: string; tournament: string;
  round: string | null; player1: string; player2: string;
  /** Marcador por sets, "4-6 7-5 7-6". Null si aún no ha empezado. */
  score: string | null;
  status: 'scheduled' | 'live' | 'completed';
}
export interface ChallengerTournament { id: string; name: string; startsAt: string; matchCount: number }
export interface ChallengerCalendarSnapshot {
  status: 'ok' | 'partial' | 'unconfigured' | 'unavailable'; tournaments: ChallengerTournament[];
  matches: ChallengerMatch[]; horizonDays: number; at: string;
  /** Qué proveedor respondió, para rotularlo con honestidad en la interfaz. */
  source: 'sportradar' | 'tennis-explorer' | null;
}

let cache: { expires: number; value: ChallengerCalendarSnapshot } | null = null;
const asRecord = (value: unknown): Record<string, any> => value && typeof value === 'object' ? value as Record<string, any> : {};
const asText = (value: unknown): string => typeof value === 'string' ? value : '';

export function parseChallengerSummaries(payload: unknown): ChallengerMatch[] {
  const summaries = Array.isArray(asRecord(payload).summaries) ? asRecord(payload).summaries : [];
  const matches: ChallengerMatch[] = [];
  for (const raw of summaries) {
    const event = asRecord(asRecord(raw).sport_event);
    const context = asRecord(event.sport_event_context);
    const category = asRecord(context.category);
    const competition = asRecord(context.competition);
    const competitors = Array.isArray(event.competitors) ? event.competitors.map(asRecord) : [];
    if (asText(category.id) !== CATEGORY_ID && !/challenger/i.test(asText(category.name))) continue;
    if (competitors.length !== 2 || (asText(event.type) && asText(event.type).toLowerCase() !== 'singles')) continue;
    matches.push({
      id: asText(event.id), startsAt: asText(event.start_time), tournamentId: asText(competition.id),
      tournament: asText(competition.name) || 'ATP Challenger', round: asText(asRecord(context.round).name) || null,
      player1: asText(competitors[0].name), player2: asText(competitors[1].name),
      score: null, status: 'scheduled',
    });
  }
  return matches.filter((match) => match.id && match.startsAt && match.tournamentId && match.player1 && match.player2);
}

export async function getChallengerCalendar(): Promise<ChallengerCalendarSnapshot> {
  if (cache && Date.now() < cache.expires) return cache.value;
  const apiKey = process.env.SPORTRADAR_TENNIS_API_KEY?.trim();
  const horizonDays = Math.min(30, Math.max(1, Number(process.env.SPORTRADAR_TENNIS_HORIZON_DAYS) || 14));
  // Sin clave de Sportradar (de pago) se cae a tennisexplorer.com, que es
  // gratis y cuyo robots.txt lo permite. Da los partidos del DÍA con su
  // marcador, no un calendario a 14 días: menos alcance, pero es la única
  // cobertura Challenger gratuita que existe (ESPN no tiene ninguno).
  if (!apiKey) return getChallengerFromExplorer(horizonDays);
  const access = process.env.SPORTRADAR_TENNIS_ACCESS_LEVEL?.trim() || 'trial';
  const language = process.env.SPORTRADAR_TENNIS_LANGUAGE?.trim() || 'en';
  const outcomes = await Promise.allSettled(Array.from({ length: horizonDays }, async (_, offset) => {
    const date = new Date(); date.setUTCDate(date.getUTCDate() + offset);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const day = date.toISOString().slice(0, 10);
      const response = await fetch(`${BASE}/${access}/v3/${language}/schedules/${day}/summaries.json?api_key=${encodeURIComponent(apiKey)}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Sportradar HTTP ${response.status}`);
      return parseChallengerSummaries(await response.json());
    } finally { clearTimeout(timer); }
  }));
  const matches = outcomes.flatMap((outcome) => outcome.status === 'fulfilled' ? outcome.value : []).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const grouped = new Map<string, ChallengerTournament>();
  for (const match of matches) {
    const current = grouped.get(match.tournamentId);
    if (current) { current.matchCount++; if (match.startsAt < current.startsAt) current.startsAt = match.startsAt; }
    else grouped.set(match.tournamentId, { id: match.tournamentId, name: match.tournament, startsAt: match.startsAt, matchCount: 1 });
  }
  const available = outcomes.filter((outcome) => outcome.status === 'fulfilled').length;
  const value: ChallengerCalendarSnapshot = {
    status: available === 0 ? 'unavailable' : available < horizonDays ? 'partial' : 'ok',
    tournaments: [...grouped.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt)), matches, horizonDays,
    at: new Date().toISOString(), source: 'sportradar',
  };
  cache = { expires: Date.now() + CACHE_MS, value };
  return value;
}

/**
 * Challenger desde tennisexplorer.com — la vía gratuita.
 *
 * Se usa cuando no hay clave de Sportradar. Devuelve el MISMO
 * ChallengerCalendarSnapshot para que la interfaz no tenga que saber de dónde
 * vienen los datos, pero con dos diferencias honestas que la vista rotula:
 * solo cubre el día en curso (no un horizonte de 14 días) y trae marcador.
 *
 * El parser vive en scripts/lib/tennis-explorer.ts, con sus tests sobre HTML
 * real de la fuente.
 */
async function getChallengerFromExplorer(horizonDays: number): Promise<ChallengerCalendarSnapshot> {
  const vacio = (status: ChallengerCalendarSnapshot['status']): ChallengerCalendarSnapshot => ({
    status, tournaments: [], matches: [], horizonDays, at: new Date().toISOString(), source: 'tennis-explorer',
  });

  let torneos;
  try {
    const { fetchMatchesPage, parseMatchesPage, esChallenger } = await import('../../scripts/lib/tennis-explorer');
    torneos = parseMatchesPage(await fetchMatchesPage()).filter(esChallenger);
  } catch (error) {
    console.warn('[challenger] tennisexplorer no disponible:', (error as Error).message);
    return vacio('unavailable');
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const matches: ChallengerMatch[] = [];
  for (const t of torneos) {
    for (const m of t.matches) {
      const sets = m.gamesP1.map((g, i) => `${g}-${m.gamesP2[i]}`).join(' ');
      matches.push({
        id: m.sourceId || `${t.slug}:${m.player1}:${m.player2}`,
        // La fuente publica la HORA, no la fecha: son los partidos de hoy.
        // OJO: esa hora es la local de la fuente (centroeuropea), y aquí se
        // marca como Z. No es un instante UTC correcto — es la hora publicada,
        // guardada tal cual para que la vista (que formatea en UTC) muestre
        // exactamente lo que muestra el origen. Si algún día se compara con
        // horas de otras fuentes, hay que convertirla antes.
        startsAt: `${hoy}T${m.time ?? '00:00'}:00Z`,
        tournamentId: t.slug, tournament: t.name, round: null,
        player1: m.player1, player2: m.player2,
        score: sets || null, status: m.status,
      });
    }
  }
  matches.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const tournaments: ChallengerTournament[] = torneos.map((t) => ({
    id: t.slug, name: t.name,
    startsAt: matches.find((m) => m.tournamentId === t.slug)?.startsAt ?? `${hoy}T00:00:00Z`,
    matchCount: t.matches.length,
  }));

  const value: ChallengerCalendarSnapshot = {
    status: matches.length ? 'ok' : 'unavailable',
    tournaments, matches, horizonDays, at: new Date().toISOString(), source: 'tennis-explorer',
  };
  cache = { expires: Date.now() + CACHE_MS, value };
  return value;
}
