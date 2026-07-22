/**
 * Verifica la resolución de nombres completos contra los jugadores REALES de la
 * base, sin gastar cuota de The Odds API.
 *
 *   npx tsx scripts/check-names.ts
 *
 * Es la comprobación más importante de la Fase 2: si un nombre casa con el
 * jugador equivocado, la cuota de un partido acaba en otro y el modelo se
 * contamina en silencio. Prefiero un fallo ruidoso a un acierto dudoso.
 */
import { db } from '../src/lib/db';
import { loadEnv } from './lib/env';
import { buildIndex, resolvePlayer } from './lib/players';

loadEnv();

/** Nombres completos tal como los publicaría The Odds API. */
const MUESTRA: Record<'ATP' | 'WTA', string[]> = {
  ATP: [
    'Jannik Sinner', 'Carlos Alcaraz', 'Alexander Zverev', 'Novak Djokovic',
    'Daniil Medvedev', 'Taylor Fritz', 'Casper Ruud', 'Andrey Rublev',
    'Grigor Dimitrov', 'Stefanos Tsitsipas', 'Felix Auger-Aliassime',
    'Frances Tiafoe', 'Ben Shelton', 'Lorenzo Musetti', 'Jack Draper',
    'Alex de Minaur', 'Hubert Hurkacz', 'Tommy Paul', 'Karen Khachanov',
    'Sebastian Korda', 'Matteo Berrettini', 'Nicolas Jarry', 'Alejandro Tabilo',
    'Cristian Garin', 'Roberto Bautista Agut', 'Pablo Carreno Busta',
    'Juan Martin del Potro', 'Jean-Julien Rojer', 'Rafael Nadal', 'Roger Federer',
  ],
  WTA: [
    'Aryna Sabalenka', 'Iga Swiatek', 'Coco Gauff', 'Elena Rybakina',
    'Jessica Pegula', 'Qinwen Zheng', 'Jasmine Paolini', 'Emma Navarro',
    'Daria Kasatkina', 'Barbora Krejcikova', 'Mirra Andreeva', 'Madison Keys',
    'Marketa Vondrousova', 'Victoria Azarenka', 'Karolina Muchova',
    'Anastasia Pavlyuchenkova', 'Elina Svitolina', 'Ons Jabeur',
    'Belinda Bencic', 'Naomi Osaka',
  ],
};

async function main() {
  const client = db();
  let total = 0;
  let ok = 0;
  const fallos: string[] = [];
  const dudosos: string[] = [];

  for (const tour of ['ATP', 'WTA'] as const) {
    const rows = (await client.execute({
      sql: `select p.id, p.slug, p.name from players p join tours t on t.id = p.tour_id where t.code = ?`,
      args: [tour],
    })).rows.map((r) => ({ id: Number(r.id), slug: String(r.slug), name: String(r.name) }));
    const nombrePorId = new Map(rows.map((r) => [r.id, r.name]));
    const index = buildIndex(rows);

    const aliasRows = (await client.execute({
      sql: `select a.slug, a.player_id from player_aliases a
            join players p on p.id = a.player_id join tours t on t.id = p.tour_id where t.code = ?`,
      args: [tour],
    })).rows;
    const aliases = new Map(aliasRows.map((r) => [String(r.slug), Number(r.player_id)]));

    console.log(`\n── ${tour} (${rows.length} jugadores en base, ${aliases.size} alias) ──`);
    for (const full of MUESTRA[tour]) {
      total++;
      const res = resolvePlayer(full, index, aliases);
      if (res.ok) {
        ok++;
        const nombre = nombrePorId.get(res.playerId) ?? '?';
        const marca = res.via === 'slug' ? ' ' : res.via === 'alias' ? 'A' : '?';
        if (res.via === 'apellido') dudosos.push(`${full} -> ${nombre} (por apellido)`);
        console.log(`  ${marca} ${full.padEnd(26)} -> ${nombre}`);
      } else {
        fallos.push(`${full} (${res.reason})`);
        console.log(`  ✗ ${full.padEnd(26)} -> SIN RESOLVER: ${res.reason}`);
      }
    }
  }

  console.log(`\n── RESUMEN ──`);
  console.log(`  resueltos ${ok}/${total} (${((ok / total) * 100).toFixed(0)}%)`);
  if (dudosos.length) {
    console.log(`  resueltos por apellido (revisar): ${dudosos.length}`);
    for (const d of dudosos) console.log(`    ${d}`);
  }
  if (fallos.length) {
    console.log(`  SIN RESOLVER: ${fallos.length} — necesitan alias manual en player_aliases`);
    for (const f of fallos) console.log(`    ${f}`);
  }
}

main().catch((e) => {
  console.error('Fallo al comprobar nombres:', e);
  process.exit(1);
});
