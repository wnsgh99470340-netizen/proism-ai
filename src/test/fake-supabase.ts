/**
 * 시험용 메모리 Supabase (2026-11-23): 코드가 쓰는 쿼리 빌더 부분집합만 흉내 낸다
 *  from(table).select(cols, {count, head}).eq/neq/in/is/not/lte/lt/gte/gt/like/order/limit → await → { data, error: null, count }
 *  .insert(rows[.select()[.single()]]) / .update(patch).eq(...) / .delete().eq(...)
 *  single(): 0건이면 error, maybeSingle(): 0건이면 null
 * 테이블은 { 표이름: 행[] } 로 넣고, 시험이 끝나면 rows 를 직접 들여다본다
 */
type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

export function createFakeSupabase(initial: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(initial)) tables[k] = v.map((r) => ({ id: uuid(), created_at: new Date().toISOString(), ...r }));
  const ensure = (t: string) => (tables[t] = tables[t] || []);

  function builder(table: string) {
    const rows = ensure(table);
    const filters: Filter[] = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row | Row[] | null = null;
    let wantReturn = false, single = false, maybe = false, countOnly = false, wantCount = false, lim = 0;
    const get = (r: Row, k: string) => r[k];
    const b: Record<string, unknown> = {};
    const chain = (fn: () => void) => { fn(); return b; };
    Object.assign(b, {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => chain(() => { if (op === 'select') { wantCount = !!opts?.count; countOnly = !!opts?.head; } else wantReturn = true; }),
      insert: (p: Row | Row[]) => chain(() => { op = 'insert'; payload = p; }),
      update: (p: Row) => chain(() => { op = 'update'; payload = p; }),
      delete: () => chain(() => { op = 'delete'; }),
      eq: (k: string, v: unknown) => chain(() => filters.push((r) => get(r, k) === v)),
      neq: (k: string, v: unknown) => chain(() => filters.push((r) => get(r, k) !== v)),
      in: (k: string, vs: unknown[]) => chain(() => filters.push((r) => vs.includes(get(r, k)))),
      is: (k: string, v: unknown) => chain(() => filters.push((r) => (v === null ? get(r, k) == null : get(r, k) === v))),
      not: (k: string, _o: string, v: unknown) => chain(() => filters.push((r) => !(v === null ? get(r, k) == null : get(r, k) === v))),
      lte: (k: string, v: string) => chain(() => filters.push((r) => String(get(r, k)) <= v)),
      lt: (k: string, v: string) => chain(() => filters.push((r) => String(get(r, k)) < v)),
      gte: (k: string, v: string) => chain(() => filters.push((r) => String(get(r, k)) >= v)),
      gt: (k: string, v: string) => chain(() => filters.push((r) => String(get(r, k)) > v)),
      like: (k: string, pat: string) => chain(() => { const re = new RegExp('^' + pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 's'); filters.push((r) => re.test(String(get(r, k) ?? ''))); }),
      or: () => b, order: () => b,
      limit: (n: number) => chain(() => { lim = n; }),
      single: () => chain(() => { single = true; }),
      maybeSingle: () => chain(() => { maybe = true; }),
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
        try {
          const match = rows.filter((r) => filters.every((f) => f(r)));
          let data: unknown = null, error: unknown = null, count: number | null = null;
          if (op === 'select') {
            let out = match; if (lim) out = out.slice(0, lim);
            if (wantCount) count = match.length;
            if (countOnly) data = null;
            else if (single) { if (out.length !== 1) { error = { message: `single: ${out.length} rows` }; data = null; } else data = out[0]; }
            else if (maybe) data = out[0] ?? null;
            else data = out;
          } else if (op === 'insert') {
            const list = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ id: uuid(), created_at: new Date().toISOString(), ...(r as Row) }));
            rows.push(...list);
            data = wantReturn ? (single ? list[0] : list) : null;
          } else if (op === 'update') {
            for (const r of match) Object.assign(r, payload as Row);
            data = wantReturn ? match : null;
          } else if (op === 'delete') {
            for (const r of match) rows.splice(rows.indexOf(r), 1);
            data = null;
          }
          return Promise.resolve({ data, error, count }).then(onOk, onErr);
        } catch (e) { return Promise.resolve({ data: null, error: { message: String(e) }, count: null }).then(onOk, onErr); }
      },
    });
    return b;
  }
  return { from: builder, tables };
}
