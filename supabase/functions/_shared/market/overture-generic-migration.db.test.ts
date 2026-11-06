import { assertEquals, assertRejects } from "@std/assert";
import { Client } from "postgres";

const url = Deno.env.get("SUPABASE_DB_URL");
if (!url) throw new Error("SUPABASE_DB_URL is required: use an isolated test database");
const fixture = JSON.parse(await Deno.readTextFile(new URL("./fixtures/by-generic-coffee.json", import.meta.url))) as {
  chain: Record<string, unknown>;
  locations: Record<string, unknown>[];
};
const key = String(fixture.chain.key);
const pointId = String(fixture.locations[0].id);
const migration = await Deno.readTextFile(
  new URL("../../../migrations/20261106215609_market_by_generic_chain.sql", import.meta.url),
);

async function open() {
  const db = new Client(url!);
  await db.connect();
  await db.queryArray("begin");
  try {
    const { rows } = await db.queryObject<
      { n: number }
    >`select count(*)::int as n from mkt_chains where country in ('BY','PL')`;
    assertEquals(rows[0].n, 0, "Migration regression requires empty fixture countries");
    return db;
  } catch (e) {
    await db.queryArray("rollback");
    await db.end();
    throw e;
  }
}
async function insert(db: Client, table: "mkt_chains" | "mkt_locations", data: Record<string, unknown>) {
  const columns = Object.keys(data);
  if (columns.some((c) => !/^[a-z_]+$/.test(c))) throw new Error("Unexpected fixture column");
  await db.queryArray(
    `insert into ${table}(${columns.join(",")}) values(${columns.map((_, i) => `$${i + 1}`).join(",")})`,
    Object.values(data),
  );
}
async function seed(db: Client) {
  assertEquals(fixture.locations.length, 8);
  await insert(db, "mkt_chains", fixture.chain);
  for (const row of fixture.locations) await insert(db, "mkt_locations", row);
}
async function close(db: Client) {
  await db.queryArray("rollback");
  await db.end();
}
async function counts(db: Client) {
  const { rows } = await db.queryObject<{ chains: number; locations: number }>`select
    (select count(*)::int from mkt_chains where country='BY' and key=${key}) as chains,
    (select count(*)::int from mkt_locations where country='BY' and chain_key=${key}) as locations`;
  return rows[0];
}
async function snapshot(db: Client) {
  const { rows } = await db.queryObject<{ state: string }>(`select jsonb_build_object(
    'chains',(select jsonb_agg(to_jsonb(t) order by id) from mkt_chains t where country in ('BY','PL')),
    'locations',(select jsonb_agg(to_jsonb(t) order by id) from mkt_locations t where country in ('BY','PL')),
    'prices',(select jsonb_agg(to_jsonb(t) order by id) from mkt_prices t where country in ('BY','PL')),
    'companies',(select jsonb_agg(to_jsonb(t) order by id) from mkt_companies t where country in ('BY','PL')),
    'ratings',(select jsonb_agg(to_jsonb(t) order by id) from mkt_ratings t where country in ('BY','PL')),
    'sources',(select jsonb_agg(to_jsonb(t) order by adapter,chain_key,feeds) from mkt_sources t where country in ('BY','PL')),
    'editorial',(select jsonb_agg(to_jsonb(t) order by block) from mkt_editorial t where country in ('BY','PL')),
    'candidates',(select jsonb_agg(to_jsonb(t) order by id) from mkt_candidates t where country in ('BY','PL')),
    'facts',(select jsonb_agg(to_jsonb(t) order by id) from mkt_facts t where country in ('BY','PL'))
  )::text as state`);
  return rows[0].state;
}
async function unrelated(db: Client) {
  const { rows } = await db.queryObject<{ state: string }>`select jsonb_build_object(
    'chains',(select jsonb_agg(to_jsonb(t) order by id) from mkt_chains t
      where country in ('BY','PL') and not (country='BY' and key=${key})),
    'locations',(select jsonb_agg(to_jsonb(t) order by id) from mkt_locations t
      where country in ('BY','PL') and not (country='BY' and chain_key=${key}))
  )::text as state`;
  return rows[0].state;
}

