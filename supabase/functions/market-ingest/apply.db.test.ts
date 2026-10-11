// Правила приёма данных сборщиков — на настоящей базе (спека §«Правила сборщиков»).
import { assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { applyIngest } from "./apply.ts";
import { locKey } from "../_shared/market/db.ts";

for (const n of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(n)) {
    throw new Error(`Не задана ${n}: прогоняй через ./scripts/with-local-db`);
  }
}
const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const CC = "QD";
const started_at = new Date().toISOString();

async function reset() {
  const { data: cos } = await sb.from("mkt_companies").select("id").eq(
    "country",
    CC,
  );
  const ids = (cos ?? []).map((r) => r.id);
  if (ids.length) {
    await sb.from("mkt_financials").delete().in("company_id", ids);
  }
  for (
    const t of [
      "mkt_candidates",
      "mkt_runs",
      "mkt_locations",
      "mkt_dodo_monthly",
      "mkt_companies",
      "mkt_sources",
    ]
  ) {
    await sb.from(t).delete().eq("country", CC);
  }
  await sb.from("mkt_chains").delete().eq("country", CC);
  const ch = await sb.from("mkt_chains").insert({
    country: CC,
    key: "kfc",
    name: "KFC",
  });
  if (ch.error) throw new Error(`reset chains: ${ch.error.message}`);
  const ins = await sb.from("mkt_locations").insert([
    {
      country: CC,
      chain_key: "kfc",
      ext_key: "trusted",
      name: "T",
      lat: 45.8,
      lng: 15.9,
      status: "open",
      verification: "official",
      source_kind: "snapshot",
      missing_weeks: 0,
    },
    {
      country: CC,
      chain_key: "kfc",
      ext_key: "osm1",
      name: "O",
      lat: 45.9,
      lng: 16.0,
      status: "open",
      verification: "unverified",
      source_kind: "osm",
      missing_weeks: 2,
    },
  ]);
  if (ins.error) throw new Error(`reset locations: ${ins.error.message}`);
}

Deno.test("failed run changes nothing but is logged", async () => {
  await reset();
  await applyIngest(sb, {
    source: "osm",
    country: CC,
    started_at,
    failed: "504",
  }, "2026-10-05");
  const { data: locs } = await sb.from("mkt_locations").select(
    "ext_key, missing_weeks",
  ).eq("country", CC).order(
    "ext_key",
  );
  assertEquals(locs!.map((l) => l.missing_weeks), [2, 0]);
  const { data: runs } = await sb.from("mkt_runs").select("status, error").eq(
    "country",
    CC,
  );
  assertEquals(runs, [{ status: "failed", error: "504" }]);
  const { count } = await sb.from("mkt_candidates").select("id", {
    count: "exact",
    head: true,
  }).eq("country", CC);
  assertEquals(count, 0);
});

Deno.test("osm: new point added, trusted untouched, osm point closed automatically after 3 weeks", async () => {
  await reset();
  const p = {
    source: "osm" as const,
    country: CC,
    started_at,
    points: [{
      chain: "kfc",
      name: "N",
      lat: 46.5,
      lng: 16.5,
      city: null,
      address: null,
      osm_id: "node/1",
    }],
  };
  await applyIngest(sb, p, "2026-10-05");
  await applyIngest(sb, p, "2026-10-12");
  // новая точка встаёт сама (unverified, источник OSM), пропавшая закрывается сама — очередь пуста
  const { data: c } = await sb.from("mkt_candidates").select("kind").eq("country", CC);
  assertEquals(c, []);
  const { data: o } = await sb.from("mkt_locations").select("status, closed, verification_note").eq(
    "ext_key",
    "osm1",
  ).single();
  assertEquals(o, {
    status: "closed",
    closed: "2026-10-05",
    verification_note: "пропала из OpenStreetMap 3 прогонов подряд",
  });
  const { data: n } = await sb.from("mkt_locations").select("verification, source_kind").eq("country", CC).eq(
    "name",
    "N",
  )
    .single();
  assertEquals(n, { verification: "unverified", source_kind: "osm" });
  const { data: t } = await sb.from("mkt_locations").select(
    "status, missing_weeks",
  ).eq("ext_key", "trusted").single();
  assertEquals(t, { status: "open", missing_weeks: 0 });
});

