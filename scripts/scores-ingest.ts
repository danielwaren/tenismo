/**
 * Marcadores EN VIVO desde The Odds API (/scores).
 *
 *   npx tsx scripts/scores-ingest.ts
 *
 * Actualiza `live_scores` para los partidos de torneos cubiertos que se están
 * jugando ahora. Sin ODDS_API_KEY es un no-op. Solo hay datos si hay un torneo
 * cubierto en curso (Grand Slam, Masters 1000 o algún 500); nada de Challenger
 * ni 250.
 *
 * Un partido en vivo ya existe en `matches` como 'scheduled', creado por
 * odds-ingest con source_key = 'odds:{event_id}'. Aquí solo se le añade el
 * estado en vivo, casando por ese event_id — sin resolver nombres de nuevo.
 */
import { db } from '../src/lib/db';
import { loadEnv } from './lib/env';
import { runBatch } from './lib/batch';
import { fetchSports, fetchScores } from './lib/odds-api';

loadEnv();

async function main() {
  const client = db();
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    console.log('Sin ODDS_API_KEY: no se consultan marcadores en vivo.');
    return;
  }

  const { sports } = await fetchSports(apiKey);
  const activos = sports.filter((s) => s.key.startsWith('tennis') && s.active);
  if (!activos.length) {
    console.log('Ningún torneo cubierto en curso: no hay marcadores en vivo.');
    // Aun así, se limpian los "en vivo" viejos que hubieran quedado.
    await client.execute("delete from live_scores");
    return;
  }

  // event_id -> match_id, para casar los scores con nuestros partidos.
  const porEvento = new Map<string, number>();
  for (const r of (await client.execute(
    "select id, source_key from matches where source = 'the-odds-api'",
  )).rows) {
    porEvento.set(String(r.source_key).replace(/^odds:/, ''), Number(r.id));
  }

  const stmts: { sql: string; args: unknown[] }[] = [];
  const vivos: number[] = [];
  let gastados = 0;

  for (const sport of activos) {
    const { scores, quota } = await fetchScores(apiKey, sport.key);
    gastados += quota.lastCost ?? 1;
    for (const ev of scores) {
      const matchId = porEvento.get(ev.id);
      if (!matchId) continue; // evento sin partido nuestro (no resuelto por odds-ingest)

      // Nombres de nuestros p1/p2 para orientar el marcador al orden de la base.
      const pr = (await client.execute({
        sql: `select p1.name p1, p2.name p2 from matches m
              join players p1 on p1.id = m.p1_id join players p2 on p2.id = m.p2_id
              where m.id = ?`,
        args: [matchId],
      })).rows[0];
      if (!pr) continue;

      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const apellido = (s: string) => norm(s).split(/[\s.]+/)[0];
      const scoreDe = (nombreApi: string): string | null => {
        const sc = ev.scores?.find((x) => norm(x.name).includes(apellido(nombreApi)) || apellido(x.name) === apellido(nombreApi));
        return sc ? sc.score : null;
      };
      // ev.home_team/away_team son nombres completos de la API; se casan con
      // nuestros p1/p2 por apellido.
      const homeEsP1 = apellido(ev.home_team) === apellido(String(pr.p1)) ||
        norm(ev.home_team).includes(apellido(String(pr.p1)));
      const scoreP1 = homeEsP1 ? scoreDe(ev.home_team) : scoreDe(ev.away_team);
      const scoreP2 = homeEsP1 ? scoreDe(ev.away_team) : scoreDe(ev.home_team);

      stmts.push({
        sql: `insert into live_scores (match_id, event_id, state, score_p1, score_p2, updated_at)
              values (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
              on conflict (match_id) do update set
                state = excluded.state, score_p1 = excluded.score_p1,
                score_p2 = excluded.score_p2, updated_at = excluded.updated_at`,
        args: [matchId, ev.id, ev.completed ? 'finished' : 'live', scoreP1, scoreP2],
      });
      vivos.push(matchId);
    }
  }

  // Borra los que ya no aparecen (terminaron y salieron de la ventana del proveedor).
  if (vivos.length) {
    await client.execute({
      sql: `delete from live_scores where match_id not in (${vivos.map(() => '?').join(',')})`,
      args: vivos,
    });
  } else {
    await client.execute('delete from live_scores');
  }
  await runBatch(client, stmts, 'marcadores en vivo');
  console.log(`Marcadores en vivo actualizados: ${stmts.length}. Créditos gastados: ${gastados}.`);
}

main().catch((e) => {
  console.error('Fallo en scores-ingest:', e);
  process.exit(1);
});
