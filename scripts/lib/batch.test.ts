import { describe, it, expect } from 'vitest';
import { coalesceInserts, splitInsert } from './batch';

describe('splitInsert', () => {
  it('parte un insert de una tupla', () => {
    const p = splitInsert('insert into t (a,b) values (?,?) on conflict (a) do nothing');
    expect(p).not.toBeNull();
    expect(p!.tuple).toBe('(?,?)');
    expect(p!.tail).toBe(' on conflict (a) do nothing');
  });

  it('no toca lo que no es un insert de tuplas', () => {
    expect(splitInsert('update t set a = ? where b = ?')).toBeNull();
    expect(splitInsert('delete from t where id = ?')).toBeNull();
    // insert ... select no tiene tupla de marcadores
    expect(splitInsert('insert into t (a) select x from y')).toBeNull();
  });
});

describe('coalesceInserts', () => {
  const mk = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      sql: 'insert into t (a,b) values (?,?) on conflict (a) do update set b=excluded.b',
      args: [i, `v${i}`],
    }));

  it('agrupa inserts identicos en una sola sentencia', () => {
    const out = coalesceInserts(mk(3));
    expect(out).toHaveLength(1);
    expect(out[0].sql).toBe(
      'insert into t (a,b) values (?,?), (?,?), (?,?) on conflict (a) do update set b=excluded.b',
    );
    expect(out[0].args).toEqual([0, 'v0', 1, 'v1', 2, 'v2']);
  });

  it('conserva el orden de los argumentos', () => {
    const out = coalesceInserts(mk(50));
    expect(out[0].args).toEqual(mk(50).flatMap((s) => s.args));
  });

  it('no agrupa si el SQL difiere', () => {
    const stmts = [...mk(2), { sql: 'insert into otra (a,b) values (?,?)', args: [9, 'x'] }];
    expect(coalesceInserts(stmts)).toHaveLength(3);
  });

  it('no agrupa updates ni deletes', () => {
    const stmts = Array.from({ length: 5 }, (_, i) => ({
      sql: 'update t set b = ? where a = ?',
      args: [`v${i}`, i],
    }));
    expect(coalesceInserts(stmts)).toHaveLength(5);
  });

  it('respeta el tope de parametros de Postgres', () => {
    // 2 columnas -> 25.000 filas por sentencia como mucho (50.000 params).
    const out = coalesceInserts(mk(30_000));
    expect(out.length).toBeGreaterThan(1);
    for (const s of out) expect(s.args.length).toBeLessThanOrEqual(50_000);
    // No se pierde ni se duplica ninguna fila.
    expect(out.flatMap((s) => s.args)).toEqual(mk(30_000).flatMap((s) => s.args));
  });

  it('una sola sentencia se deja como esta', () => {
    expect(coalesceInserts(mk(1))).toHaveLength(1);
  });

  // La ingesta de cuotas mete literales dentro del VALUES; si esta forma no se
  // agrupa son 21.392 idas y vueltas y el job se pasa del timeout (run #22).
  it('agrupa tuplas que mezclan literales con marcadores', () => {
    const sql =
      "insert into odds (match_id, source, bookmaker, market, odds, is_closing)" +
      " values (?, 'tennis-data', ?, 'match_winner', ?, 1)" +
      ' on conflict (match_id, bookmaker) do update set odds = excluded.odds';
    const stmts = [
      { sql, args: [1, 'bet365', 2.4] },
      { sql, args: [2, 'pinnacle', 1.8] },
    ];
    const out = coalesceInserts(stmts);
    expect(out).toHaveLength(1);
    expect(out[0].sql).toContain(
      "values (?, 'tennis-data', ?, 'match_winner', ?, 1), (?, 'tennis-data', ?, 'match_winner', ?, 1)",
    );
    expect(out[0].args).toEqual([1, 'bet365', 2.4, 2, 'pinnacle', 1.8]);
  });

  it('no agrupa si la tupla no consume todos los argumentos', () => {
    // 2 marcadores pero 3 argumentos: repetir la tupla desalinearía los
    // parámetros y escribiría datos en las columnas equivocadas.
    const stmts = [
      { sql: 'insert into t (a,b) values (?,?)', args: [1, 2, 3] },
      { sql: 'insert into t (a,b) values (?,?)', args: [4, 5, 6] },
    ];
    expect(coalesceInserts(stmts)).toHaveLength(2);
  });

  it('no agrupa un VALUES con parentesis anidados', () => {
    const sql = 'insert into t (a,b) values (?, coalesce(?, 0))';
    const stmts = [{ sql, args: [1, 2] }, { sql, args: [3, 4] }];
    expect(coalesceInserts(stmts)).toHaveLength(2);
  });
});
