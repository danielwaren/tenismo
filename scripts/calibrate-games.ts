/**
 * Calibración del motor punto a punto para TOTAL DE JUEGOS.
 *
 *   npx tsx scripts/calibrate-games.ts
 *   npx tsx scripts/calibrate-games.ts --sims 2000 --desde 2023
 *
 * NO ESCRIBE NADA. Mide y reporta; aplicar la corrección es una decisión
 * aparte (igual que fit-model vs predict).
 *
 * MOTIVO (sept 2026): el simulador perdía en Total de Juegos eligiendo OVER en
 * 334 de 343 apuestas para terminar 167G/167P — moneda al aire pagando el
 * margen. Una medición rápida sugirió que el motor predice ~0,46 juegos de
 * más. Esto lo comprueba en serio.
 *
 * WALK-FORWARD DE VERDAD, sin look-ahead. `getMarkovInputs` (el de la web)
 * agrega TODO el historial del jugador, incluidos partidos POSTERIORES al que
 * evalúa — sirve para pintar una ficha, no para medir calibración histórica.
 * Acá se replica el acumulador cronológico de `train-elo.ts` (líneas ~474-484):
 * cada partido se simula con el perfil de saque PREVIO y solo después se
 * actualiza con sus estadísticas.
 *
 * SEPARACIÓN TEMPORAL, nunca aleatoria (mismo criterio que docs/03):
 *   · calentamiento: hasta 2022 — solo acumula perfil, no se evalúa
 *   · TRAIN: 2023-2024 — se ajusta la corrección
 *   · TEST:  2025-2026 — jamás se usa para ajustar
 */
import { db } from '../src/lib/db';
import { loadEnv } from './lib/env';
import {
  simulateMatch, estimateServeProb, shrinkRate,
  reliabilityBins, type BinaryOutcome,
} from '@tti/model';

loadEnv();

const arg = (n: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};

const SIMS = arg('sims', 3000);
const TRAIN_DESDE = String(arg('train', 2023));
const TEST_DESDE = String(arg('test', 2025));

/** Mismos valores que scripts/train-elo.ts — el perfil tiene que ser el mismo. */
const DEFAULT_TOUR_SERVE_RATE = 0.62;
const TOUR_AVG_KAPPA = 2000;

interface Serve { serveWon: number; servePoints: number; returnWon: number; returnPoints: number }
const blank = (): Serve => ({ serveWon: 0, servePoints: 0, returnWon: 0, returnPoints: 0 });

interface Obs {
  anio: string;
  simMean: number;
  simSd: number;
  actual: number;
  /** probOver del motor en la línea .5 más cercana a su propia media. */
  linea: number;
  probOver: number;
  /** Para recalcular probOver con desplazamiento sin re-simular. */
  probOverEn: (line: number) => number;
}

