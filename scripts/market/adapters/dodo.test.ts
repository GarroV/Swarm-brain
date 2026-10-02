// Сборщик Dodo без сети: fetch подменяется, ЕЦБ «ещё не опубликовал курс».
import { assertEquals } from "@std/assert";
import { dodo } from "./dodo.ts";
import type { CountryConfig } from "../countries/types.ts";

const cfg = {
  country: "RO",
  dodoCode: "ro",
  chains: [],
  companies: [],
  sources: [],
} as unknown as CountryConfig;

Deno.test("dodo: a missing ECB rate keeps units, days and revenue, euro stays empty", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status }));
    if (url.includes("ecb.europa.eu")) {
      return json({ error: "No results found" }, 404);
    }
    if (url.includes("unitinfo/all")) {
      return json([{ Name: "B-1", Type: 1, State: 1 }]);
    }
    if (url.includes("countBySource")) return json({});
    if (url.includes("FinancialMetrics")) {
      return json({
        response: {
          currency: "RON",
          previous_month: { revenue: 4970, name: "September", year: 2026 },
        },
      });
    }
    return json({}, 500);
  };
  try {
    const r = await dodo.collect(cfg, {
      since: "2026-10-01",
      today: "2026-10-02",
    });
    assertEquals("failed" in r && r.failed, false);
    if (!("units" in r)) throw new Error("no units");
    assertEquals(r.units.length, 1);
    assertEquals(r.days.length, 1);
    assertEquals(r.revenue?.amount, 4970);
    assertEquals(r.revenue?.rates, undefined);
  } finally {
    globalThis.fetch = real;
  }
});
