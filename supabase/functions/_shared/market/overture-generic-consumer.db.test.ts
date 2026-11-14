// Real PostgREST consumer, not a SQL copy of loadCountry. Uses only the existing test stack.
import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { Client } from "postgres";
import { loadCountry } from "./db.ts";

// Миграция 20261113130000 добавила в mkt_chains колонку hidden_at, а проверка снимка в этой (уже накатанной на проде)
// миграции хэширует всю строку: в тесте колонка вычитается так же, как updated_at.
const hideHiddenAt = (sql: string) => {
  const patched = sql.replace("(to_jsonb(c)-'updated_at')", "(to_jsonb(c)-array['updated_at','hidden_at'])");
  if (patched === sql) throw new Error("текст миграции изменился: поправь hideHiddenAt");
  return patched;
};

Deno.test("#1134: loadCountry drops the retired BY chain/points and preserves other chains/countries", async () => {
  const api = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!api || !key || !dbUrl) throw new Error("Existing isolated Supabase test environment is required");
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (!loopback.has(new URL(api).hostname) || !loopback.has(new URL(dbUrl).hostname)) {
    throw new Error("Consumer regression requires isolated loopback endpoints");
  }
  const requests: string[] = [];
  const sb = createClient(api, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch(input, init) {
        const address = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        if (!address.pathname.startsWith("/rest/v1/") || !["GET", "HEAD"].includes(method)) {
          throw new Error("Consumer must only read the test REST API; auth operations are forbidden");
        }
        requests.push(`${method} ${address.pathname}`);
        return fetch(input, init);
      },
    },
  });
  const fixture = JSON.parse(
    await Deno.readTextFile(new URL("./fixtures/by-generic-coffee.json", import.meta.url)),
  ) as {
    chain: Record<string, unknown>;
    locations: Record<string, unknown>[];
  };
  const targetKey = String(fixture.chain.key);
  const targetIds = new Set(fixture.locations.map((r) => String(r.id)));
  const controlChainIds = [crypto.randomUUID(), crypto.randomUUID()];
  const controlPointIds = [crypto.randomUUID(), crypto.randomUUID()];
  const chainIds = [String(fixture.chain.id), ...controlChainIds];
  const pointIds = [...targetIds, ...controlPointIds];
  const migration = hideHiddenAt(
    await Deno.readTextFile(
      new URL("../../../migrations/20261106215609_market_by_generic_chain.sql", import.meta.url),
    ),
  );
  const db = new Client(dbUrl);
  await db.connect();
  let ownsFixture = false;
  async function insert(table: "mkt_chains" | "mkt_locations", row: Record<string, unknown>) {
    const columns = Object.keys(row);
    if (columns.some((c) => !/^[a-z_]+$/.test(c))) throw new Error("Unexpected fixture column");
    await db.queryArray(
      `insert into ${table}(${columns.join(",")}) values(${columns.map((_, i) => `$${i + 1}`).join(",")})`,
      Object.values(row),
    );
  }
  try {
    await db.queryArray("begin");
    const { rows } = await db.queryObject<
      { n: number }
    >`select count(*)::int as n from mkt_chains where country in ('BY','PL')`;
    assertEquals(rows[0].n, 0, "Refuse to seed over existing country data");
    ownsFixture = true;
    await insert("mkt_chains", fixture.chain);
    for (const row of fixture.locations) await insert("mkt_locations", row);
    await insert("mkt_chains", {
      ...fixture.chain,
      id: controlChainIds[0],
      key: "qa-real-network",
      name: "QA named chain",
      notes: "curated control",
    });
    await insert("mkt_locations", {
      ...fixture.locations[0],
      id: controlPointIds[0],
      chain_key: "qa-real-network",
      ext_key: "qa-real-network",
      verification: "confirmed",
    });
    await insert("mkt_chains", { ...fixture.chain, id: controlChainIds[1], country: "PL", notes: "curated control" });
    await insert("mkt_locations", {
      ...fixture.locations[0],
      id: controlPointIds[1],
      country: "PL",
      verification: "confirmed",
    });
    // PostgREST uses another connection: publish only these isolated fixtures.
    await db.queryArray("commit");

    const beforeBY = await loadCountry(sb, "BY");
    const beforePL = await loadCountry(sb, "PL");
    assertEquals(beforeBY.chains.filter((c) => c.key === targetKey).length, 1);
    assertEquals((beforeBY.locations as Array<{ id: string }>).filter((p) => targetIds.has(p.id)).length, 8);
    assertEquals(beforePL.chains.length, 1);
    assertEquals(beforePL.locations.length, 1);

    await db.queryArray("begin");
    await db.queryArray(migration);
    await db.queryArray("commit");
    const afterBY = await loadCountry(sb, "BY");
    const afterPL = await loadCountry(sb, "PL");
    assertEquals(afterBY, {
      ...beforeBY,
      chains: beforeBY.chains.filter((c) => c.key !== targetKey),
      locations: (beforeBY.locations as Array<{ id: string }>).filter((p) => !targetIds.has(p.id)),
    });
    assertEquals(afterPL, beforePL);
    assertEquals(afterBY.chains.map((c) => c.key), ["qa-real-network"]);
    assertEquals(afterBY.locations.length, 1);
    assert(requests.length > 0, "The actual consumer must use the real test REST API");
  } finally {
    try {
      await db.queryArray("rollback");
      if (ownsFixture) {
        await db.queryArray("begin");
        await db.queryArray`delete from mkt_locations where country in ('BY','PL') and id=any(${pointIds}::uuid[])`;
        await db.queryArray`delete from mkt_chains where country in ('BY','PL') and id=any(${chainIds}::uuid[])`;
        await db.queryArray("commit");
      }
    } finally {
      await db.end();
    }
  }
});
