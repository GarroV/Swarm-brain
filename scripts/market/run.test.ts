import { assertEquals, assertRejects } from "@std/assert";
import { httpGet } from "./lib.ts";
import { dueAdapters, isDue } from "./run.ts";
import { daysBetween } from "./adapters/dodo.ts";
import { findEeLinks } from "./adapters/ee-ariregister.ts";
import { overpassQuery } from "./adapters/osm.ts";
import { pickRoFiles } from "./adapters/ro-datagov.ts";
import { EE } from "./countries/EE.ts";

Deno.test("registries run in the first week of the month only, weekly always", () => {
  assertEquals([
    isDue("weekly", "2026-10-20"),
    isDue("monthly", "2026-10-20"),
    isDue("monthly", "2026-10-04"),
  ], [true, false, true]);
  assertEquals(isDue("manual", "2026-10-01"), false);
  assertEquals(dueAdapters(EE, "2026-10-20"), [
    "dodo-publicapi",
    "osm-overpass",
  ]);
  assertEquals(dueAdapters(EE, "2026-10-03"), [
    "dodo-publicapi",
    "osm-overpass",
    "ee-ariregister",
  ]);
  assertEquals(dueAdapters(EE, "2026-10-20", "ee-ariregister"), [
    "ee-ariregister",
  ]);
});

Deno.test("Dodo days run from since to yesterday, across month end", () => {
  assertEquals(daysBetween("2026-09-29", "2026-10-02"), [
    "2026-09-29",
    "2026-09-30",
    "2026-10-01",
  ]);
  assertEquals(daysBetween("2026-10-02", "2026-10-02"), []);
});

Deno.test("Estonian download links are found on the page by file name, per year", () => {
  const html =
    `<a href="/sites/default/files/1.aruannete_yldandmed_kuni_31082026_0.zip">a</a>
    <a href="/sites/default/files/4.2024_aruannete_elemendid_kuni_31082026_0.zip">b</a>
    <a href="/sites/default/files/4.2025_aruannete_elemendid_kuni_31082026_0.zip">c</a>`;
  const r = findEeLinks(html);
  assertEquals(
    r.reports,
    "https://avaandmed.ariregister.rik.ee/sites/default/files/1.aruannete_yldandmed_kuni_31082026_0.zip",
  );
  assertEquals(Object.keys(r.elements), ["2024", "2025"]);
});

Deno.test("Overpass query escapes brand names", () => {
  const q = overpassQuery("HR", ["Domino's", "McDonald's", "A.B"]);
  assertEquals(q.includes(`^(Domino's|McDonald's|A\\.B)$`), true);
  assertEquals(q.includes(`"ISO3166-1"="HR"`), true);
  // города и посёлки — тем же запросом, для города точки без addr:city
  assertEquals(q.includes(`node["place"~"^(city|town)$"](area.a);`), true);
});

Deno.test("Romanian yearly files are picked case-insensitively, .txt only", () => {
  const res = [
    "WEB_UU_AN2025.txt",
    "WEB_BL_BS_SL_AN2025.txt",
    "WEB_UU_AN2025.csv",
    "WEB_IFN2025.txt",
  ]
    .map((name) => ({ name, url: `u/${name}` }));
  assertEquals(pickRoFiles(res, 2025).map((r) => r.name), [
    "WEB_UU_AN2025.txt",
    "WEB_BL_BS_SL_AN2025.txt",
  ]);
});

Deno.test("Overpass query adds a name search among food places only when chains have osmNames", () => {
  assertEquals(overpassQuery("HR", ["KFC"]).includes(`["name"~`), false);
  const q = overpassQuery("RS", ["KFC"], ["Walter", "Скроз добра пекара"]);
  assertEquals(
    q.includes(
      `["amenity"~"^(fast_food|restaurant|cafe)$"]["name"~"^(Walter|Скроз добра пекара)",i]`,
    ),
    true,
  );
  assertEquals(
    q.includes(
      `["shop"~"^(bakery|pastry)$"]["name"~"^(Walter|Скроз добра пекара)",i]`,
    ),
    true,
  );
});

Deno.test("httpGet retries a busy server (429/504) with the given pauses, fails fast on other errors", async () => {
  const real = globalThis.fetch;
  const answer = (codes: number[]) => {
    let i = 0;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("x", { status: codes[i++] ?? 200 }),
      )) as typeof fetch;
    return () => i;
  };
  try {
    let calls = answer([504, 429, 200]);
    assertEquals((await httpGet("u", {}, [1, 1])).status, 200);
    assertEquals(calls(), 3);
    calls = answer([404, 200]);
    await assertRejects(() => httpGet("u", {}, [1, 1]), Error, "HTTP 404");
    assertEquals(calls(), 1);
  } finally {
    globalThis.fetch = real;
  }
});
