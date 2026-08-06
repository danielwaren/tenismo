import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMatchesPage, esChallenger, assertAllowedPath } from './tennis-explorer';

/**
 * HTML REAL recortado de /matches/ el 2026-08-06 (Hagen challenger). Se guarda
 * literal a propósito: si la fuente cambia el marcado, estos tests caen y
 * avisan antes de que la ingesta escriba marcadores mal leídos.
 */
const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'tennis-explorer-matches.html'),
  'utf8',
);

describe('robots.txt', () => {
  it('rechaza las rutas prohibidas', () => {
    for (const bad of ['/redirect/x', '/terms-of-use/', '/contact/']) {
      expect(() => assertAllowedPath(bad)).toThrow(/prohibida/i);
    }
  });

  it('permite la página de partidos', () => {
    expect(() => assertAllowedPath('/matches/')).not.toThrow();
  });
});

describe('parseMatchesPage', () => {
  const torneos = parseMatchesPage(fixture);

  it('reconoce el torneo y lo marca como Challenger', () => {
    expect(torneos.length).toBeGreaterThan(0);
    const hagen = torneos.find((t) => /hagen/i.test(t.name));
    expect(hagen).toBeDefined();
    expect(hagen!.slug).toBe('/hagen-challenger/2026/atp-men/');
    expect(esChallenger(hagen!)).toBe(true);
  });

  it('empareja las dos filas de cada partido', () => {
    const m = torneos.flatMap((t) => t.matches);
    expect(m.length).toBeGreaterThan(0);
    for (const match of m) {
      expect(match.player1).toBeTruthy();
      expect(match.player2).toBeTruthy();
      expect(match.player1).not.toBe(match.player2);
      // Los juegos por set van emparejados: si no, el marcador estaría torcido.
      expect(match.gamesP1).toHaveLength(match.gamesP2.length);
    }
  });

  // Giustino gana 4-6 7-5 7-6(4). El tercer set trae `6<sup>4</sup>` en la
  // fila del rival: 6 juegos y 4 PUNTOS del tie-break. Antes se leía como set
  // nulo y acababa anotado 7-0, así que este caso se fija aquí.
  it('lee el marcador del partido conocido del fixture, con tie-break', () => {
    const giustino = torneos
      .flatMap((t) => t.matches)
      .find((m) => /Giustino/i.test(m.player1) || /Giustino/i.test(m.player2));
    expect(giustino).toBeDefined();
    expect(giustino!.setsP1).toBe(2);
    expect(giustino!.setsP2).toBe(1);
    expect(giustino!.gamesP1).toEqual([4, 7, 7]);
    expect(giustino!.gamesP2).toEqual([6, 5, 6]);
    expect(giustino!.status).toBe('completed');
    expect(giustino!.sourceId).toBe('3287621');
  });

  it('el tie-break no se cuela como juegos', () => {
    // `7<sup>10</sup>` son 7 juegos, nunca 7 y 10.
    const html =
      '<tr class="head flags"><td class="t-name" colspan="2"><a href="/x-challenger/2026/atp-men/">X challenger</a></td></tr>' +
      '<tr id="r1" class="one"><td class="t-name"><a href="/player/a/">A</a></td><td class="result">2</td>' +
      '<td class="score">7<sup>10</sup></td><td class="score">6</td>' +
      '<td rowspan="2"><a href="/match-detail/?id=1">info</a></td></tr>' +
      '<tr id="r1b" class="one"><td class="t-name"><a href="/player/b/">B</a></td><td class="result">0</td>' +
      '<td class="score">6</td><td class="score">4</td></tr>';
    const m = parseMatchesPage(html)[0].matches[0];
    expect(m.gamesP1).toEqual([7, 6]);
    expect(m.gamesP2).toEqual([6, 4]);
  });

  it('quita el número de cabeza de serie del nombre', () => {
    for (const m of torneos.flatMap((t) => t.matches)) {
      expect(m.player1).not.toMatch(/\(\d+\)$/);
      expect(m.player2).not.toMatch(/\(\d+\)$/);
    }
  });

  it('no inventa torneos vacíos', () => {
    for (const t of torneos) expect(t.matches.length).toBeGreaterThan(0);
  });

  // Una cabecera sin <a> (p. ej. "Futures 2026") tiraba en silencio TODOS sus
  // partidos: 96 de los 163 de la página real del 6-ago se perdían así.
  it('no pierde los partidos de una cabecera sin enlace', () => {
    const html =
      '<tr class="head flags"><td class="t-name" colspan="2"><span class="fl fl-all"></span>Futures 2026</td></tr>' +
      '<tr id="r1" class="one"><td class="t-name"><a href="/player/a/">A</a></td><td class="result">2</td>' +
      '<td class="score">6</td><td rowspan="2"><a href="/match-detail/?id=7">info</a></td></tr>' +
      '<tr id="r1b" class="one"><td class="t-name"><a href="/player/b/">B</a></td><td class="result">0</td>' +
      '<td class="score">3</td></tr>';
    const t = parseMatchesPage(html);
    expect(t).toHaveLength(1);
    expect(t[0].name).toBe('Futures 2026');
    expect(t[0].matches).toHaveLength(1);
  });

  // La celda de la hora arrastra un icono de TV y un div con enlaces de
  // afiliados; limpiarla entera dejaba "18:30 Live streams 1xBet…" y la hora
  // acababa en null, así que TODOS los partidos salían a las 00:00.
  it('lee la hora aunque la celda traiga enlaces de streams', () => {
    const html =
      '<tr class="head flags"><td class="t-name" colspan="2"><a href="/x-challenger/2026/atp-men/">X challenger</a></td></tr>' +
      '<tr id="r1" class="one"><td class="first time" rowspan="2">18:30<br /><img src="/res/img/icon-tv.gif" />' +
      '<div class="streams"><div class="head tl">Live&nbsp;streams</div><div class="body"><a href="http://x">1xBet</a></div></div></td>' +
      '<td class="t-name"><a href="/player/a/">A</a></td><td class="result">&nbsp;</td><td class="score">&nbsp;</td></tr>' +
      '<tr id="r1b" class="one"><td class="t-name"><a href="/player/b/">B</a></td><td class="result">&nbsp;</td><td class="score">&nbsp;</td></tr>';
    expect(parseMatchesPage(html)[0].matches[0].time).toBe('18:30');
  });

  // La página trae una segunda tabla con ids `sN` que es la del día anterior.
  it('ignora la tabla del día anterior (ids sN)', () => {
    const html =
      '<tr class="head flags"><td class="t-name" colspan="2"><a href="/x/2026/atp-men/">X</a></td></tr>' +
      '<tr id="s1" class="one"><td class="t-name"><a href="/player/a/">A</a></td><td class="result">2</td><td class="score">6</td></tr>' +
      '<tr id="s1b" class="one"><td class="t-name"><a href="/player/b/">B</a></td><td class="result">0</td><td class="score">3</td></tr>';
    expect(parseMatchesPage(html)).toHaveLength(0);
  });
});

