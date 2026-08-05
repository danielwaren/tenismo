import { describe, it, expect } from 'vitest';
import { bulkLinkStmts, LINKS_PER_STATEMENT } from './links';

const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    taKey: `k${i}`,
    status: i % 2 ? 'linked' : 'no_candidate',
    matchId: i % 2 ? i : null,
  }));

describe('bulkLinkStmts', () => {
  it('agrupa los enlaces en pocas sentencias', () => {
    const out = bulkLinkStmts(mk(1200));
    expect(out).toHaveLength(Math.ceil(1200 / LINKS_PER_STATEMENT));
  });

  it('mantiene el orden y todos los argumentos', () => {
    const links = mk(10);
    const [stmt] = bulkLinkStmts(links);
    expect(stmt.args).toEqual(links.flatMap((l) => [l.taKey, l.status, l.matchId]));
  });

  it('emite una tupla por enlace', () => {
    const [stmt] = bulkLinkStmts(mk(3));
    expect(stmt.sql.match(/\(\?,\?,\?\)/g)).toHaveLength(3);
  });

  it('castea match_id a bigint: sin el cast Postgres lo toma como text y falla', () => {
    const [stmt] = bulkLinkStmts(mk(1));
    expect(stmt.sql).toContain('v.match_id::bigint');
  });

  it('no genera nada si no hay enlaces', () => {
    expect(bulkLinkStmts([])).toEqual([]);
  });
});