Deno.test("osm: an empty city is filled, a checked point keeps its city, a machine OSM point follows OSM", async () => {
  await reset();
  for (const [key, city] of [["trusted", "Kept"], ["osm1", "Koper / Capodistria"]]) {
    const r = await sb.from("mkt_locations").update({ city }).eq("country", CC).eq("ext_key", key);
    if (r.error) throw new Error(r.error.message);
  }
  const blank = await sb.from("mkt_locations").insert({
    country: CC,
    chain_key: "kfc",
    ext_key: "blank",
    name: "B",
    lat: 46.5,
    lng: 16.5,
    status: "open",
    verification: "confirmed",
    source_kind: "snapshot",
    missing_weeks: 0,
  });
  if (blank.error) throw new Error(blank.error.message);
  const pt = (lat: number, lng: number, id: string, city: string) => ({
    chain: "kfc",
    name: "N",
    lat,
    lng,
    city,
    address: null,
    osm_id: id,
  });
  await applyIngest(sb, {
    source: "osm",
    country: CC,
    started_at,
    points: [pt(45.8, 15.9, "node/1", "Beograd"), pt(45.9, 16.0, "node/2", "Koper"), pt(46.5, 16.5, "node/3", "Celje")],
  }, "2026-10-05");
  const { data } = await sb.from("mkt_locations").select("ext_key, city").eq("country", CC).order("ext_key");
  assertEquals(data, [
    { ext_key: "blank", city: "Celje" },
    { ext_key: "osm1", city: "Koper" },
    { ext_key: "trusted", city: "Kept" },
  ]);
});

Deno.test("osm: old pending finds are closed by the run, a point closed by hand is not reopened", async () => {
  await reset();
  const found = { chain: "kfc", name: "N", lat: 45.8, lng: 15.9, city: null, address: null, osm_id: "node/1" };
  const gone = { ...found, lat: 46.6, lng: 16.6, osm_id: "node/2" };
  const keyOf = (p: typeof found) => locKey(p.chain, p.lat, p.lng, p.address);
  const ins = await sb.from("mkt_candidates").insert([found, gone].map((p) => ({
    country: CC,
    kind: "new_location",
    source: "osm",
    payload: { key: keyOf(p), row: {} },
  })));
  if (ins.error) throw new Error(ins.error.message);
  const shut = await sb.from("mkt_locations").insert({
    country: CC,
    chain_key: "kfc",
    ext_key: "shut",
    name: "S",
    lat: 47.0,
    lng: 17.0,
    status: "closed",
    verification: "confirmed",
    source_kind: "osm",
    missing_weeks: 0,
  });
  if (shut.error) throw new Error(shut.error.message);
  const reopen = { ...found, lat: 47.0, lng: 17.0, osm_id: "node/3" };
  await applyIngest(sb, { source: "osm", country: CC, started_at, points: [found, reopen] }, "2026-10-05");
  const { count } = await sb.from("mkt_candidates").select("id", { count: "exact", head: true }).eq("country", CC)
    .eq("kind", "new_location").eq("status", "pending");
  assertEquals(count, 0);
  const { data: shutRow } = await sb.from("mkt_locations").select("status").eq("ext_key", "shut").single();
  assertEquals(shutRow, { status: "closed" });
});

Deno.test("osm: one place mapped twice in OSM is one point; a mirror next to a verified point goes away", async () => {
  await reset();
  const base = { country: CC, chain_key: "kfc", name: "K", status: "open", missing_weeks: 0 };
  const ins = await sb.from("mkt_locations").insert([
    { ...base, ext_key: "snap", lat: 44.8, lng: 15.9, verification: "confirmed", source_kind: "snapshot" },
    { ...base, ext_key: "mirror", lat: 44.80007, lng: 15.9, verification: "unverified", source_kind: "osm" },
    {
      ...base,
      ext_key: "shut",
      lat: 44.0,
      lng: 14.0,
      verification: "confirmed",
      source_kind: "snapshot",
      status: "closed",
    },
  ]);
  if (ins.error) throw new Error(ins.error.message);
  const pt = { chain: "kfc", name: "K", city: null, address: null };
  await applyIngest(sb, {
    source: "osm",
    country: CC,
    started_at,
    points: [
      { ...pt, lat: 44.80001, lng: 15.9, osm_id: "node/1" },
      { ...pt, lat: 44.80008, lng: 15.9, osm_id: "way/2" },
      { ...pt, lat: 44.00002, lng: 14.0, osm_id: "node/3" },
      { ...pt, lat: 43.0, lng: 13.0, osm_id: "node/4" },
    ],
  }, "2026-10-05");
  const { data } = await sb.from("mkt_locations").select("ext_key, status").eq("country", CC).lt("lat", 45).order(
    "lat",
    { ascending: false },
  );
  assertEquals(data!.map((r) => r.ext_key === "snap" || r.ext_key === "shut" ? r.ext_key : r.status), [
    "snap",
    "shut",
    "open",
  ]);
});

