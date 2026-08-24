/**
 * Genera el texto para "Copiar informe para X" desde la ficha de un partido.
 *
 * Nunca publica nada por sí sola: solo arma texto para copiar/pegar, o para
 * precargar el compositor de X (que el usuario tiene que confirmar a mano).
 *
 * Presupuesto de 140 caracteres — más corto que el límite real de X hoy (280)
 * por elección: un post corto se lee entero sin "Ver más" y se comparte
 * mejor. El enlace pesa siempre 23 (igual que t.co en la cuenta real de X, que
 * envuelve todo enlace a ese tamaño fijo sin importar su longitud real), así
 * que no hace falta acortarlo aparte.
 */

/**
 * Dominio público del sitio (alias limpio del proyecto "tenismo" en Vercel,
 * confirmado vía API — no `tenismo-git-main-...` ni el hash de un deploy
 * suelto). Fijo a propósito, NUNCA `window.location.origin`: un enlace
 * público en X tiene que apuntar siempre a producción, aunque el texto se
 * genere en local o en un preview deploy — nadie debería poder compartir por
 * accidente un link a `localhost` o a una URL de preview.
 */
export const SITE_ORIGIN = 'https://tenismo.vercel.app';

export interface XShareMatch {
  p1Name: string;
  p2Name: string;
  probP1: number | null;
  tour: string;
  tournament: string;
  round: string | null;
  status: string;
  p1Won: number | null;
  /** Marcador set por set orientado a p1/p2 (vacío si no ha terminado). */
  sets: { p1: number; p2: number }[];
  /** URL absoluta a la ficha del partido — SITE_ORIGIN + matchPath(match), armada por el llamador. */
  matchUrl: string | null;
}

const TCO_WEIGHT = 23;
const BUDGET = 140;
const TOUR_TAG: Record<string, string> = { ATP: '#ATP', WTA: '#WTA', Challenger: '#Challenger', ITF: '#ITF' };
const STOPWORDS = new Set([
  'open', 'cup', 'championship', 'championships', 'masters', 'classic', 'international',
  'tour', 'the', 'of', 'and', 'powered', 'by', 'women', 'womens', 's', 'group', 'financial',
]);

