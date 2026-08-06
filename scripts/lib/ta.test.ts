import { describe, it, expect } from 'vitest';
import {
  parsePlayerPage,
  extractMatchmx,
  taNameFromFullName,
  taSlug,
  playerUrl,
  assertAllowedPath,
  parseScore,
  sameScore,
  isoDate,
  extractPhoto,
} from './ta';

/**
 * Filas REALES tomadas de la ficha de Djokovic el 2026-07-31. Se conservan
 * literales a propósito: son la prueba de que el mapeo de columnas es correcto
 * y no una interpretación. Si Tennis Abstract cambia el formato, estos tests
 * caen y avisan antes de que la ingesta escriba números mal colocados.
 *
 * Doha 2017, final, Djokovic gana 6-3 5-7 6-4:
 *   16 + 15 = 31 juegos al saque = 9+12+10 juegos del marcador ✓
 *   Djokovic salva 5 de 7 break points → le rompen 2 (perdió el 2º set 5-7) ✓
 *   Murray salva 1 de 4 → le rompen 3 ✓
 *
 * Wimbledon 2026, semifinal, Djokovic pierde 6-4 6-4 6-4:
 *   15 + 15 = 30 juegos = 10+10+10 ✓
 *   Sinner: 16 aces, afronta 1 break point y lo salva ✓
 */
const DOHA = `["20170102", "Doha", "Hard", "A", "W", "2", "2", "", "F", "6-3 5-7 6-4", "3", "Andy Murray", "1", "1", "", "R", "29.6372347707", "190", "GBR", "0", "174", "2", "3", "110", "79", "54", "19", "16", "5", "7", "8", "4", "84", "50", "39", "16", "15", "1", "4", "2", "20170107-M-Doha-F-Novak_Djokovic-Andy_Murray.html", "", "", "2017-0451-300", "", "", "", "103819"]`;

const WIMBLEDON = `["20260629", "Wimbledon", "Grass", "G", "L", "8", "7", "", "SF", "6-4 6-4 6-4", "5", "Jannik Sinner", "1", "1", "", "R", "20010816", "191", "ITA", "0", "140", "8", "3", "105", "67", "51", "13", "15", "10", "13", "16", "0", "79", "51", "45", "17", "15", "1", "1", "2", "20260710-M-Wimbledon-SF-Novak_Djokovic-Jannik_Sinner", "", "", "2026-540-601", "", "", "", "206173"]`;

/** Challenger sin estadísticas (2005): la fuente deja los campos vacíos. */
const SANREMO = `["20050509", "San Remo CH", "Clay", "C", "W", "142", "7", "", "F", "6-3 7-6(4)", "3", "Francesco Aldi", "137", "5", "", "R", "19810917", "175", "ITA", "0", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "2005-284-031", "", "", "", "103849"]`;

const page = (fullname: string, rows: string[]) => `
  <html><head><title>x</title></head><body>
  <script>
    var fullname = '${fullname}';
    var currentrank=1;
    var ychoices=["Time Span", "Career"];
    matchmx = [${rows.join(',\n')}];
    var otro = [[1,2],[3,4]];
  </script></body></html>`;

describe('taNameFromFullName', () => {
  it('quita espacios, acentos y puntuación', () => {
    expect(taNameFromFullName('Novak Djokovic')).toBe('NovakDjokovic');
    expect(taNameFromFullName('Félix Auger-Aliassime')).toBe('FelixAugerAliassime');
    expect(taNameFromFullName("Alex de Minaur")).toBe('AlexdeMinaur');
  });
});

describe('taSlug', () => {
  it('produce el slug canónico del proyecto', () => {
    expect(taSlug('Mattia Bellucci')).toBe('bellucci-m');
    expect(taSlug('Novak Djokovic')).toBe('djokovic-n');
  });
});

describe('robots.txt', () => {
  it('la URL de ficha ATP está permitida', () => {
    expect(playerUrl('NovakDjokovic')).toContain('/cgi-bin/player-classic.cgi');
  });

  it('rechaza las rutas que robots.txt prohíbe', () => {
    for (const bad of ['/jsmatches/NovakDjokovic.js', '/jsplayers/curr_rank_atp.js', '/jsfrags/x.js']) {
      expect(() => assertAllowedPath(bad)).toThrow(/prohibida/i);
    }
  });
});

describe('extractMatchmx', () => {
  it('no se pasa de largo hasta el siguiente array de la página', () => {
    const literal = extractMatchmx(page('Novak Djokovic', [DOHA]));
    expect(literal).not.toBeNull();
    expect(() => JSON.parse(literal!)).not.toThrow();
    expect(JSON.parse(literal!)).toHaveLength(1);
  });

  it('respeta los corchetes dentro de las cadenas', () => {
    const raro = DOHA.replace('"Doha"', '"Doha [indoor]"');
    const literal = extractMatchmx(page('Novak Djokovic', [raro]));
    expect(JSON.parse(literal!)[0][1]).toBe('Doha [indoor]');
  });
});

