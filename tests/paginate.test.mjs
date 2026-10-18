// SW-099: Supabase devuelve como máximo 1000 filas por consulta; fetchAllPages las pide por páginas hasta agotarlas.
import assert from 'node:assert/strict';
import { fetchAllPages } from '../shared/paginate.js';

const source = (n) => Array.from({ length: n }, (_, i) => ({ i }));
const pager = (rows, cap = 1000) => async (from, to) => ({ data: rows.slice(from, Math.min(to + 1, from + cap)), error: null });

{ // más de 1000 filas llegan completas y en orden
  const res = await fetchAllPages(pager(source(4043)));
  assert.equal(res.error, null);
  assert.equal(res.data.length, 4043);
  assert.deepEqual(res.data.map((r) => r.i).slice(998, 1002), [998, 999, 1000, 1001]);
  assert.equal(res.data.at(-1).i, 4042);
  assert.equal(res.truncated, undefined);
}
{ // un servidor con tope menor al tamaño de página también se recorre completo
  const res = await fetchAllPages(pager(source(2300), 500));
  assert.equal(res.data.length, 2300);
}
{ // lista vacía y una sola página
  assert.deepEqual((await fetchAllPages(pager([]))).data, []);
  assert.equal((await fetchAllPages(pager(source(3)))).data.length, 3);
}
{ // un error en una página se devuelve tal cual y no entrega datos parciales
  let calls = 0;
  const res = await fetchAllPages(async (from, to) => { calls += 1; return calls === 2 ? { data: null, error: { code: 'X', message: 'caído' } } : pager(source(5000))(from, to); });
  assert.equal(res.data, null);
  assert.equal(res.error.message, 'caído');
}
{ // tope de seguridad: no pide páginas sin fin
  const res = await fetchAllPages(pager(source(10_000)), { pageSize: 1000, maxPages: 3 });
  assert.equal(res.data.length, 3000);
  assert.equal(res.truncated, true);
}
console.log('paginate ok');