Deno.test("osm: a machine point on the spot of a rejected object goes away; a checked one and one with a real neighbour stay", async () => {
  await reset();
  const base = {
    country: CC,
    chain_key: "kfc",
    name: "K",
    status: "open",
    missing_weeks: 0,
  };
  const ins = await sb.from("mkt_locations").insert([
    {
      ...base,
      ext_key: "fake",
      lat: 44.5,
      lng: 15.5,
      verification: "unverified",
      source_kind: "osm",
    },
    {
      ...base,
      ext_key: "checked",
      lat: 44.4,
      lng: 15.4,
      verification: "confirmed",
      source_kind: "osm",
    },
    {
      ...base,
      ext_key: "nextdoor",
      lat: 44.3,
      lng: 15.3,
      verification: "unverified",
      source_kind: "osm",
    },
  ]);
  if (ins.error) throw new Error(ins.error.message);
  const pt = { chain: "kfc", name: "K", city: null, address: null };
  const r = await applyIngest(sb, {
    source: "osm",
    country: CC,
    started_at,
    points: [{ ...pt, lat: 44.3, lng: 15.3, osm_id: "node/9" }],
    rejected: [
      { ...pt, lat: 44.50001, lng: 15.5, osm_id: "node/1" },
      { ...pt, lat: 44.40001, lng: 15.4, osm_id: "node/2" },
      { ...pt, lat: 44.30005, lng: 15.3, osm_id: "node/3" },
    ],
  }, "2026-10-05");
  const { data } = await sb.from("mkt_locations").select("ext_key").eq(
    "country",
    CC,
  ).lt("lat", 45).gt("lat", 44.2)
    .order("ext_key");
  assertEquals(data!.map((x) => x.ext_key), ["checked", "nextdoor"]);
  assertEquals((r as Record<string, unknown>).removed_wrong, 1);
});

Deno.test("osm: a country with over 1000 known points is matched in full", async () => {
  await reset();
  // Больше страницы PostgREST (1000 строк) и больше, чем влезает id в один URL.
  const N = 1100;
  const known = Array.from({ length: N }, (_, i) => ({
    country: CC,
    chain_key: "kfc",
    ext_key: `bulk${i}`,
    name: `B${i}`,
    lat: 40 + Math.floor(i / 50) * 0.01,
    lng: 10 + (i % 50) * 0.01,
    status: "open",
    verification: "unverified",
    source_kind: "osm",
    missing_weeks: 1,
  }));
  const ins = await sb.from("mkt_locations").insert(known);
  if (ins.error) throw new Error(ins.error.message);
  await applyIngest(sb, {
    source: "osm",
    country: CC,
    started_at,
    points: known.map((k, i) => ({
      chain: "kfc",
      name: k.name,
      lat: k.lat,
      lng: k.lng,
      city: null,
      address: null,
      osm_id: `node/${i}`,
    })),
  }, "2026-10-05");
  const { data: runs } = await sb.from("mkt_runs").select("status, error").eq("country", CC);
  assertEquals(runs, [{ status: "ok", error: null }]);
  const { count: fresh } = await sb.from("mkt_candidates").select("id", { count: "exact", head: true })
    .eq("country", CC).eq("kind", "new_location");
  assertEquals(fresh, 0);
  const { count: stale } = await sb.from("mkt_locations").select("id", { count: "exact", head: true })
    .eq("country", CC).like("ext_key", "bulk%").neq("missing_weeks", 0);
  assertEquals(stale, 0);
});

