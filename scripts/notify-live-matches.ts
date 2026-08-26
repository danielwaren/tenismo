/**
 * Notificación push: "empezó un partido destacado" — Grand Slam, Masters
 * 1000/WTA1000 o cualquier Challenger (ver src/lib/tournament-tier.ts). NO
 * manda nada por cada punto/game: una sola vez por partido, la primera vez
 * que se lo ve en vivo (dedup vía `notified_events`, tabla claim-once — ver
 * src/lib/push.ts).
 *
 * Pensado para correr cada 15 min, junto al cron que ya refresca partidos en
 * vivo (.github/workflows/en-vivo.yml) — reutiliza exactamente las mismas
 * fuentes que pinta la home (getLiveSnapshot para ATP/WTA vía ESPN,
 * getChallengerCalendar para Challenger vía Sportradar/tennisexplorer), así
 * que "partido en vivo" para el aviso es lo mismo que "partido en vivo" para
 * la web — nunca se avisa de algo que la web no mostraría como en vivo.
 *
 *   npx tsx scripts/notify-live-matches.ts
 *   npx tsx scripts/notify-live-matches.ts --dry-run
 */
import { db } from '../src/lib/db';
import { loadEnv } from './lib/env';
import { getLiveSnapshot } from '../src/lib/live';
import { getChallengerCalendar } from '../src/lib/challenger';
import { isNotableTournament } from '../src/lib/tournament-tier';
import { claimEvent, broadcastPush } from '../src/lib/push';
import { matchPath } from '../src/lib/urls';

loadEnv();
const dryRun = process.argv.includes('--dry-run');

interface Candidate {
  dedupKey: string;
  title: string;
  body: string;
  url: string;
}

async function collectAtpWtaCandidates(): Promise<Candidate[]> {
  const snapshot = await getLiveSnapshot();
  const live = snapshot.matches.filter((m) => m.liveState === 'live');
  if (!live.length) return [];

  // Solo los partidos ligados a un torneo interno (internalId) tienen
  // tournament_id con el que consultar `series` — el resto (ESPN sin
  // resolver contra nuestra base) se juzga solo por nombre, que ya cubre
  // Grand Slam (ver tournament-tier.ts).
  const tournamentIds = [...new Set(live.flatMap((m) => ('tournamentId' in m && m.tournamentId !== null ? [m.tournamentId] : [])))];
  const seriesByTournament = new Map<number, string | null>();
  if (tournamentIds.length) {
    const c = db();
    const rows = (await c.execute({
      sql: `select id, series from tournaments where id in (${tournamentIds.map(() => '?').join(',')})`,
      args: tournamentIds,
    })).rows;
    for (const r of rows) seriesByTournament.set(Number(r.id), (r.series as string | null) ?? null);
  }

  const out: Candidate[] = [];
  for (const m of live) {
    const tournamentId = 'tournamentId' in m ? m.tournamentId : null;
    const series = tournamentId !== null ? (seriesByTournament.get(tournamentId) ?? null) : null;
    if (!isNotableTournament({ tour: m.tour, series, name: m.tournament })) continue;

    const dedupKey = 'internalId' in m && m.internalId !== null ? String(m.internalId) : String(m.id);
    const url = 'p1Slug' in m && m.p1Slug
      ? matchPath({ id: m.internalId as number, p1Slug: m.p1Slug, p2Slug: m.p2Slug })
      : '/';
    out.push({
      dedupKey,
      title: `🎾 ¡Empezó! ${m.p1Name} vs ${m.p2Name}`,
      body: `${m.tournament}${m.round ? ` · ${m.round}` : ''}`,
      url,
    });
  }
  return out;
}

async function collectChallengerCandidates(): Promise<Candidate[]> {
  const calendar = await getChallengerCalendar();
  const live = calendar.matches.filter((m) => m.status === 'live');
  return live.map((m) => ({
    dedupKey: `challenger:${m.id}`,
    title: `🎾 ¡Empezó! ${m.player1} vs ${m.player2}`,
    body: `Challenger · ${m.tournament}${m.round ? ` · ${m.round}` : ''}`,
    url: '/', // Challenger sin ficha propia enlazable partido a partido — se manda a la home, que ya lista el cuadro.
  }));
}

async function main() {
  const [atpWta, challenger] = await Promise.all([collectAtpWtaCandidates(), collectChallengerCandidates()]);
  const candidates = [...atpWta, ...challenger];
  console.log(`Candidatos destacados en vivo: ${candidates.length} (${atpWta.length} ATP/WTA, ${challenger.length} Challenger)`);

  let notified = 0;
  for (const cand of candidates) {
    const isNew = dryRun ? true : await claimEvent('live_match', cand.dedupKey);
    if (!isNew) continue;
    console.log(`  ${dryRun ? '[dry-run] se avisaría' : 'avisando'}: ${cand.title} — ${cand.body}`);
    if (dryRun) continue;
    const result = await broadcastPush('notify_matches', { ...cand, tag: `live-${cand.dedupKey}` });
    console.log(`    -> ${result.sent}/${result.subscribers} enviados (${result.removed} suscripciones caducadas borradas, ${result.failed} fallos)`);
    notified++;
  }
  console.log(dryRun ? 'Fin (dry-run, nada escrito).' : `Avisos nuevos mandados: ${notified}.`);
}

main().catch((e) => {
  console.error('Fallo en notify-live-matches:', e);
  process.exit(1);
});
