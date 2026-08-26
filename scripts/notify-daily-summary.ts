/**
 * Notificación push de resumen diario — dos modos, uno por corrida:
 *
 *   npx tsx scripts/notify-daily-summary.ts --morning   (qué hay para hoy)
 *   npx tsx scripts/notify-daily-summary.ts --evening   (cómo salió el día)
 *   npx tsx scripts/notify-daily-summary.ts --morning --dry-run
 *
 * Pensado para dos cron aparte en GitHub Actions (horarios distintos), no
 * para correr suelto sin flag — sin `--morning`/`--evening` no manda nada y
 * lo dice, en vez de adivinar cuál tocaba por la hora del servidor.
 */
import { db } from '../src/lib/db';
import { loadEnv } from './lib/env';
import { isNotableTournament } from '../src/lib/tournament-tier';
import { claimEvent, broadcastPush } from '../src/lib/push';

loadEnv();
const dryRun = process.argv.includes('--dry-run');
const mode = process.argv.includes('--morning') ? 'morning' : process.argv.includes('--evening') ? 'evening' : null;

const hoy = () => new Date().toISOString().slice(0, 10);

async function buildMorning(client: ReturnType<typeof db>): Promise<{ title: string; body: string }> {
  const rows = (await client.execute({
    sql: `select tou.code tour, tr.series, tr.name tournament, count(*) n
          from matches m
          join tournaments tr on tr.id = m.tournament_id
          join tours tou on tou.id = m.tour_id
          where m.status = 'scheduled' and m.played_on::date = current_date
          group by tou.code, tr.series, tr.name`,
  })).rows;

  const notables = rows.filter((r) => isNotableTournament({
    tour: String(r.tour), series: (r.series as string | null) ?? null, name: String(r.tournament),
  }));
  const totalHoy = rows.reduce((a, r) => a + Number(r.n), 0);

  if (!notables.length) {
    return { title: '☀️ Buenos días — Tenismo', body: `${totalHoy} partidos programados hoy, ninguno de nivel Slam/Masters/Challenger.` };
  }
  // El mismo nombre de torneo puede repetirse entre cuadro ATP y WTA (p. ej.
  // "US Open" es un torneo por circuito, dos filas) — se cuenta cada uno para
  // el total, pero el nombre solo se muestra una vez.
  const nombresUnicos = [...new Set(notables.map((r) => String(r.tournament)))];
  const nombres = nombresUnicos.slice(0, 4).join(' · ');
  return {
    title: `☀️ Buenos días — ${notables.length} torneo${notables.length === 1 ? '' : 's'} destacado${notables.length === 1 ? '' : 's'} hoy`,
    body: `${nombres}${nombresUnicos.length > 4 ? ` · +${nombresUnicos.length - 4} más` : ''} — ${totalHoy} partidos en total.`,
  };
}

async function buildEvening(client: ReturnType<typeof db>): Promise<{ title: string; body: string }> {
  const today = hoy();
  const [matchesRow, paperRow] = await Promise.all([
    client.execute({
      sql: `select count(*) n from matches where status = 'completed' and played_on::date = current_date`,
    }),
    client.execute({
      sql: `select
              sum(case when status='won' then 1 else 0 end) won,
              sum(case when status='lost' then 1 else 0 end) lost,
              coalesce(sum(coalesce(profit,0)),0) profit
            from paper_trades where settled_at::date = current_date`,
    }),
  ]);

  const completados = Number(matchesRow.rows[0]?.n ?? 0);
  const won = Number(paperRow.rows[0]?.won ?? 0);
  const lost = Number(paperRow.rows[0]?.lost ?? 0);
  const profit = Number(paperRow.rows[0]?.profit ?? 0);
  const settled = won + lost;

  const parts = [`${completados} partidos jugados hoy`];
  if (settled > 0) {
    const hitRate = Math.round((won / settled) * 100);
    parts.push(`simulador: ${won}G/${lost}P (${hitRate}% aciertos), ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} de banca`);
  }
  return { title: `🌙 Resumen del ${today}`, body: parts.join(' · ') };
}

async function main() {
  if (!mode) {
    console.log('Falta --morning o --evening. No se manda nada sin flag explícito.');
    return;
  }
  const client = db();
  const { title, body } = mode === 'morning' ? await buildMorning(client) : await buildEvening(client);
  console.log(`${title}\n${body}`);

  const dedupKey = `${hoy()}:${mode}`;
  if (dryRun) { console.log('--dry-run: no se marca ni se manda.'); return; }

  const isNew = await claimEvent('daily_summary', dedupKey);
  if (!isNew) { console.log(`Ya se mandó el resumen de "${mode}" hoy — no se repite.`); return; }

  const result = await broadcastPush('notify_daily', { title, body, url: '/', tag: `daily-${mode}` });
  console.log(`Enviado: ${result.sent}/${result.subscribers} (${result.removed} caducadas, ${result.failed} fallos).`);
}

main().catch((e) => {
  console.error('Fallo en notify-daily-summary:', e);
  process.exit(1);
});