describe('parsePlayerPage — validación de identidad', () => {
  it('rechaza la ficha si la web devuelve otro jugador', () => {
    // Caso real: pedir una jugadora WTA al endpoint ATP devolvió 605 KB de
    // Benoit Paire con HTTP 200. Sin esta comprobación se ingeriría entero.
    const html = page('Benoit Paire', [DOHA]);
    expect(() => parsePlayerPage(html, 'ArynaSabalenka')).toThrow(/devolvió OTRO jugador/);
  });

  it('acepta la ficha correcta pese a acentos y guiones', () => {
    const html = page('Felix Auger-Aliassime', [DOHA]);
    expect(() => parsePlayerPage(html, 'FelixAugerAliassime')).not.toThrow();
  });

  it('falla si no hay fullname (página de error)', () => {
    expect(() => parsePlayerPage('<html>error code: 1015</html>', 'NovakDjokovic')).toThrow(/fullname/);
  });
});

describe('parsePlayerPage — mapeo de columnas', () => {
  const { matches } = parsePlayerPage(page('Novak Djokovic', [DOHA, WIMBLEDON, SANREMO]), 'NovakDjokovic');
  const [doha, wim, sanremo] = matches;

  it('lee la cabecera del partido', () => {
    expect(doha.eventDate).toBe('2017-01-02'); // inicio del torneo, no del partido
    expect(doha.event).toBe('Doha');
    expect(doha.surface).toBe('Hard');
    expect(doha.level).toBe('A');
    expect(doha.round).toBe('F');
    expect(doha.bestOf).toBe(3);
    expect(doha.score).toBe('6-3 5-7 6-4');
    expect(doha.minutes).toBe(174);
    expect(wim.bestOf).toBe(5);
    expect(wim.level).toBe('G');
  });

  it('ordena los lados por slug, no por resultado', () => {
    // djokovic-n < murray-a  → Djokovic es A aunque ganó
    expect(doha.a.slug).toBe('djokovic-n');
    expect(doha.b.slug).toBe('murray-a');
    expect(doha.winnerSlug).toBe('djokovic-n');
    // djokovic-n < sinner-j → Djokovic es A aunque perdió
    expect(wim.a.slug).toBe('djokovic-n');
    expect(wim.winnerSlug).toBe('sinner-j');
  });

  it('coloca los 9 campos de cada lado en su sitio', () => {
    expect(doha.a.stats).toEqual({
      ace: 2, df: 3, svpt: 110, firstIn: 79, firstWon: 54,
      secondWon: 19, svGms: 16, bpSaved: 5, bpFaced: 7,
    });
    expect(doha.b.stats).toEqual({
      ace: 8, df: 4, svpt: 84, firstIn: 50, firstWon: 39,
      secondWon: 16, svGms: 15, bpSaved: 1, bpFaced: 4,
    });
    expect(wim.b.stats.ace).toBe(16);
    expect(wim.b.stats.bpFaced).toBe(1);
    expect(wim.b.stats.bpSaved).toBe(1);
  });

  // OJO para el motor Markov: el TIE-BREAK NO cuenta como juego al saque (el
  // saque alterna dentro de él). Comprobado sobre los 1.421 partidos enlazados:
  // `juegos del marcador − nº de tie-breaks == suma de serve_games` en el 96 %.
  // Los dos partidos de este test no tienen tie-break, así que la suma es exacta.
  it('los juegos al saque cuadran con el marcador', () => {
    const juegos = (s: string) =>
      s.split(' ').reduce((t, set) => {
        const [x, y] = set.replace(/\(\d+\)/, '').split('-').map(Number);
        return t + x + y;
      }, 0);
    expect(doha.a.stats.svGms! + doha.b.stats.svGms!).toBe(juegos('6-3 5-7 6-4')); // 31
    expect(wim.a.stats.svGms! + wim.b.stats.svGms!).toBe(juegos('6-4 6-4 6-4')); // 30
  });

  it('lee el ranking de ambos', () => {
    expect(doha.a.rank).toBe(2);
    expect(doha.b.rank).toBe(1);
  });

  it('enlaza con el Match Charting Project cuando existe', () => {
    expect(doha.mcpChartId).toMatch(/^20170107-M-Doha-F-/);
    expect(sanremo.mcpChartId).toBeNull();
  });

  it('marca sin estadísticas los partidos que no las traen', () => {
    expect(doha.hasStats).toBe(true);
    expect(sanremo.hasStats).toBe(false);
    expect(sanremo.a.stats.svpt).toBeNull();
    // Pero el resultado sí se conserva: en ITF/Challenger antiguo hay Elo
    // aunque no haya Markov.
    expect(sanremo.score).toBe('6-3 7-6(4)');
    expect(sanremo.winnerSlug).toBe('djokovic-n');
  });

  it('la clave es simétrica entre las dos fichas del mismo partido', () => {
    // La misma fila vista desde la ficha de Murray: W/L invertido, bloques
    // de estadísticas intercambiados, rival = Djokovic.
    const desdeMurray = `["20170102", "Doha", "Hard", "A", "L", "1", "1", "", "F", "6-3 5-7 6-4", "3", "Novak Djokovic", "2", "2", "", "R", "29.6", "188", "SRB", "0", "174", "8", "4", "84", "50", "39", "16", "15", "1", "4", "2", "3", "110", "79", "54", "19", "16", "5", "7", "2", "20170107-M-Doha-F-Novak_Djokovic-Andy_Murray.html", "", "", "2017-0451-300", "", "", "", "104925"]`;
    const otra = parsePlayerPage(page('Andy Murray', [desdeMurray]), 'AndyMurray').matches[0];

    expect(otra.key).toBe(doha.key);
    expect(otra.a.slug).toBe(doha.a.slug);
    expect(otra.a.stats).toEqual(doha.a.stats);
    expect(otra.b.stats).toEqual(doha.b.stats);
    expect(otra.winnerSlug).toBe(doha.winnerSlug);
  });

  it('recoge los rivales para la bola de nieve', () => {
    const { opponents } = parsePlayerPage(page('Novak Djokovic', [DOHA, WIMBLEDON]), 'NovakDjokovic');
    expect(opponents.map((o) => o.taName).sort()).toEqual(['AndyMurray', 'JannikSinner']);
    expect(opponents.find((o) => o.taName === 'JannikSinner')?.taId).toBe('206173');
  });
});

