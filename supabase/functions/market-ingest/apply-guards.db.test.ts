// #899: машинные правки не задевают точку, которую проверили руками (или перенесли в другую
// страну) между выборкой и записью. Отдельный файл от apply.db.test.ts — тот уже у предела размера.
import { assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { applyIngest } from "./apply.ts";
import type { OsmPoint } from "./types.ts";

for (const n of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(n)) {
    throw new Error(`Не задана ${n}: прогоняй через ./scripts/with-local-db`);
  }
}
const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const CC = "QG";
const started_at = new Date().toISOString();

// Строки с теми же ext_key (osm1, trusted) не должны пережить тест: apply.db.test.ts выбирает их без страны.
async function cleanup() {
  for (const cc of [CC, "QH"]) {
    await sb.from("mkt_locations").delete().eq("country", cc);
    await sb.from("mkt_runs").delete().eq("country", cc);
    await sb.from("mkt_chains").delete().eq("country", cc);
  }
}
function scenario(name: string, fn: () => Promise<void>) {
  Deno.test(name, async () => {
    try {
      await fn();
    } finally {
      await cleanup();
    }
  });
}

async function reset() {
  await sb.from("mkt_locations").delete().eq("country", CC);
  await sb.from("mkt_runs").delete().eq("country", CC);
  await sb.from("mkt_chains").delete().eq("country", CC);
  const ch = await sb.from("mkt_chains").insert({ country: CC, key: "kfc", name: "KFC" });
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

// #899: между выборкой и записью точку могут проверить руками (или перенести в другую страну).
// Перехват откладывает первую запись прогона по mkt_locations до такой правки: условия запроса
// обязаны удержать прогон от строки, которая уже не машинная.
type Query = PromiseLike<unknown> & { then: PromiseLike<unknown>["then"] };
function racing(flip: () => Promise<void>) {
  let fired = false;
  const hook = (q: Query) => {
    const then = q.then.bind(q);
    q.then = ((f: never, r: never) => {
      const go = fired ? Promise.resolve() : (fired = true, flip());
      return go.then(() => then(f, r));
    }) as Query["then"];
    return q;
  };
  return new Proxy(sb, {
    get(target, prop) {
      if (prop !== "from") return Reflect.get(target, prop);
      return (table: string) => {
        const b = target.from(table);
        if (table !== "mkt_locations") return b;
        for (const m of ["update", "delete"] as const) {
          const orig = b[m].bind(b) as (...a: unknown[]) => Query;
          (b as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => hook(orig(...a));
        }
        return b;
      };
    },
  });
}
const OTHER = "QH";
async function otherCountry() {
  await sb.from("mkt_locations").delete().eq("country", OTHER);
  await sb.from("mkt_chains").delete().eq("country", OTHER);
  const r = await sb.from("mkt_chains").insert({ country: OTHER, key: "kfc", name: "KFC" });
  if (r.error) throw new Error(r.error.message);
}
const edit = (patch: Record<string, unknown>) => async () => {
  const r = await sb.from("mkt_locations").update(patch).eq("country", CC).eq("ext_key", "osm1");
  if (r.error) throw new Error(r.error.message);
};
const osmRow = async (country: string) => {
  const { data } = await sb.from("mkt_locations").select("status, closed, missing_weeks, verification")
    .eq("country", country).eq("ext_key", "osm1").maybeSingle();
  return data;
};
const far: OsmPoint = { chain: "kfc", name: "F", lat: 47.0, lng: 17.0, city: null, address: null, osm_id: "node/7" };
// Пустой ответ при живой машинной точке — «подозрительный прогон», который ничего не закрывает.
const empty = { source: "osm" as const, country: CC, started_at, points: [far] };

scenario("#899 close: a point checked by hand after the read is not closed by the run", async () => {
  await reset();
  await applyIngest(racing(edit({ verification: "official" })), empty, "2026-10-05");
  assertEquals(await osmRow(CC), { status: "open", closed: null, missing_weeks: 2, verification: "official" });
});

scenario("#899 close: a point moved to another country after the read is not closed by the run", async () => {
  await reset();
  await otherCountry();
  try {
    await applyIngest(racing(edit({ country: OTHER })), empty, "2026-10-05");
    assertEquals(await osmRow(OTHER), { status: "open", closed: null, missing_weeks: 2, verification: "unverified" });
  } finally {
    await sb.from("mkt_locations").delete().eq("country", OTHER);
    await sb.from("mkt_chains").delete().eq("country", OTHER);
  }
});

scenario("#899 reopen: a point checked by hand after the read stays closed", async () => {
  await reset();
  const shut = await sb.from("mkt_locations").update({ status: "closed", closed: "2026-09-01" })
    .eq("country", CC).eq("ext_key", "osm1");
  if (shut.error) throw new Error(shut.error.message);
  const back = { chain: "kfc", name: "O", lat: 45.9, lng: 16.0, city: null, address: null, osm_id: "node/9" };
  await applyIngest(
    racing(edit({ verification: "official" })),
    { ...empty, points: [back, { ...back, lat: 45.8, lng: 15.9, osm_id: "node/8" }] },
    "2026-10-05",
  );
  assertEquals(await osmRow(CC), {
    status: "closed",
    closed: "2026-09-01",
    missing_weeks: 2,
    verification: "official",
  });
});

scenario("#899 mirror: a point checked by hand after the read is not deleted as a mirror", async () => {
  await reset();
  const near = await sb.from("mkt_locations").update({ lat: 45.80007, lng: 15.9 }).eq("country", CC)
    .eq("ext_key", "osm1");
  if (near.error) throw new Error(near.error.message);
  await applyIngest(racing(edit({ verification: "official" })), empty, "2026-10-05");
  assertEquals((await osmRow(CC))?.verification, "official");
});
