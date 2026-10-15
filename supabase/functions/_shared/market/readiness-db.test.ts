// listReadyCountries собирает входы `readyCountries` из семи таблиц mkt_*: здесь проверяем сборку
// (какая таблица что даёт, финансы через компании, ошибка базы не глотается). Условия «готово» — readiness.test.ts.
import { assertEquals, assertRejects } from "@std/assert";
import { listReadyCountries } from "./db.ts";

type Row = Record<string, unknown>;

/** Заглушка клиента: цепочка select/in/gte/order/range, `await` отдаёт строки таблицы
 *  (фильтры `in` по колонке применяются, остальное — нет). */
function fakeClient(tables: Record<string, Row[]>, failTable?: string) {
  const from = (table: string) => {
    let rows = tables[table] ?? [];
    const q = {
      select: () => q,
      order: () => q,
      gte: () => q,
      in: (col: string, values: unknown[]) => {
        rows = rows.filter((r) => values.includes(r[col]));
        return q;
      },
      range: (a: number, b: number) => {
        rows = rows.slice(a, b + 1);
        return q;
      },
      // deno-lint-ignore no-explicit-any
      then: (ok: any, bad: any) =>
        Promise.resolve(
          table === failTable ? { data: null, error: { message: "boom" } } : { data: rows, error: null },
        ).then(ok, bad),
    };
    return q;
  };
  // deno-lint-ignore no-explicit-any
  return { from } as any;
}

const FRESH = new Date(Date.now() - 86_400_000).toISOString();
const base = (): Record<string, Row[]> => ({
  mkt_sources: [
    { country: "HR", adapter: "dodo", mode: "auto", last_ok_at: FRESH },
    { country: "BG", adapter: "dodo", mode: "auto", last_ok_at: FRESH },
  ],
  mkt_runs: [],
  mkt_editorial: [{ country: "HR" }],
  mkt_prices: [{ country: "HR" }, { country: "BG" }],
  mkt_facts: [{ country: "HR" }, { country: "BG" }],
  mkt_companies: [{ id: "c1", country: "HR" }, { id: "c2", country: "BG" }],
  mkt_financials: [{ company_id: "c1" }],
});

Deno.test("listReadyCountries: only the country with every section filled is ready", async () => {
  // BG: свежий источник, цены и факты есть, но нет editorial и финансов.
  assertEquals(await listReadyCountries(fakeClient(base()), ["HR", "BG"]), ["HR"]);
});

Deno.test("listReadyCountries: each single empty section keeps an otherwise complete country out", async () => {
  for (const table of ["mkt_editorial", "mkt_prices", "mkt_facts", "mkt_financials"]) {
    const t = base();
    t.mkt_editorial = [{ country: "HR" }];
    t[table] = [];
    assertEquals(await listReadyCountries(fakeClient(t), ["HR"]), [], table);
  }
});

Deno.test("listReadyCountries: financials count through the company's country, not the company id alone", async () => {
  const t = base();
  t.mkt_financials = [{ company_id: "c2" }]; // финансы у компании BG, у HR их нет
  t.mkt_editorial = [{ country: "HR" }, { country: "BG" }];
  assertEquals(await listReadyCountries(fakeClient(t), ["HR", "BG"]), ["BG"]);
});

Deno.test("listReadyCountries: a failed latest run makes the country not ready", async () => {
  const t = base();
  t.mkt_runs = [{ country: "HR", source: "dodo", status: "failed", finished_at: FRESH }];
  assertEquals(await listReadyCountries(fakeClient(t), ["HR"]), []);
});

Deno.test("listReadyCountries: no countries means no queries and an empty answer", async () => {
  const sb = {
    from: () => {
      throw new Error("must not query");
    },
  };
  // deno-lint-ignore no-explicit-any
  assertEquals(await listReadyCountries(sb as any, []), []);
});

Deno.test("listReadyCountries: a database error is thrown, not read as 'not ready'", async () => {
  await assertRejects(
    () => listReadyCountries(fakeClient(base(), "mkt_prices"), ["HR"]),
    Error,
    "boom",
  );
});
