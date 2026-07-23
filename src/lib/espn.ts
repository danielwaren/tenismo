/**
 * Cliente de la API pública de ESPN para tenis.
 *
 * Es la fuente de lo que The Odds API y tennis-data NO dan:
 *   · torneos EN CURSO (incluidos los ATP/WTA 250 que The Odds API no cubre),
 *   · calendario de los próximos partidos de esos torneos,
 *   · marcadores EN VIVO, set por set (más finos que los de The Odds API).
 *
 * Es gratis y sin cuota (misma API que usa el proyecto de fútbol para ESPN).
 * Cubre ATP y WTA de circuito principal; **no** tiene Challenger (verificado:
 * las rutas atp-challenger / challenger / itf-men devuelven 400), así que el
 * muro del Challenger sigue en pie en todas las fuentes.
 *
 * Endpoint: site.api.espn.com/apis/site/v2/sports/tennis/{atp|wta}/scoreboard
 */

export const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/tennis';

export type EspnState = 'pre' | 'in' | 'post';

export interface EspnMatch {
  id: string;
  date: string;
  state: EspnState;
  round: string | null;
  /** Nombres completos, tal como los da ESPN ("Carlos Alcaraz"). */
  homeName: string;
  awayName: string;
  homeWon: boolean | null;
  /** Marcador por set de cada jugador, p.ej. [6,7,6]. null si no ha empezado. */
  homeScore: number[] | null;
  awayScore: number[] | null;
}

export interface EspnTournament {
  id: string;
  name: string;
  season: number;
  startDate: string | null;
  endDate: string | null;
  matches: EspnMatch[];
}

/** Ronda de ESPN ("Quarterfinal", "Round of 32", …) a nuestra nomenclatura. */
export function normalizeRound(displayName: string | null | undefined): string | null {
  if (!displayName) return null;
  const s = displayName.toLowerCase();
  if (s.includes('qualif')) return 'Qualifying';
  if (s.includes('final') && !s.includes('semi') && !s.includes('quarter')) return 'The Final';
  if (s.includes('semi')) return 'Semifinals';
  if (s.includes('quarter')) return 'Quarterfinals';
  if (s.includes('round robin')) return 'Round Robin';
  // ESPN usa tanto "Round of 16" como "4th Round" o "Round 4": todo al mismo.
  if (s.includes('round of 16') || s.includes('4th') || /\bround 4\b/.test(s)) return '4th Round';
  if (s.includes('round of 32') || s.includes('3rd') || /\bround 3\b/.test(s)) return '3rd Round';
  if (s.includes('round of 64') || s.includes('2nd') || /\bround 2\b/.test(s)) return '2nd Round';
  if (s.includes('round of 128') || s.includes('1st') || /\bround 1\b/.test(s)) return '1st Round';
  return displayName; // se conserva tal cual si no encaja (no se pierde info)
}

function linescore(c: any): number[] | null {
  const ls = c?.linescores;
  if (!Array.isArray(ls) || !ls.length) return null;
  const nums = ls.map((l: any) => Number(l?.value)).filter((n: number) => Number.isFinite(n));
  return nums.length ? nums : null;
}

/** Parsea un scoreboard de ESPN a torneos con sus partidos de INDIVIDUALES. */
export function parseScoreboard(json: any): EspnTournament[] {
  const out: EspnTournament[] = [];
  for (const ev of json?.events ?? []) {
    const matches: EspnMatch[] = [];
    for (const g of ev.groupings ?? []) {
      // Solo individuales: los dobles tienen otro rating y otra dinámica.
      const slug = g?.grouping?.slug ?? '';
      if (!/singles/i.test(slug)) continue;
      for (const c of g.competitions ?? []) {
        const comp = c.competitors ?? [];
        if (comp.length !== 2) continue;
        const home = comp.find((x: any) => x.homeAway === 'home') ?? comp[0];
        const away = comp.find((x: any) => x.homeAway === 'away') ?? comp[1];
        const homeName = home?.athlete?.fullName ?? home?.athlete?.displayName ?? '';
        const awayName = away?.athlete?.fullName ?? away?.athlete?.displayName ?? '';
        if (!homeName || !awayName) continue;
        const state = (c.status?.type?.state ?? 'pre') as EspnState;
        matches.push({
          id: String(c.id),
          date: String(c.date ?? ev.date ?? ''),
          state,
          round: normalizeRound(c.round?.displayName),
          homeName,
          awayName,
          homeWon: home?.winner === true ? true : away?.winner === true ? false : null,
          homeScore: linescore(home),
          awayScore: linescore(away),
        });
      }
    }
    out.push({
      id: String(ev.id),
      name: String(ev.name ?? ev.shortName ?? 'Torneo'),
      season: Number(ev.season?.year ?? new Date().getUTCFullYear()),
      startDate: ev.date ?? null,
      endDate: ev.endDate ?? null,
      matches,
    });
  }
  return out;
}

export async function fetchScoreboard(tour: 'atp' | 'wta'): Promise<EspnTournament[]> {
  const res = await fetch(`${ESPN_BASE}/${tour}/scoreboard`);
  if (!res.ok) throw new Error(`ESPN ${tour}: HTTP ${res.status}`);
  return parseScoreboard(await res.json());
}

/**
 * Superficie por palabra clave del nombre del torneo. ESPN no la da de forma
 * fiable en el scoreboard, así que se infiere de los torneos conocidos y, si no,
 * se deja en null (el modelo usa entonces solo el Elo global — degradación
 * honesta, no una suposición).
 */
const SURFACE_HINTS: [RegExp, string][] = [
  [/wimbledon|halle|queen|newport|s-hertogenbosch|eastbourne|mallorca|bad homburg|berlin/i, 'grass'],
  [/roland|french open|monte.?carlo|madrid|rome|barcelona|hamburg|estoril|munich|kitzbuhel|generali|umag|gstaad|bastad|houston|charleston|stuttgart|strasbourg|rabat|palermo|prague|praga|bucharest|iasi|warsaw|cluj/i, 'clay'],
];
export function surfaceHint(name: string): string | null {
  for (const [re, s] of SURFACE_HINTS) if (re.test(name)) return s;
  return null; // por defecto null; muchos hard no listados caerían aquí a propósito
}
