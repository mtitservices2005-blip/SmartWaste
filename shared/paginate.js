// SW-099: Supabase/PostgREST devuelve como máximo 1000 filas por consulta (aunque se pida .limit(3000)).
// fetchAllPages pide páginas con .range() hasta agotar las filas y devuelve { data, error } como una consulta normal.
// - makePageQuery(from, to) debe devolver la consulta con .range(from, to) ya aplicado (y un orden estable).
// - Avanza por las filas realmente recibidas, así que también funciona si el servidor tiene un tope menor.
// - Si una página falla devuelve el error y ningún dato parcial. Tope de seguridad: maxPages (marca truncated: true).
export const PAGE_SIZE = 1000;
export const MAX_PAGES = 100;

export async function fetchAllPages(makePageQuery, { pageSize = PAGE_SIZE, maxPages = MAX_PAGES } = {}) {
  const all = [];
  let offset = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const res = await makePageQuery(offset, offset + pageSize - 1);
    if (res.error) return { data: null, error: res.error };
    const rows = res.data ?? [];
    if (rows.length === 0) return { data: all, error: null };
    all.push(...rows);
    offset += rows.length;
  }
  return { data: all, error: null, truncated: true };
}