function media(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function mae(xs: number[]): number { return media(xs.map(Math.abs)); }

async function main() {
  const client = db();
  console.log(`Simulaciones por partido: ${SIMS}  ·  train desde ${TRAIN_DESDE}  ·  test desde ${TEST_DESDE}`);

  const rows = (await client.execute(`
    select m.id, m.played_on, m.sets_json, m.p1_won, coalesce(m.best_of, 3) best_of,
           m.p1_id, m.p2_id, m.surface,
           sa.serve_points a_svpt, sa.first_won a_fw, sa.second_won a_sw,
           sb.serve_points b_svpt, sb.first_won b_fw, sb.second_won b_sw
    from matches m
    join match_stats sa on sa.match_id = m.id and sa.player_id = m.p1_id and sa.serve_points > 0
    join match_stats sb on sb.match_id = m.id and sb.player_id = m.p2_id and sb.serve_points > 0
    where m.status = 'completed' and m.p1_won is not null and m.sets_json is not null
    order by m.played_on, m.id
  `)).rows;
  console.log(`Partidos con estadísticas de saque de ambos: ${rows.length}`);

  const perfil = new Map<number, Serve>();
  let globalWon = 0, globalPts = 0;
  const tourRate = () => (globalPts > 0
    ? shrinkRate(globalWon / globalPts, globalPts, DEFAULT_TOUR_SERVE_RATE, TOUR_AVG_KAPPA)
    : DEFAULT_TOUR_SERVE_RATE);

  const obs: Obs[] = [];
  let simuladas = 0;

  for (const r of rows) {
    const anio = String(r.played_on).slice(0, 4);
    const p1 = Number(r.p1_id), p2 = Number(r.p2_id);
    if (!perfil.has(p1)) perfil.set(p1, blank());
    if (!perfil.has(p2)) perfil.set(p2, blank());
    const s1 = perfil.get(p1)!, s2 = perfil.get(p2)!;

    // ── Evaluación con el estado PREVIO (solo train/test, no calentamiento) ──
    if (anio >= TRAIN_DESDE) {
      const sets = JSON.parse(String(r.sets_json)) as [number, number][];
      const p1w = Number(r.p1_won) === 1;
      let g1 = 0, g2 = 0;
      for (const [wg, lg] of sets) { g1 += p1w ? wg : lg; g2 += p1w ? lg : wg; }
      const actual = g1 + g2;
      // Un jugador sin ninguna muestra propia haría que el motor devuelva la
      // media del circuito para los dos lados: no mide nada del partido.
      if (actual > 0 && s1.servePoints > 0 && s2.servePoints > 0) {
        const tr = tourRate();
        const pa = estimateServeProb({ won: s1.serveWon, points: s1.servePoints },
          { won: s2.returnWon, points: s2.returnPoints }, { tourServeRate: tr });
        const pb = estimateServeProb({ won: s2.serveWon, points: s2.servePoints },
          { won: s1.returnWon, points: s1.returnPoints }, { tourServeRate: tr });
        const sim = simulateMatch(pa, pb, Number(r.best_of), SIMS);
        const linea = Math.round(sim.meanGames * 2) / 2;
        obs.push({
          anio, simMean: sim.meanGames, simSd: sim.sdGames, actual,
          linea, probOver: sim.probOver(linea), probOverEn: sim.probOver,
        });
        simuladas++;
        if (simuladas % 500 === 0) process.stdout.write(`\r  simuladas ${simuladas}...   `);
      }
    }

    // ── Actualización del perfil, DESPUÉS de evaluar (idéntico a train-elo) ──
    const aSv = Number(r.a_svpt) || 0, bSv = Number(r.b_svpt) || 0;
    if (aSv > 0 && bSv > 0) {
      const aWon = (Number(r.a_fw) || 0) + (Number(r.a_sw) || 0);
      const bWon = (Number(r.b_fw) || 0) + (Number(r.b_sw) || 0);
      s1.serveWon += aWon; s1.servePoints += aSv;
      s1.returnWon += bSv - bWon; s1.returnPoints += bSv;
      s2.serveWon += bWon; s2.servePoints += bSv;
      s2.returnWon += aSv - aWon; s2.returnPoints += aSv;
      globalWon += aWon + bWon; globalPts += aSv + bSv;
    }
  }
  process.stdout.write('\r');

  const train = obs.filter((o) => o.anio < TEST_DESDE);
  const test = obs.filter((o) => o.anio >= TEST_DESDE);
  console.log(`\nEvaluados ${obs.length} — train ${train.length} (${TRAIN_DESDE}-${Number(TEST_DESDE) - 1}) · test ${test.length} (${TEST_DESDE}+)`);
  if (!train.length || !test.length) { console.log('Muestra insuficiente en algún tramo.'); return; }

  // ── Ajuste SOLO sobre train ────────────────────────────────────────────────
  const sesgo = media(train.map((o) => o.simMean - o.actual));
  // Regresión lineal actual ≈ α + β·simMean (mínimos cuadrados).
  const mx = media(train.map((o) => o.simMean));
  const my = media(train.map((o) => o.actual));
  const sxy = media(train.map((o) => (o.simMean - mx) * (o.actual - my)));
  const sxx = media(train.map((o) => (o.simMean - mx) ** 2));
  const beta = sxx > 0 ? sxy / sxx : 1;
  const alfa = my - beta * mx;

  console.log('\n── Ajustado sobre TRAIN ───────────────────────────────────');
  console.log(`  sesgo aditivo (sim − real): ${sesgo >= 0 ? '+' : ''}${sesgo.toFixed(3)} juegos`);
  console.log(`  lineal: real ≈ ${alfa.toFixed(2)} + ${beta.toFixed(4)}·sim`);
  console.log(`  media sim ${mx.toFixed(2)} · media real ${my.toFixed(2)}`);

  // ── Evaluación SOLO sobre test ─────────────────────────────────────────────
  const errCrudo = test.map((o) => o.simMean - o.actual);
  const errAdit = test.map((o) => (o.simMean - sesgo) - o.actual);
  const errLin = test.map((o) => (alfa + beta * o.simMean) - o.actual);

  console.log('\n── Evaluado sobre TEST (nunca visto al ajustar) ───────────');
  const fila = (nombre: string, e: number[]) =>
    console.log(`  ${nombre.padEnd(22)} sesgo ${(media(e) >= 0 ? '+' : '') + media(e).toFixed(3)}   MAE ${mae(e).toFixed(3)}`);
  fila('sin corregir', errCrudo);
  fila('corrección aditiva', errAdit);
  fila('corrección lineal', errLin);

  // ── Lo que de verdad importa: ¿queda calibrado probOver? ───────────────────
  //
  // La línea se pone donde la pondría el MERCADO: cerca de la media real
  // esperada, no de la del motor. Usar la media del motor sesgaría la prueba
  // a su favor — el mercado no le regala la línea que él quiere. Se usa la
  // estimación lineal (α + β·sim), que es la mejor aproximación disponible a
  // esa media real, redondeada al .5 de mercado.
  //
  // Tres formas de preguntarle al motor P(real > L):
  //   crudo    → probOver(L)               (lo que hace hoy)
  //   aditivo  → probOver(L + b)           (corrige el CENTRO)
  //   lineal   → probOver((L − α) / β)     (corrige centro Y escala)
  // La lineal es la única que también arregla la ANCHURA de la distribución,
  // y β < 1 significa que el motor exagera la dispersión.
  const conLinea = test.map((o) => {
    const L = Math.round((alfa + beta * o.simMean) * 2) / 2;
    return { o, L, actual: (o.actual > L ? 1 : 0) as 0 | 1 };
  });

  const variantes: [string, (o: Obs, L: number) => number][] = [
    ['crudo (hoy)', (o, L) => o.probOverEn(L)],
    ['aditivo', (o, L) => o.probOverEn(L + sesgo)],
    ['lineal', (o, L) => o.probOverEn((L - alfa) / beta)],
  ];

  for (const [nombre, f] of variantes) {
    const rows2: BinaryOutcome[] = conLinea.map(({ o, L, actual }) => ({ prob: f(o, L), actual }));
    const overs = rows2.filter((r) => r.actual === 1).length;
    const predicho = media(rows2.map((r) => r.prob));
    // Error de calibración medio ponderado por muestra (ECE).
    const bins = reliabilityBins(rows2, 10).filter((b) => b.count > 0);
    const ece = bins.reduce((a, b) => a + (b.count / rows2.length) * Math.abs(b.observed - b.meanPredicted), 0);
    console.log(`\n  probOver en la línea de MERCADO — ${nombre}`);
    console.log(`    predicho medio ${(predicho * 100).toFixed(1)}%   ·   observado ${((overs / rows2.length) * 100).toFixed(1)}%   ·   ECE ${(ece * 100).toFixed(2)}pp   (n=${rows2.length})`);
    console.log('    rango      n    predicho  observado   desvío');
    for (const b of bins) {
      const d = b.observed - b.meanPredicted;
      console.log(`    ${b.from.toFixed(1)}-${b.to.toFixed(1)} ${String(b.count).padStart(6)}    ${b.meanPredicted.toFixed(3)}     ${b.observed.toFixed(3)}   ${d >= 0 ? '+' : ''}${d.toFixed(3)}`);
    }
  }

  console.log('\nNo se ha escrito nada. Aplicar la corrección es una decisión aparte.');
}

main().catch((e) => { console.error('Fallo en la calibración:', e); process.exit(1); });