const pt = (id: string, lat: number, lng: number, chain = "kfc") => ({
  chain,
  name: "P",
  lat,
  lng,
  city: null,
  address: null,
  osm_id: id,
});
const loc = (ext_key: string, lat: number, lng: number, extra: Record<string, unknown> = {}) => ({
  country: CC,
  chain_key: "kfc",
  ext_key,
  name: ext_key,
  lat,
  lng,
  status: "open",
  verification: "unverified",
  source_kind: "overture",
  missing_weeks: 0,
  ...extra,
});
const rowOf = async (ext_key: string) =>
  (await sb.from("mkt_locations").select("status, closed, missing_weeks, source, source_kind").eq("country", CC)
    .eq("ext_key", ext_key).single()).data;

Deno.test("overture: adds points as overture/unverified with discovered chains after the max slot; existing chain untouched", async () => {
  await reset();
  await sb.from("mkt_chains").update({ slot: 4, name: "KFC keep" }).eq("country", CC).eq("key", "kfc");
  const chains = [
    { key: "kfc", name: "OVERWRITE", segment: "burger" },
    { key: "newa", name: "New A", segment: "pizza" },
    { key: "newb", name: "New B", segment: "bakery", bakery: true },
  ];
  const stats = await applyIngest(sb, {
    source: "overture",
    country: CC,
    started_at,
    chains,
    points: [pt("08f-a", 50.1, 10.1, "newa"), pt("08f-b", 50.2, 10.2, "newb"), pt("08f-c", 50.3, 10.3, "ghost")],
  }, "2026-10-12");
  assertEquals(stats.chains_added, 2);
  const { data: ch } = await sb.from("mkt_chains").select("key, name, slot, segment, is_bakery").eq("country", CC)
    .order("slot");
  assertEquals(ch, [
    { key: "kfc", name: "KFC keep", slot: 4, segment: "other", is_bakery: false },
    { key: "newa", name: "New A", slot: 5, segment: "pizza", is_bakery: false },
    { key: "newb", name: "New B", slot: 6, segment: "bakery", is_bakery: true },
  ]);
  const { data: l } = await sb.from("mkt_locations").select("chain_key, source_kind, verification, source").eq(
    "country",
    CC,
  ).eq("source_kind", "overture").order("chain_key");
  assertEquals(l, [
    {
      chain_key: "newa",
      source_kind: "overture",
      verification: "unverified",
      source: "https://explore.overturemaps.org/?id=08f-a",
    },
    {
      chain_key: "newb",
      source_kind: "overture",
      verification: "unverified",
      source: "https://explore.overturemaps.org/?id=08f-b",
    },
  ]);
  assertEquals(stats.dropped_unknown_chain, 1);
});

Deno.test("overture: a point missing 3 runs is closed with a date and no candidate; osm rows are not touched", async () => {
  await reset();
  await sb.from("mkt_locations").insert([
    loc("ov1", 48.0, 12.0),
    loc("ov2", 48.5, 12.5),
    loc("ov3", 49.0, 13.0),
    loc("ov4", 49.5, 13.5),
  ]);
  const run = (points: ReturnType<typeof pt>[]) =>
    applyIngest(sb, { source: "overture", country: CC, started_at, points }, "2026-10-12");
  // три из четырёх — не меньше 70%, прогон нормальный; ov1 не приходит
  const keep = [pt("x", 48.5, 12.5), pt("y", 49.0, 13.0), pt("z", 49.5, 13.5)];
  await run(keep);
  await run(keep);
  assertEquals((await rowOf("ov1"))!.status, "open");
  const stats = await run(keep);
  assertEquals(stats.closed_auto, 1);
  assertEquals(await rowOf("ov1"), {
    status: "closed",
    closed: "2026-10-12",
    missing_weeks: 3,
    source: null,
    source_kind: "overture",
  });
  assertEquals((await rowOf("osm1"))!.status, "open");
  const { count } = await sb.from("mkt_candidates").select("id", { count: "exact", head: true }).eq("country", CC);
  assertEquals(count, 0);
});

Deno.test("machine: a suspiciously small answer closes nothing and counts no missing weeks", async () => {
  await reset();
  const rows = Array.from({ length: 10 }, (_, i) => loc(`ov${i}`, 40 + i * 0.1, 20, { missing_weeks: 2 }));
  await sb.from("mkt_locations").insert(rows);
  // 6 из 10 — меньше 70%: прогон подозрительный
  const points = rows.slice(0, 6).map((r, i) => pt(`p${i}`, r.lat, r.lng));
  const stats = await applyIngest(sb, { source: "overture", country: CC, started_at, points }, "2026-10-12");
  assertEquals(stats.suspicious, 1);
  assertEquals(stats.closed_auto, 0);
  const { data } = await sb.from("mkt_locations").select("status, missing_weeks").eq("country", CC)
    .eq("source_kind", "overture");
  assertEquals(data!.filter((r) => r.status === "closed").length, 0);
  // пропавшие четыре остались на 2 неделях, не 3
  assertEquals(data!.filter((r) => r.missing_weeks === 2).length, 4);
});

