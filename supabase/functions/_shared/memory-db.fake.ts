// Память вместо базы для юнит-тестов: цепочка PostgREST (`select/eq/in/is/ilike/or/update/upsert/insert`)
// фильтрует строки-фикстуры, чтобы проверять ПОВЕДЕНИЕ (что вернулось и что записалось), а не
// порядок вызовов. `or` понимает только форму `col.eq.v` / `col.is.null`, через запятую.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type Row = Record<string, unknown>;
export type Write = { table: string; op: string; values: unknown; filters: Array<[string, string, unknown]> };

export function memoryDb(initial: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = Object.fromEntries(
    Object.entries(initial).map(([k, v]) => [k, v.map((r) => ({ ...r }))]),
  );
  const writes: Write[] = [];

  function chain(table: string) {
    let op = "select";
    let values: unknown;
    const filters: Array<[string, string, unknown]> = [];
    const preds: Array<(r: Row) => boolean> = [];
    const run = () => {
      const rows = (tables[table] ??= []).filter((r) => preds.every((p) => p(r)));
      if (op === "select") return rows;
      writes.push({ table, op, values, filters: [...filters] });
      if (op === "update") rows.forEach((r) => Object.assign(r, values as Row));
      if (op === "insert") tables[table].push(...(Array.isArray(values) ? values as Row[] : [values as Row]));
      if (op === "upsert") {
        const v = values as Row;
        const hit = tables[table].find((r) => r.telegram_id === v.telegram_id);
        if (hit) Object.assign(hit, v);
        else tables[table].push({ ...v });
      }
      return rows;
    };
    const b: Record<string, unknown> = {};
    b.select = () => b;
    for (const w of ["update", "upsert", "insert"]) {
      b[w] = (v?: unknown) => {
        op = w;
        values = v;
        return b;
      };
    }
    b.eq = (c: string, v: unknown) => (filters.push(["eq", c, v]), preds.push((r) => r[c] === v), b);
    b.is = (c: string, v: unknown) => (filters.push(["is", c, v]), preds.push((r) => r[c] === v), b);
    b.in = (c: string, v: unknown[]) => (filters.push(["in", c, v]), preds.push((r) => v.includes(r[c])), b);
    b.ilike = (c: string, v: string) => (
      filters.push(["ilike", c, v]), preds.push((r) => String(r[c] ?? "").toLowerCase() === v.toLowerCase()), b
    );
    b.or = (expr: string) => {
      const alts = expr.split(",").map((part) => {
        const [col, kind, ...rest] = part.split(".");
        const val = rest.join(".");
        return (r: Row) => kind === "is" && val === "null" ? r[col] === null || r[col] === undefined : r[col] === val;
      });
      filters.push(["or", expr, null]);
      preds.push((r) => alts.some((a) => a(r)));
      return b;
    };
    b.order = () => b;
    b.limit = () => b;
    b.maybeSingle = () => Promise.resolve({ data: run()[0] ?? null, error: null });
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(res);
    return b;
  }

  const client = { from: (t: string) => chain(t) } as unknown as SupabaseClient;
  return { client, tables, writes };
}
