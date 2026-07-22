/**
 * Fuente histórica: tennis-data.co.uk
 *
 * Un fichero por temporada y circuito, con resultado, superficie, ronda,
 * ranking de ambos jugadores, marcador por set Y cuotas de cierre reales de
 * varias casas. Sustituye a los repos de Jeff Sackmann, que a fecha 2026-07-22
 * devuelven 404 (ver docs/00-hallazgos-fuentes.md).
 *
 * LÍMITE ACEPTADO: solo se ingieren temporadas en .xlsx (2013 en adelante). Las
 * anteriores están en .xls (formato binario BIFF, otro parser entero) y no
 * aportan lo suficiente como para justificarlo: 13 temporadas × 2 circuitos ya
 * son decenas de miles de partidos con cuotas.
 */
import { slugFromShortName, isRealPlayer, type Surface } from '@tti/model';
import type { Row } from './xlsx';

export const FIRST_XLSX_SEASON = 2013;

export interface DateFix {
  tournament: string;
  round: string | null;
  original: string;
  corrected: string;
}

export interface RawMatch {
  tour: 'ATP' | 'WTA';
  season: number;
  playedOn: string;
  tournament: string;
  location: string | null;
  series: string | null;
  surface: Surface | null;
  court: string | null;
  round: string | null;
  bestOf: number | null;
  winnerName: string;
  loserName: string;
  winnerSlug: string;
  loserSlug: string;
  winnerRank: number | null;
  loserRank: number | null;
  winnerPoints: number | null;
  loserPoints: number | null;
  wSets: number | null;
  lSets: number | null;
  sets: [number, number][];
  status: 'completed' | 'retired' | 'walkover' | 'other';
  /** Cuotas de cierre por casa, en formato ganador/perdedor. */
  odds: { bookmaker: string; winner: number; loser: number }[];
  sourceKey: string;
}

/** URL del fichero de una temporada. El sufijo 'w' marca el circuito femenino. */
export function seasonUrl(tour: 'ATP' | 'WTA', season: number): string {
  const dir = tour === 'ATP' ? `${season}` : `${season}w`;
  return `http://www.tennis-data.co.uk/${dir}/${season}.xlsx`;
}

const SURFACES: Record<string, Surface> = {
  hard: 'hard',
  clay: 'clay',
  grass: 'grass',
  carpet: 'carpet',
};

