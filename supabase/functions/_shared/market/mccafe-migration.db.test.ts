import { assert, assertEquals, assertRejects } from "@std/assert";
import { Client } from "postgres";

const url = Deno.env.get("SUPABASE_DB_URL");
if (!url) {
  throw new Error(
    "SUPABASE_DB_URL is required: run on an isolated test database",
  );
}
const migration = await Deno.readTextFile(
  new URL(
    "../../../migrations/20261106183721_market_mccafe.sql",
    import.meta.url,
  ),
);

async function open() {
  const db = new Client(url!);
  await db.connect();
  await db.queryArray("begin");
  // Refuse to test over an existing country's real data.
  const { rows } = await db.queryObject<
    { n: number }
  >`select count(*)::int as n from mkt_chains where country in ('ES','PL','HU','DE')`;
  assertEquals(
    rows[0].n,
    0,
    "Migration regression requires empty fixture countries",
  );
  return db;
}

async function seed(db: Client, cc: string, canonical = true) {
  if (canonical) {
    await db
      .queryArray`insert into mkt_chains(country,key,name) values (${cc},'mcdonalds','McDonald''s')`;
  }
  await db
    .queryArray`insert into mkt_chains(country,key,name) values (${cc},'mccafe','McCafé')`;
}

async function count(
  db: Client,
  table: "mkt_chains" | "mkt_locations",
  cc: string,
  key: string,
) {
  const column = table === "mkt_chains" ? "key" : "chain_key";
  const { rows } = await db.queryObject<{ n: number }>(
    `select count(*)::int as n from ${table} where country=$1 and ${column}=$2`,
    [cc, key],
  );
  return rows[0].n;
}

Deno.test("#896: migration folds known McCafé points, preserves distinct/history rows, and is idempotent", async () => {
  const db = await open();
  try {
    for (const cc of ["ES", "PL", "HU"]) {
      await seed(db, cc);
      for (
        const [chain, ext, lat, status, closed] of [
          ["mcdonalds", "known", 40, "open", null],
          ["mccafe", "duplicate", 40.00004, "open", null],
          ["mccafe", "address-duplicate", 40.002, "open", null],
          ["mccafe", "different-number", 40.003, "open", null],
          ["mccafe", "manual", 40.00002, "open", null],
          ["mccafe", "distinct", 41, "open", null],
          ["mccafe", "history", 40.02, "closed", "2020-01"],
        ]
      ) {
        await db
          .queryArray`insert into mkt_locations(country,chain_key,ext_key,name,address,lat,lng,status,closed,source_kind,verification)
          values (${cc},${chain},${ext},'Fixture',${
          ext === "distinct"
            ? "Other 21"
            : ext === "address-duplicate"
            ? "Ulica Street 1, Fixture"
            : ext === "different-number"
            ? "Street 2"
            : "Street 1"
        },${lat},0,${status},${closed},'overture','unverified')`;
      }
    }
    await db
      .queryArray`update mkt_locations set source_kind='manual',verification='confirmed',verification_note='Keep this fixture' where ext_key='manual'`;
    await seed(db, "DE");
    await db.queryArray(migration);
    for (const cc of ["ES", "PL", "HU"]) {
      assertEquals(await count(db, "mkt_chains", cc, "mccafe"), 0);
      assertEquals(await count(db, "mkt_locations", cc, "mccafe"), 0);
      assertEquals(await count(db, "mkt_locations", cc, "mcdonalds"), 5);
      const { rows } = await db.queryObject<
        { ext_key: string; status: string; closed: string | null }
      >`select ext_key,status,closed from mkt_locations where country=${cc} order by ext_key`;
      assertEquals(rows, [
        { ext_key: "different-number", status: "open", closed: null },
        { ext_key: "distinct", status: "open", closed: null },
        { ext_key: "history", status: "closed", closed: "2020-01" },
        { ext_key: "known", status: "open", closed: null },
        { ext_key: "manual", status: "open", closed: null },
      ]);
    }
    assertEquals(await count(db, "mkt_chains", "DE", "mccafe"), 1);
    await db.queryArray(migration);
    for (const cc of ["ES", "PL", "HU"]) {
      assertEquals(await count(db, "mkt_locations", cc, "mcdonalds"), 5);
    }
  } finally {
    await db.queryArray("rollback");
    await db.end();
  }
});

Deno.test("#896: migration refuses curated chain metadata instead of deleting it", async () => {
  const db = await open();
  try {
    await seed(db, "ES");
    await db
      .queryArray`update mkt_chains set notes='Curated fixture' where country='ES' and key='mccafe'`;
    await db.queryArray("savepoint before_merge");
    await assertRejects(
      () => db.queryArray(migration),
      Error,
      "curated metadata",
    );
    await db.queryArray("rollback to savepoint before_merge");
    assertEquals(await count(db, "mkt_chains", "ES", "mccafe"), 1);
  } finally {
    await db.queryArray("rollback");
    await db.end();
  }
});

Deno.test("#896: migration refuses unexpected non-location references without touching money", async () => {
  const db = await open();
  try {
    await seed(db, "PL");
    await db
      .queryArray`insert into mkt_prices(country,chain_key,item,item_type,price_eur) values ('PL','mccafe','Fixture','margherita',10)`;
    await db.queryArray("savepoint before_merge");
    await assertRejects(
      () => db.queryArray(migration),
      Error,
      "non-location references",
    );
    await db.queryArray("rollback to savepoint before_merge");
    const { rows } = await db.queryObject<
      { chain_key: string; price_eur: string }
    >`select chain_key,price_eur::text from mkt_prices where country='PL'`;
    assertEquals(rows, [{ chain_key: "mccafe", price_eur: "10" }]);
    assertEquals(await count(db, "mkt_chains", "PL", "mccafe"), 1);
  } finally {
    await db.queryArray("rollback");
    await db.end();
  }
});

Deno.test("#896: migration refuses a missing canonical chain", async () => {
  const db = await open();
  try {
    await seed(db, "HU", false);
    await db.queryArray("savepoint before_merge");
    const e = await assertRejects(
      () => db.queryArray(migration),
      Error,
      "canonical McDonald's",
    );
    assert(e.message.includes("missing"));
    await db.queryArray("rollback to savepoint before_merge");
    assertEquals(await count(db, "mkt_chains", "HU", "mccafe"), 1);
  } finally {
    await db.queryArray("rollback");
    await db.end();
  }
});