describe('marcadores', () => {
  it('descarta los desempates entre paréntesis', () => {
    expect(parseScore('6-3 7-6(4)')).toEqual([[6, 3], [7, 6]]);
  });

  it('ignora los sufijos de retirada', () => {
    expect(parseScore('6-3 2-1 RET')).toEqual([[6, 3], [2, 1]]);
    expect(parseScore('W/O')).toBeNull();
  });

  it('descarta el set a cero de una retirada antes de empezarlo', () => {
    // TA anota "6-3 0-0 RET"; tennis-data guarda solo [[6,3]]. Sin esto, ningún
    // partido con abandono se empareja.
    expect(parseScore('6-3 0-0 RET')).toEqual([[6, 3]]);
    expect(sameScore('6-4 0-0 RET', '6-4')).toBe(true);
    // Un 0-0 que no está al final sí es información: no se toca.
    expect(parseScore('0-0')).toEqual([[0, 0]]);
  });

  it('compara marcadores equivalentes', () => {
    expect(sameScore('6-3 7-6(4)', '6-3 7-6')).toBe(true);
    expect(sameScore('6-3 5-7 6-4', '6-3 5-7 6-3')).toBe(false);
    expect(sameScore('6-3', null)).toBe(false);
  });
});

describe('isoDate', () => {
  it('convierte el formato de la fuente', () => {
    expect(isoDate('20260629')).toBe('2026-06-29');
    expect(isoDate('')).toBeNull();
    expect(isoDate('2026')).toBeNull();
  });
});

describe('extractPhoto', () => {
  const ficha = (extra: string) => `var fullname = 'Carlos Alcaraz';\n${extra}`;

  it('construye la URL como la propia ficha', () => {
    const p = extractPhoto(
      ficha(`var photog = '350z33';
             var photog_credit = '350z33';
             var photog_link = 'https://en.wikipedia.org/wiki/User:350z33';`),
    );
    expect(p).toEqual({
      url: 'https://www.tennisabstract.com/photos/carlos_alcaraz-350z33.jpg',
      credit: '350z33',
      creditUrl: 'https://en.wikipedia.org/wiki/User:350z33',
    });
  });

  it('nombres compuestos van con guion bajo', () => {
    const html = `var fullname = 'Jan Lennard Struff';
      var photog = 'foo'; var photog_credit = 'Foo'; var photog_link = 'https://x.test/foo';`;
    expect(extractPhoto(html)?.url).toBe(
      'https://www.tennisabstract.com/photos/jan_lennard_struff-foo.jpg',
    );
  });

  // La ficha misma no pinta foto si photog está vacío o no existe.
  it('sin fotógrafo no hay foto', () => {
    expect(extractPhoto(ficha(`var photog = '';`))).toBeNull();
    expect(extractPhoto(ficha(''))).toBeNull();
  });

  // Son fotos con licencia: sin a quién acreditar, no se usan.
  it('sin enlace de atribución no se devuelve la foto', () => {
    expect(extractPhoto(ficha(`var photog = '350z33'; var photog_credit = '350z33';`))).toBeNull();
  });

  it('sin fullname no hay nada que construir', () => {
    expect(extractPhoto(`var photog = 'x'; var photog_link = 'https://x.test';`)).toBeNull();
  });
});
