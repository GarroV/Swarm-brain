import { assertEquals } from "@std/assert";
import { Client } from "postgres";

const url = Deno.env.get("SUPABASE_DB_URL");
if (!url) throw new Error("SUPABASE_DB_URL is required: use an isolated test database");
// Строки прода на 08.11.2026: 12 удаляемых и 8 остающихся двойников, плюс их сети.
const fixture = JSON.parse(
  await Deno.readTextFile(new URL("./fixtures/osm-dupes-playplace.json", import.meta.url)),
) as {
  chains: Record<string, unknown>[];
  locations: Record<string, unknown>[];
};
const migration = await Deno.readTextFile(
  new URL("../../../migrations/20261108120000_market_osm_dupes_playplace.sql", import.meta.url),
);
const GONE = [
  "cab30947-6a12-4b57-8ef3-d10099d7d0c9",
  "d08ae384-17e5-4870-b7d0-b2d782d5cf1c",
  "afb38fde-218f-443b-a627-bbfdf4edd375",
  "e17c84a5-bb60-46e9-9a36-88cf2f5d5471",
  "9a4a2241-1970-4196-bc6c-599ac81b2082",
  "a1a22843-1985-4b06-9143-6464906e69ea",
  "eb5bed62-273f-47f9-a5e9-c63b97646961",
  "a8bae0fd-094e-45da-a3a3-bbc97f8b6cb1",
  "4c6b58c2-1afe-425c-8839-cbde49d0a25c",
  "9f414191-fe0a-4511-a854-c7babc17c17f",
  "1f076040-70e8-4c94-9509-435f310a6fbe",
  "0dffaed1-ddc2-4a95-8ba6-c033199bce50",
];

async function open() {
  const db = new Client(url!);
  await db.connect();
  await db.queryArray("begin");
  try {
    const { rows } = await db.queryObject<{ n: number }>`select count(*)::int as n from mkt_chains
      where country in ('AZ','HU','RS','EE','TJ','RO')`;
    assertEquals(rows[0].n, 0, "Migration regression requires empty fixture countries");
    // Supabase uses shortened float output; the migration must render rows canonically on its own.
    await db.queryArray("set local extra_float_digits=0");
    for (
      const [table, data] of [
        ...fixture.chains.map((c) => ["mkt_chains", c] as const),
        ...fixture.locations.map((l) => ["mkt_locations", l] as const),
      ]
    ) {
      const columns = Object.keys(data);
      if (columns.some((c) => !/^[a-z_]+$/.test(c))) throw new Error("Unexpected fixture column");
      await db.queryArray(
        `insert into ${table}(${columns.join(",")}) values(${columns.map((_, i) => `$${i + 1}`).join(",")})`,
        Object.values(data),
      );
    }
    return db;
  } catch (e) {
    await db.queryArray("rollback");
    await db.end();
    throw e;
  }
}
async function close(db: Client) {
  await db.queryArray("rollback");
  await db.end();
}
async function left(db: Client) {
  const { rows } = await db.queryObject<{ id: string }>`select id from mkt_locations
    where country in ('AZ','HU','RS','EE','TJ','RO') order by id`;
  return rows.map((r) => r.id);
}

Deno.test("OSM dupes / PlayPlace cleanup removes exactly the twelve captured rows, keeps the eight keepers, is idempotent", async () => {
  const db = await open();
  try {
    const before = await left(db);
    assertEquals(before.length, 20);
    await db.queryArray(migration);
    const after = await left(db);
    assertEquals(after, before.filter((id) => !GONE.includes(id)));
    assertEquals(after.length, 8);
    await db.queryArray(migration);
    assertEquals(await left(db), after);
  } finally {
    await close(db);
  }
});

Deno.test("OSM dupes / PlayPlace cleanup skips an edited row, a row whose keeper is gone and a referenced row", async () => {
  const db = await open();
  try {
    // edited since the snapshot: PlayPlace cab30947 got curated
    await db.queryArray(
      "update mkt_locations set verification='confirmed' where id='cab30947-6a12-4b57-8ef3-d10099d7d0c9'",
    );
    // keeper deleted: EE 9a4a2241 must stay
    await db.queryArray("delete from mkt_locations where id='af94a8f0-b62a-48d7-b1a6-3e60ff783b25'");
    // referenced by a rating: RS 4c6b58c2 must stay
    await db.queryArray(
      "insert into mkt_ratings(country, chain_key, location_id, platform, rating, seen_on) values ('RS','mcdonalds','4c6b58c2-1afe-425c-8839-cbde49d0a25c','google',4.1,'2026-11-01')",
    );
    await db.queryArray(migration);
    const after = new Set(await left(db));
    for (
      const id of [
        "cab30947-6a12-4b57-8ef3-d10099d7d0c9",
        "9a4a2241-1970-4196-bc6c-599ac81b2082",
        "4c6b58c2-1afe-425c-8839-cbde49d0a25c",
      ]
    ) {
      assertEquals(after.has(id), true, `${id} must be skipped`);
    }
    assertEquals(GONE.filter((id) => after.has(id)).length, 3);
  } finally {
    await close(db);
  }
});