/** Columnas de cuotas: prefijo → nombre de casa en nuestra base. */
const BOOKMAKERS: Record<string, string> = {
  PS: 'pinnacle',
  B365: 'bet365',
  Max: 'market_max',
  Avg: 'market_avg',
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function statusFromComment(comment: unknown): RawMatch['status'] {
  const c = String(comment ?? '').toLowerCase();
  if (c.includes('complet')) return 'completed';
  if (c.includes('retire')) return 'retired';
  if (c.includes('walkover')) return 'walkover';
  return 'other';
}

/**
 * Convierte las filas crudas de un fichero de temporada en RawMatch.
 * El mapeo es POR NOMBRE de columna, nunca por posición: entre temporadas
 * cambian las casas de apuestas incluidas y las columnas se desplazan.
 */
export function parseSeason(rows: Row[], tour: 'ATP' | 'WTA', season: number): {
  matches: RawMatch[];
  skipped: { reason: string; count: number }[];
  dateFixes: DateFix[];
} {
  if (!rows.length) {
    return { matches: [], skipped: [{ reason: 'fichero vacío', count: 0 }], dateFixes: [] };
  }

  const header = rows[0].map((h) => String(h ?? '').trim());
  const col = new Map<string, number>();
  header.forEach((h, i) => { if (h && !col.has(h)) col.set(h, i); });
  const get = (row: Row, name: string): unknown => {
    const i = col.get(name);
    return i === undefined ? null : row[i];
  };

  const matches: RawMatch[] = [];
  const skips = new Map<string, number>();
  const skip = (reason: string) => skips.set(reason, (skips.get(reason) ?? 0) + 1);
  const seen = new Set<string>();
  const dateFixes: DateFix[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const winnerName = String(get(row, 'Winner') ?? '').trim();
    const loserName = String(get(row, 'Loser') ?? '').trim();
    if (!isRealPlayer(winnerName) || !isRealPlayer(loserName)) { skip('jugador no válido'); continue; }

    const playedOnRaw = get(row, 'Date');
    let playedOn = typeof playedOnRaw === 'string' ? playedOnRaw.slice(0, 10) : null;
    if (!playedOn || !/^\d{4}-\d{2}-\d{2}$/.test(playedOn)) { skip('fecha ilegible'); continue; }

    // La fuente tiene erratas de año puntuales (visto: la final del Iasi Open
    // 2026 fechada en 2029). Un desfase de MÁS de un año respecto a la
    // temporada es imposible, así que se corrige el año y se REPORTA — nunca en
    // silencio. El desfase de exactamente un año sí es legítimo: hay torneos
    // que arrancan a finales de diciembre de la temporada anterior.
    const year = Number(playedOn.slice(0, 4));
    if (Math.abs(year - season) > 1) {
      const corrected = `${season}${playedOn.slice(4)}`;
      dateFixes.push({
        tournament: String(get(row, 'Tournament') ?? '').trim(),
        round: String(get(row, 'Round') ?? '').trim() || null,
        original: playedOn,
        corrected,
      });
      playedOn = corrected;
    }

    const winnerSlug = slugFromShortName(winnerName);
    const loserSlug = slugFromShortName(loserName);
    if (!winnerSlug || !loserSlug || winnerSlug === loserSlug) { skip('slug degenerado'); continue; }

    const tournament = String(get(row, 'Tournament') ?? '').trim() || 'Desconocido';
    const round = String(get(row, 'Round') ?? '').trim() || null;

    // Clave de idempotencia INDEPENDIENTE DEL RESULTADO: los dos slugs van
    // ordenados alfabéticamente, así que reingerir el mismo partido nunca crea
    // un duplicado aunque la fuente corrija quién ganó.
    const [a, b] = [winnerSlug, loserSlug].sort();
    const sourceKey = `${tour}:${season}:${tournament}:${round ?? '?'}:${a}|${b}`;
    if (seen.has(sourceKey)) { skip('duplicado dentro del fichero'); continue; }
    seen.add(sourceKey);

    const surfaceRaw = String(get(row, 'Surface') ?? '').trim().toLowerCase();
    const sets: [number, number][] = [];
    for (let s = 1; s <= 5; s++) {
      const w = num(get(row, `W${s}`));
      const l = num(get(row, `L${s}`));
      if (w === null || l === null) continue;
      sets.push([w, l]);
    }

    const odds: RawMatch['odds'] = [];
    for (const [prefix, bookmaker] of Object.entries(BOOKMAKERS)) {
      const w = num(get(row, `${prefix}W`));
      const l = num(get(row, `${prefix}L`));
      // Una cuota de 1.0 o menos no es una cuota: se descarta la pareja entera
      // (el devig necesita las dos patas del mercado).
      if (w === null || l === null || w <= 1 || l <= 1) continue;
      odds.push({ bookmaker, winner: w, loser: l });
    }

    matches.push({
      tour,
      season,
      playedOn,
      tournament,
      location: (String(get(row, 'Location') ?? '').trim() || null),
      series: (String(get(row, tour === 'ATP' ? 'Series' : 'Tier') ?? '').trim() || null),
      surface: SURFACES[surfaceRaw] ?? null,
      court: (String(get(row, 'Court') ?? '').trim().toLowerCase() || null),
      round,
      bestOf: num(get(row, 'Best of')),
      winnerName,
      loserName,
      winnerSlug,
      loserSlug,
      winnerRank: num(get(row, 'WRank')),
      loserRank: num(get(row, 'LRank')),
      winnerPoints: num(get(row, 'WPts')),
      loserPoints: num(get(row, 'LPts')),
      wSets: num(get(row, 'Wsets')),
      lSets: num(get(row, 'Lsets')),
      sets,
      status: statusFromComment(get(row, 'Comment')),
      odds,
      sourceKey,
    });
  }

  return {
    matches,
    skipped: [...skips.entries()].map(([reason, count]) => ({ reason, count })),
    dateFixes,
  };
}