Deno.test("#1134: cleanup removes exactly the eight captured BY rows and chain, preserves other data, and is idempotent", async () => {
  const db = await open();
  try {
    // Supabase uses shortened float output; the migration must not change its caller's rendering.
    await db.queryArray("set local extra_float_digits=0");
    await seed(db);
    await insert(db, "mkt_chains", {
      ...fixture.chain,
      id: crypto.randomUUID(),
      country: "PL",
      notes: "curated control",
    });
    await insert(db, "mkt_locations", {
      ...fixture.locations[0],
      id: crypto.randomUUID(),
      country: "PL",
      verification: "confirmed",
    });
    for (const other of ["named-coffee", "producer-shop"]) {
      await insert(db, "mkt_chains", {
        ...fixture.chain,
        id: crypto.randomUUID(),
        key: other,
        name: other,
        notes: "curated control",
      });
      await insert(db, "mkt_locations", {
        ...fixture.locations[0],
        id: crypto.randomUUID(),
        chain_key: other,
        ext_key: other,
        verification: "confirmed",
      });
    }
    const controls = await unrelated(db);
    await db.queryArray(migration);
    assertEquals(await counts(db), { chains: 0, locations: 0 });
    const { rows } = await db.queryObject<
      { n: number }
    >`select count(*)::int as n from mkt_locations where country in ('BY','PL')`;
    assertEquals(rows[0].n, 3);
    assertEquals(await unrelated(db), controls);
    const after = await snapshot(db);
    await db.queryArray(migration);
    assertEquals(await snapshot(db), after);
  } finally {
    await close(db);
  }
});

for (const present of [false, true]) {
  Deno.test(`#1134: cleanup restores caller settings when target is ${present ? "present" : "absent"}`, async () => {
    const db = await open();
    try {
      await db.queryArray("set local extra_float_digits=0");
      await db.queryArray("set local lock_timeout='37s'");
      if (present) await seed(db);
      const read = async () =>
        (await db.queryObject<{ precision: string; timeout: string }>(
          "select current_setting('extra_float_digits') as precision,current_setting('lock_timeout') as timeout",
        )).rows[0];
      const before = await read();
      await db.queryArray(migration);
      assertEquals(await read(), before);
    } finally {
      await close(db);
    }
  });
}

Deno.test("#1134: failed cleanup restores caller settings through savepoint rollback", async () => {
  const db = await open();
  try {
    await db.queryArray("set local extra_float_digits=0");
    await db.queryArray("set local lock_timeout='37s'");
    await seed(db);
    await db.queryArray`update mkt_chains set notes='curated control' where country='BY' and key=${key}`;
    const read = async () =>
      (await db.queryObject<{ precision: string; timeout: string }>(
        "select current_setting('extra_float_digits') as precision,current_setting('lock_timeout') as timeout",
      )).rows[0];
    const before = await read();
    await db.queryArray("savepoint cleanup_settings");
    await assertRejects(() => db.queryArray(migration), Error, "BY generic");
    await db.queryArray("rollback to savepoint cleanup_settings");
    assertEquals(await read(), before);
    assertEquals(await counts(db), { chains: 1, locations: 8 });
  } finally {
    await close(db);
  }
});

Deno.test("#1134: absent target is a no-op", async () => {
  const db = await open();
  try {
    const before = await snapshot(db);
    await db.queryArray(migration);
    assertEquals(await snapshot(db), before);
  } finally {
    await close(db);
  }
});

Deno.test("#1134: automatic freshness timestamps do not invalidate the business-state CAS", async () => {
  const db = await open();
  try {
    await seed(db);
    await db.queryArray`update mkt_chains set updated_at=updated_at+interval '1 day' where country='BY' and key=${key}`;
    await db
      .queryArray`update mkt_locations set first_seen_at=first_seen_at-interval '1 day',last_seen_at=last_seen_at+interval '1 day' where country='BY' and chain_key=${key}`;
    await db.queryArray(migration);
    assertEquals(await counts(db), { chains: 0, locations: 0 });
  } finally {
    await close(db);
  }
});

