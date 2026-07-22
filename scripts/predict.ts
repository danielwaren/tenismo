/**
 * Aplica los pesos YA AJUSTADOS a los partidos que aún no tienen predicción.
 *
 *   npx tsx scripts/predict.ts            # solo los que faltan
 *   npx tsx scripts/predict.ts --all      # recalcula todos
 *
 * Separado de fit-model a propósito: **ajustar y predecir no son la misma
 * operación**. El cron diario tiene que predecir los partidos nuevos, pero NO
 * reajustar los pesos — si reajustara cada día sobre datos cada vez más
 * grandes, el modelo cambiaría solo, en silencio, y ninguna métrica publicada
 * seguiría siendo comparable con la del día anterior.
 *
 * Reajustar es una decisión explícita: `npx tsx scripts/fit-model.ts`.
 */
import { db } from '../src/lib/db';
import { loadEnv } from './lib/env';
import { runBatch } from './lib/batch';
import { FEATURE_NAMES, predictProb, type LogRegModel } from '@tti/model';

loadEnv();

const CHUNK = 400;
const hasFlag = (n: string) => process.argv.includes(`--${n}`);

async function main() {
  const client = db();
  const all = hasFlag('all');

  const version = String(
    (await client.execute("select v from app_config where k = 'model_version'")).rows[0]?.v ?? '',
  );
  const fit = (
    await client.execute({
      sql: 'select feature_names, weights from model_fits where model_version = ?',
      args: [version],
    })
  ).rows[0];

  if (!fit) {
    console.log(
      `No hay pesos guardados para "${version}".\n` +
        'Ejecuta `npx tsx scripts/fit-model.ts` para ajustar el modelo primero.',
    );
    return;
  }

  const featureNames = JSON.parse(String(fit.feature_names)) as string[];
  const weights = JSON.parse(String(fit.weights)) as number[];

  // El orden de las columnas es el contrato entre el ajuste y la predicción.
  // Si cambió FEATURE_NAMES sin reajustar, los pesos se aplicarían a features
  // distintas de las que se entrenaron y el resultado sería basura silenciosa.
  const esperado = JSON.stringify([...FEATURE_NAMES]);
  if (JSON.stringify(featureNames) !== esperado) {
    throw new Error(
      `Las features del ajuste "${version}" no coinciden con las del código.\n` +
        `  guardadas: ${featureNames.join(', ')}\n` +
        `  código:    ${[...FEATURE_NAMES].join(', ')}\n` +
        'Reajusta con `npx tsx scripts/fit-model.ts`.',
    );
  }

  const model: LogRegModel = { featureNames, weights, iterations: 0, converged: true };

  const rows = (
    await client.execute({
      sql: `
        select f.match_id,
               f.elo_diff_surface, f.elo_diff_overall, f.rank_log_diff, f.points_log_diff,
               f.h2h, f.h2h_surface, f.load_diff, f.intensity_diff, f.rest_diff,
               f.form_diff, f.exp_diff, f.surface_exp_diff, f.best_of5_elo_diff,
               base.confidence as confidence
        from match_features f
        left join model_outputs mine on mine.match_id = f.match_id and mine.model_version = ?
        left join model_outputs base on base.match_id = f.match_id
                                    and base.model_version = 'tennis-elo-surface-1.0.0'
        where ? = 1 or mine.match_id is null
      `,
      args: [version, all ? 1 : 0],
    })
  ).rows;

  if (!rows.length) {
    console.log('Sin partidos pendientes de predecir.');
    return;
  }

  const stmts = rows.map((r) => {
    const x = [
      Number(r.elo_diff_surface), Number(r.elo_diff_overall), Number(r.rank_log_diff),
      Number(r.points_log_diff), Number(r.h2h), Number(r.h2h_surface),
      Number(r.load_diff), Number(r.intensity_diff), Number(r.rest_diff),
      Number(r.form_diff), Number(r.exp_diff), Number(r.surface_exp_diff),
      Number(r.best_of5_elo_diff),
    ];
    const p = predictProb(x, model);
    return {
      sql: `insert or replace into model_outputs
            (match_id, model_version, prob_p1, prob_p2, confidence)
            values (?, ?, ?, ?, ?)`,
      args: [
        Number(r.match_id), version,
        Math.round(p * 1e6) / 1e6, Math.round((1 - p) * 1e6) / 1e6,
        r.confidence === null ? null : Number(r.confidence),
      ],
    };
  });

  await runBatch(client, stmts, 'predicciones', { chunk: CHUNK });
  console.log(`Predicciones escritas con "${version}": ${stmts.length}${all ? ' (todas)' : ' (pendientes)'}.`);
}

main().catch((e) => {
  console.error('Fallo al predecir:', e);
  process.exit(1);
});