Deno.test("machine: a point that comes back after auto-close is reopened; a checked closed one is not", async () => {
  await reset();
  await sb.from("mkt_locations").insert([
    loc("back", 41.0, 21.0, { status: "closed", closed: "2026-09-01", missing_weeks: 3 }),
    loc("hand", 42.0, 22.0, { status: "closed", closed: "2026-09-01", verification: "confirmed" }),
    loc("stay", 43.0, 23.0),
  ]);
  const stats = await applyIngest(sb, {
    source: "overture",
    country: CC,
    started_at,
    points: [pt("a", 41.0, 21.0), pt("b", 42.0, 22.0), pt("c", 43.0, 23.0)],
  }, "2026-10-12");
  assertEquals(stats.reopened, 1);
  assertEquals((await rowOf("back"))!.status, "open");
  assertEquals((await rowOf("back"))!.closed, null);
  assertEquals((await rowOf("back"))!.missing_weeks, 0);
  assertEquals((await rowOf("hand"))!.status, "closed");
});

Deno.test("dodo: re-sending the same days does not double the month; units upserted as internal", async () => {
  await reset();
  const p = {
    source: "dodo" as const,
    country: CC,
    started_at,
    revenue: null,
    units: [{
      name: "Zagreb-1",
      city: "Zagreb",
      address: "Ilica 1",
      lat: 45.81,
      lng: 15.97,
      opened: "2024-04-01",
      open: true,
      organization: "X d.o.o.",
    }],
    days: [{ date: "2026-09-29", counts: { aggregator: 4 } }],
  };
  await applyIngest(sb, p, "2026-10-05");
  await applyIngest(sb, p, "2026-10-05");
  const { data } = await sb.from("mkt_dodo_monthly").select("orders, complete")
    .eq("country", CC).eq("month", "2026-09")
    .single();
  assertEquals((data!.orders as Record<string, number>).aggregator, 4);
  // Собран один день сентября из 30 — месяц прошёл, но итогом не считается.
  assertEquals(data!.complete, false);
  const { data: u } = await sb.from("mkt_locations").select(
    "verification, source_kind",
  ).eq("country", CC).eq(
    "chain_key",
    "dodo",
  );
  assertEquals(u, [{ verification: "internal", source_kind: "dodo" }]);
});

Deno.test("dodo: a unit near an already known Dodo point updates it instead of adding a twin", async () => {
  await reset();
  await sb.from("mkt_chains").upsert({ country: CC, key: "dodo", name: "Dodo Pizza" }, { onConflict: "country,key" });
  const known = await sb.from("mkt_locations").insert({
    country: CC,
    chain_key: "dodo",
    ext_key: "dodo:45.8040:15.9590:tratinskaulica12",
    name: "Dodo Pizza Zagreb-1 (Tresnjevka)",
    lat: 45.804,
    lng: 15.959,
    status: "paused",
    opened: "2023",
    source_kind: "dodo",
    verification: "internal",
  });
  if (known.error) throw new Error(known.error.message);
  const unit = (name: string, lat: number, lng: number) => ({
    name,
    city: "Zagreb",
    address: null,
    lat,
    lng,
    opened: "2023-05-01",
    open: true,
    organization: "X d.o.o.",
  });
  const p = {
    source: "dodo" as const,
    country: CC,
    started_at,
    revenue: null,
    days: [],
    units: [unit("Zagreb-1", 45.8041, 15.9592), unit("Zagreb-9", 45.9, 16.1)],
  };
  await applyIngest(sb, p, "2026-10-05");
  await applyIngest(sb, p, "2026-10-05");
  const { data } = await sb.from("mkt_locations").select("ext_key, status, opened").eq("country", CC).eq(
    "chain_key",
    "dodo",
  )
    .order("ext_key");
  assertEquals(data, [
    { ext_key: "dodo:Zagreb-1", status: "open", opened: "2023-05-01" },
    { ext_key: "dodo:Zagreb-9", status: "open", opened: "2023-05-01" },
  ]);
});