const changes: [string, (db: Client) => Promise<unknown>][] = [
  ["renamed chain", (db) => db.queryArray`update mkt_chains set name='Named chain' where country='BY' and key=${key}`],
  [
    "manually curated chain",
    (db) => db.queryArray`update mkt_chains set notes='curated' where country='BY' and key=${key}`,
  ],
  [
    "recreated chain identity",
    (db) => db.queryArray`update mkt_chains set id=gen_random_uuid() where country='BY' and key=${key}`,
  ],
  [
    "extra point",
    (db) => insert(db, "mkt_locations", { ...fixture.locations[0], id: crypto.randomUUID(), ext_key: "extra" }),
  ],
  ["missing captured point", (db) => db.queryArray`delete from mkt_locations where id=${pointId}::uuid`],
  [
    "replacement point identity",
    (db) => db.queryArray`update mkt_locations set id=gen_random_uuid() where id=${pointId}::uuid`,
  ],
  ["manual point", (db) => db.queryArray`update mkt_locations set source_kind='manual' where id=${pointId}::uuid`],
  [
    "confirmed point",
    (db) => db.queryArray`update mkt_locations set verification='confirmed' where id=${pointId}::uuid`,
  ],
  ["point note", (db) => db.queryArray`update mkt_locations set verification_note='curated' where id=${pointId}::uuid`],
  [
    "changed address",
    (db) => db.queryArray`update mkt_locations set address='Different address' where id=${pointId}::uuid`,
  ],
  ["changed coordinates", (db) => db.queryArray`update mkt_locations set lat=lat+0.01 where id=${pointId}::uuid`],
  [
    "changed ingestion state",
    (db) => db.queryArray`update mkt_locations set missing_weeks=missing_weeks+1 where id=${pointId}::uuid`,
  ],
  [
    "closed point",
    (db) => db.queryArray`update mkt_locations set status='closed',closed='2026-11' where id=${pointId}::uuid`,
  ],
  [
    "price reference",
    (db) => db.queryArray`insert into mkt_prices(country,chain_key,item,price_eur) values ('BY',${key},'Fixture',1)`,
  ],
  [
    "company reference",
    (db) => db.queryArray`insert into mkt_companies(country,chain_key,name) values ('BY',${key},'Fixture')`,
  ],
  [
    "chain rating",
    (db) =>
      db.queryArray`insert into mkt_ratings(country,chain_key,platform,seen_on) values ('BY',${key},'fixture',current_date)`,
  ],
  [
    "location-only rating",
    (db) =>
      db.queryArray`insert into mkt_ratings(country,location_id,platform,seen_on) values ('BY',${pointId}::uuid,'fixture',current_date)`,
  ],
  [
    "source reference",
    (db) =>
      db.queryArray`insert into mkt_sources(country,adapter,chain_key,feeds,cadence,mode) values ('BY','fixture',${key},'locations','weekly','auto')`,
  ],
  [
    "editorial key reference",
    (db) =>
      db.queryArray`insert into mkt_editorial(country,block,payload) values ('BY','fixture',${
        JSON.stringify({ chain: key })
      }::jsonb)`,
  ],
  [
    "editorial point-only reference",
    (db) =>
      db.queryArray`insert into mkt_editorial(country,block,payload) values ('BY','fixture',${
        JSON.stringify({ location: pointId })
      }::jsonb)`,
  ],
  [
    "other-country editorial point reference",
    (db) =>
      db.queryArray`insert into mkt_editorial(country,block,payload) values ('PL','fixture',${
        JSON.stringify({ location: pointId })
      }::jsonb)`,
  ],
  [
    "candidate key reference",
    (db) =>
      db.queryArray`insert into mkt_candidates(country,kind,source,payload) values ('BY','new_location','fixture',${
        JSON.stringify({ chain: key })
      }::jsonb)`,
  ],
  [
    "candidate point-only reference",
    (db) =>
      db.queryArray`insert into mkt_candidates(country,kind,source,payload,target_id) values ('BY','new_location','fixture','{}',${pointId}::uuid)`,
  ],
  [
    "candidate payload point reference",
    (db) =>
      db.queryArray`insert into mkt_candidates(country,kind,source,payload) values ('BY','new_location','fixture',${
        JSON.stringify({ location: pointId })
      }::jsonb)`,
  ],
  [
    "fact key reference",
    (db) => db.queryArray`insert into mkt_facts(country,topic,text) values ('BY','insight',${key})`,
  ],
  [
    "other-country fact point reference",
    (db) => db.queryArray`insert into mkt_facts(country,topic,text) values ('PL','insight',${pointId})`,
  ],
];
for (const [label, change] of changes) {
  Deno.test(`#1134: cleanup refuses ${label} without losing any data`, async () => {
    const db = await open();
    try {
      await seed(db);
      await change(db);
      const before = await snapshot(db);
      await db.queryArray("savepoint cleanup");
      await assertRejects(() => db.queryArray(migration), Error, "BY generic");
      await db.queryArray("rollback to savepoint cleanup");
      assertEquals(await snapshot(db), before);
    } finally {
      await close(db);
    }
  });
}