/** "Etcheverry T. M." → "Etcheverry" — misma convención que el resto de la ficha (MatchDetail.tsx). */
function surname(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * Quita acentos/diacríticos: descompone (NFD, "é" → "e" + acento suelto) y
 * filtra los code points de marcas combinantes (U+0300–U+036F). Se evita un
 * literal Unicode directo en el regex —fácil de corromper al copiar/pegar—
 * usando el código numérico del rango.
 */
function stripAccents(s: string): string {
  return Array.from(s.normalize('NFD'))
    .filter((ch) => { const cp = ch.codePointAt(0)!; return cp < 0x0300 || cp > 0x036f; })
    .join('');
}

/** Hashtag válido: sin espacios/signos/acentos (mejor alcance en la búsqueda de X). */
function toHashtag(raw: string): string {
  const clean = stripAccents(raw).replace(/[^a-zA-Z0-9]/g, '');
  return clean ? `#${clean}` : '';
}

/** Longitud "a la X": cada URL cuenta fijo 23, el resto cuenta por code point (soporta emoji). */
function xLength(text: string): number {
  const urlRe = /https?:\/\/\S+/g;
  const urls = text.match(urlRe) ?? [];
  const withoutUrls = text.replace(urlRe, '');
  return Array.from(withoutUrls).length + urls.length * TCO_WEIGHT;
}

/** Primeras 1-2 palabras significativas del nombre del torneo, para hashtag y para contexto corto. */
function tournamentWords(tournament: string): string[] {
  return stripAccents(tournament)
    .split(/[^a-zA-Z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()));
}

function shortTournament(tournament: string): string {
  const words = tournamentWords(tournament);
  return words.length ? words.slice(0, 2).join(' ') : tournament;
}

function hashtagsFor(m: XShareMatch, favSurname: string, rivSurname: string): string[] {
  const words = tournamentWords(m.tournament);
  const tournamentTag = words.length ? toHashtag(words.slice(0, 2).join('')) : '';
  return [toHashtag(favSurname), toHashtag(rivSurname), TOUR_TAG[m.tour] ?? '', tournamentTag, '#Tenis']
    .filter((t, i, arr) => t && arr.indexOf(t) === i); // sin duplicados (p. ej. torneo homónimo del apellido)
}

/** Marcador orientado al ganador primero: "6-4, 3-6, 6-2". */
function scoreFromWinner(sets: { p1: number; p2: number }[], winnerIsP1: boolean): string {
  return sets.map((s) => (winnerIsP1 ? `${s.p1}-${s.p2}` : `${s.p2}-${s.p1}`)).join(', ');
}

/** Junta líneas no vacías, probando de más a menos contenido hasta caber en el presupuesto. */
function assemble(parts: { core: string; context: string; link: string; tags: string[] }): string {
  const variants: string[] = [];
  const withTags = (n: number) => parts.tags.slice(0, n).join(' ');

  for (const tags of [parts.tags.length, 4, 3, 2]) {
    for (const ctx of [parts.context, '']) {
      const line1 = ctx ? `${parts.core} · ${ctx}` : parts.core;
      const lines = [line1, parts.link, withTags(tags)].filter(Boolean);
      variants.push(lines.join('\n'));
    }
  }
  // Última red de seguridad: solo el núcleo + torneo/circuito, sin enlace.
  variants.push([parts.core, withTags(2)].filter(Boolean).join('\n'));
  variants.push(parts.core);

  const fit = variants.find((v) => xLength(v) <= BUDGET);
  if (fit) return fit;
  // Nunca debería llegar aquí con apellidos razonables, pero por si acaso:
  // recorta el núcleo a lo bruto en vez de devolver un texto que rompe el límite.
  const core = parts.core;
  let cut = core;
  while (xLength(cut) > BUDGET - 1 && cut.length > 1) cut = cut.slice(0, -1);
  return `${cut}…`;
}

export function buildXPost(m: XShareMatch): string {
  const p1IsFav = m.probP1 === null || m.probP1 >= 0.5;

  if (m.status === 'completed' && m.p1Won !== null) {
    const winnerIsP1 = m.p1Won === 1;
    const winner = surname(winnerIsP1 ? m.p1Name : m.p2Name);
    const loser = surname(winnerIsP1 ? m.p2Name : m.p1Name);
    const acerto = m.probP1 !== null && p1IsFav === winnerIsP1;
    const score = m.sets.length ? scoreFromWinner(m.sets, winnerIsP1) : '';

    const core = m.probP1 !== null
      ? `🎾 ${acerto ? '✅ Acertamos' : '❌ Fallamos'}: ${winner} venció a ${loser}${score ? ` ${score}` : ''}`
      : `🎾 ${winner} venció a ${loser}${score ? ` ${score}` : ''}`;

    return assemble({
      core,
      context: `${shortTournament(m.tournament)}${m.round ? ` · ${m.round}` : ''}`,
      link: m.matchUrl ?? '',
      tags: hashtagsFor(m, winner, loser),
    });
  }

  const favName = p1IsFav ? m.p1Name : m.p2Name;
  const rivName = p1IsFav ? m.p2Name : m.p1Name;
  const favSurname = surname(favName);
  const rivSurname = surname(rivName);
  const pct = m.probP1 !== null ? Math.round((p1IsFav ? m.probP1 : 1 - m.probP1) * 100) : null;

  const core = pct !== null
    ? `🎾 Pronóstico Tenismo: ${favSurname} ${pct}% favorito ante ${rivSurname}`
    : `🎾 ${favSurname} vs ${rivSurname}`;

  return assemble({
    core,
    context: `${shortTournament(m.tournament)}${m.round ? ` · ${m.round}` : ''}`,
    link: m.matchUrl ?? '',
    tags: hashtagsFor(m, favSurname, rivSurname),
  });
}

/** URL del compositor de X con el texto precargado — el usuario sigue teniendo que confirmar el posteo ahí. */
export function xIntentUrl(text: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}
