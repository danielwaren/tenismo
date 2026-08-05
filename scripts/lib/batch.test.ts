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
});