Deno.test("dodo: revenue in local currency is converted with the month's ECB rate", async () => {
  await reset();
  const base = {
    source: "dodo" as const,
    country: CC,
    started_at,
    units: [],
    days: [],
  };
  await applyIngest(sb, {
    ...base,
    revenue: {
      month: "2026-08",
      amount: 1000,
      currency: "RON",
      units: 3,
      rates: { RON: 5 },
    },
  }, "2026-10-05");
  await applyIngest(sb, {
    ...base,
    revenue: { month: "2026-07", amount: 1000, currency: "RON", units: 3 },
  }, "2026-10-05");
  const { data } = await sb.from("mkt_dodo_monthly").select(
    "month, revenue_local, revenue_eur",
  ).eq("country", CC)
    .order("month");
  assertEquals(data, [
    { month: "2026-07", revenue_local: 1000, revenue_eur: null },
    { month: "2026-08", revenue_local: 1000, revenue_eur: 200 },
  ]);
});

Deno.test("registry: new year written, change over trusted value becomes a candidate", async () => {
  await reset();
  const { data: co } = await sb.from("mkt_companies").insert({
    country: CC,
    chain_key: "kfc",
    name: "KFC Co",
    reg_id: "R1",
  })
    .select("id").single();
  await sb.from("mkt_financials").insert({
    company_id: co!.id,
    year: 2024,
    revenue_eur: 100,
    verification: "confirmed",
  });
  await applyIngest(sb, {
    source: "registry",
    adapter: "ee-ariregister",
    country: CC,
    started_at,
    years: [
      {
        reg_id: "R1",
        year: 2024,
        revenue_eur: 120,
        net_profit_eur: null,
        employees: null,
        source: "ee",
      },
      {
        reg_id: "R1",
        year: 2025,
        revenue_eur: 130,
        net_profit_eur: 5,
        employees: 3,
        source: "ee",
      },
      {
        reg_id: "NOPE",
        year: 2025,
        revenue_eur: 1,
        net_profit_eur: null,
        employees: null,
        source: "ee",
      },
    ],
  }, "2026-10-05");
  const { data: fin } = await sb.from("mkt_financials").select(
    "year, revenue_eur, verification",
  ).eq(
    "company_id",
    co!.id,
  ).order("year");
  assertEquals(fin, [{
    year: 2024,
    revenue_eur: 100,
    verification: "confirmed",
  }, {
    year: 2025,
    revenue_eur: 130,
    verification: "official",
  }]);
  const { data: c } = await sb.from("mkt_candidates").select("kind").eq(
    "country",
    CC,
  );
  assertEquals(c, [{ kind: "financial_update" }]);
});

Deno.test("config upserts chains, companies and sources; ok run stamps last_ok_at", async () => {
  await reset();
  await applyIngest(sb, {
    source: "config",
    country: CC,
    started_at,
    chains: [{ key: "kfc", name: "KFC", segment: "chicken" }, {
      key: "mlinar",
      name: "Mlinar",
      segment: "bakery",
      bakery: true,
    }],
    companies: [{ chain: "kfc", name: "KFC Co", regId: "R1" }],
    sources: [
      {
        adapter: "osm-overpass",
        feeds: "locations",
        cadence: "weekly",
        mode: "auto",
      },
      {
        adapter: "manual",
        feeds: "financials",
        cadence: "manual",
        mode: "blocked",
        reason: "Fina: login",
      },
    ],
  }, "2026-10-05");
  await applyIngest(
    sb,
    { source: "osm", country: CC, started_at, points: [] },
    "2026-10-05",
  );
  const { data: s } = await sb.from("mkt_sources").select(
    "adapter, mode, last_ok_at",
  ).eq("country", CC).order(
    "adapter",
  );
  assertEquals(s!.map((x) => [x.adapter, x.mode, x.last_ok_at !== null]), [[
    "manual",
    "blocked",
    false,
  ], [
    "osm-overpass",
    "auto",
    true,
  ]]);
  const { count } = await sb.from("mkt_chains").select("key", {
    count: "exact",
    head: true,
  }).eq("country", CC);
  assertEquals(count, 2);
});