describe('estados', () => {
  const fila = (id: string, nombre: string, result: string, juegos: (string | number)[]) =>
    `<tr id="${id}" class="one"><td class="first time" rowspan="2">11:05</td>` +
    `<td class="t-name"><a href="/player/x/">${nombre}</a></td>` +
    `<td class="result">${result}</td>` +
    juegos.map((g) => `<td class="score">${g}</td>`).join('') +
    `<td rowspan="2"><a href="/match-detail/?id=999">info</a></td></tr>`;
  const tabla = (filas: string) =>
    `<tr class="head flags"><td class="t-name" colspan="2"><a href="/x-challenger/2026/atp-men/">X challenger</a></td></tr>${filas}`;

  it('sin juegos anotados es programado', () => {
    const html = tabla(fila('r1', 'A', '&nbsp;', ['&nbsp;', '&nbsp;']) + fila('r1b', 'B', '&nbsp;', ['&nbsp;', '&nbsp;']));
    expect(parseMatchesPage(html)[0].matches[0].status).toBe('scheduled');
  });

  it('con juegos pero sin sets decididos es en juego', () => {
    const html = tabla(fila('r1', 'A', '&nbsp;', [6, 3]) + fila('r1b', 'B', '&nbsp;', [4, 2]));
    const m = parseMatchesPage(html)[0].matches[0];
    expect(m.status).toBe('live');
    expect(m.gamesP1).toEqual([6, 3]);
  });

  it('con sets decididos es terminado', () => {
    const html = tabla(fila('r1', 'A', '2', [6, 6]) + fila('r1b', 'B', '0', [4, 2]));
    expect(parseMatchesPage(html)[0].matches[0].status).toBe('completed');
  });
});
