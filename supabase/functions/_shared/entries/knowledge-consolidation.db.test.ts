import { assert, assertEquals, AssertionError } from "@std/assert";
import { Client } from "postgres";

const url = Deno.env.get("SUPABASE_DB_URL");
if (!url) throw new Error("SUPABASE_DB_URL is required: isolated test database only");
if (!["127.0.0.1", "localhost", "::1"].includes(new URL(url).hostname.replace(/^\[|\]$/g, ""))) {
  throw new Error("This migration fixture requires a localhost isolated test database");
}
const migration = await Deno.readTextFile(
  new URL("../../../migrations/20261113180000_consolidate_legacy_mcp_knowledge.sql", import.meta.url),
);

type Part = {
  id: string;
  content: string;
  summary: string | null;
  metadata: Record<string, unknown>;
  source: string;
  added_by: string;
  countries: string[];
  is_private: boolean;
  shared_with: number[];
  visible_group_ids: string[];
  updated_at: string;
  archived_at: string | null;
};
type Group = { name: string; original: string; rows: Part[]; repaired: boolean };

function group(name: string, original: string, repaired = false): Group {
  const chunkGroup = crypto.randomUUID();
  const texts = [];
  for (let pos = 0; pos < original.length; pos += 2800) texts.push(original.slice(pos, pos + 3000));
  return {
    name,
    original,
    repaired,
    rows: texts.map((content, i) => ({
      id: crypto.randomUUID(),
      content,
      summary: i === 0 ? "Fictional summary" : null,
      metadata: { chunk_group_id: chunkGroup, chunk: i + 1, total_chunks: texts.length },
      source: "fixture-790",
      added_by: "claude_desktop",
      countries: ["PL"],
      is_private: false,
      shared_with: [],
      visible_group_ids: ["cee"],
      updated_at: "2026-09-01T00:00:00Z",
      archived_at: null,
    })),
  };
}

async function insert(db: Client, row: Part) {
  await db.queryArray(
    `insert into public.entries
      (id, content, summary, metadata, source, added_by, countries, entry_type, group_id,
       is_private, owner_id, shared_with, visible_group_ids, created_at, updated_at, archived_at, embedding)
     values ($1,$2,$3,$4::jsonb,$5,$6,$7,'note','cee',$8,null,$9,$10,
       '2026-09-01T00:00:00Z',$11,$12,array_fill(0.125::real,array[1536])::vector)`,
    [
      row.id,
      row.content,
      row.summary,
      JSON.stringify(row.metadata),
      row.source,
      row.added_by,
      row.countries,
      row.is_private,
      row.shared_with,
      row.visible_group_ids,
      row.updated_at,
      row.archived_at,
    ],
  );
}

async function snapshot(db: Client, ids: string[]) {
  const result = await db.queryObject<{ value: Record<string, unknown> }>(
    `select jsonb_build_object('id',id,'content',content,'summary',summary,'metadata',metadata,
      'source',source,'added_by',added_by,'countries',countries,'entry_type',entry_type,
      'entry_date',entry_date,'group_id',group_id,'visible_group_ids',visible_group_ids,
      'owner_id',owner_id,'is_private',is_private,'shared_with',shared_with,
      'created_at',created_at,'updated_at',updated_at,'archived_at',archived_at,
      'archived_by',archived_by,'embedding_hash',md5(embedding::text)) as value
     from public.entries where id = any($1::uuid[]) order by id`,
    [ids],
  );
  return new Map(result.rows.map((r) => [r.value.id as string, r.value]));
}

Deno.test("#790 migration: exact full originals, unchanged rejected groups, safe references and idempotence", async () => {
  const db = new Client(url!);
  await db.connect();
  await db.queryArray("begin");
  try {
    const text = "Fictional START " + "abcdefg".repeat(1000) + " END";
    const groups = [
      group("valid", text, true),
      group("short-final-overlap", "abcdef".repeat(950), true),
      group("UTF16-emoji", "\u{1F600}".repeat(3000) + "END", true),
      group("head-reference", text, true),
      ...[
        "incomplete",
        "modified",
        "overlap",
        "private-mismatch",
        "share-mismatch",
        "workspace-mismatch",
        "foreign-writer",
        "bad-number",
        "extra-metadata",
        "archived-part",
        "tail-reference",
        "loose-reference",
        "array-reference",
        "text-link",
        "uppercase-url",
        "uppercase-text",
        "uppercase-text-array",
      ].map((name) => group(name, text)),
    ];
    const byName = (name: string) => groups.find((g) => g.name === name)!;
    byName("incomplete").rows.pop();
    byName("modified").rows[0].content = "EDITED " + byName("modified").rows[0].content.slice(7);
    byName("modified").rows[0].updated_at = "2026-09-02T00:00:00Z";
    byName("overlap").rows[1].content = "X" + byName("overlap").rows[1].content.slice(1);
    byName("private-mismatch").rows[1].is_private = true;
    byName("share-mismatch").rows[1].shared_with = [790];
    byName("workspace-mismatch").rows[1].visible_group_ids = ["cee", "demo"];
    byName("foreign-writer").rows.forEach((r) => r.added_by = "other_writer");
    byName("bad-number").rows[1].metadata.chunk = "2";
    byName("extra-metadata").rows[0].metadata.title = "Fictional edited title";
    byName("archived-part").rows[1].archived_at = "2026-09-02T00:00:00Z";
    for (const g of groups) for (const row of g.rows) await insert(db, row);
    const refTable = "knowledge_refs_790_" + crypto.randomUUID().replaceAll("-", "");
    await db.queryArray(`create table public.${refTable} (entry_id uuid references public.entries(id))`);
    await db.queryArray(`insert into public.${refTable}(entry_id) values ($1),($2)`, [
      byName("tail-reference").rows[1].id,
      byName("head-reference").rows[0].id,
    ]);
    const looseTable = "knowledge_refs_790_" + crypto.randomUUID().replaceAll("-", "");
    await db.queryArray(`create table public.${looseTable} (entry_id text, record_ids uuid[], entry_ids text[])`);
    await db.queryArray(`insert into public.${looseTable}(entry_id,record_ids) values ($1,$2::uuid[])`, [
      byName("loose-reference").rows[1].id,
      [byName("array-reference").rows[1].id],
    ]);
    await db.queryArray(`insert into public.${looseTable}(entry_id,entry_ids) values ($1,$2::text[])`, [
      byName("uppercase-text").rows[1].id.toUpperCase(),
      [byName("uppercase-text-array").rows[1].id.toUpperCase()],
    ]);
    const link = group("ordinary-link", "Fictional link to " + byName("text-link").rows[1].id).rows[0];
    link.metadata = {};
    link.added_by = "fixture";
    await insert(db, link);
    const uppercaseLink =
      group("uppercase-link", "https://fictional.invalid/entry/" + byName("uppercase-url").rows[1].id.toUpperCase())
        .rows[0];
    uppercaseLink.metadata = {};
    uppercaseLink.added_by = "fixture";
    await insert(db, uppercaseLink);
    const ids = [...groups.flatMap((g) => g.rows.map((r) => r.id)), link.id, uppercaseLink.id];
    const before = await snapshot(db, ids);
    const baseline = await db.queryObject<{ n: string }>(
      "select count(*)::text n from public.entries where id=any($1::uuid[]) and archived_at is null",
      [byName("valid").rows.map((r) => r.id)],
    );
    assert(Number(baseline.rows[0].n) > 1, "the real pre-migration fixture must reproduce separate visible tails");

    const contract = async () => {
      const after = await snapshot(db, ids);
      for (const g of groups) {
        if (!g.repaired) {
          for (const row of g.rows) {
            assertEquals(after.get(row.id), before.get(row.id), `${g.name}: rejected group changed`);
          }
          continue;
        }
        const head = g.rows[0];
        const value = after.get(head.id)!;
        const expected = {
          ...before.get(head.id)!,
          content: g.original,
          metadata: {
            legacy_chunk_group_id: head.metadata.chunk_group_id,
            legacy_chunk_ids: g.rows.map((r) => r.id),
          },
        };
        assertEquals(value, expected, `${g.name}: head ID/source/attribution/visibility/date/vector changed`);
        for (const tail of g.rows.slice(1)) {
          const actual = after.get(tail.id)!;
          assert(actual.archived_at !== null);
          assertEquals(actual, {
            ...before.get(tail.id)!,
            archived_at: actual.archived_at,
            archived_by: null,
            metadata: { ...tail.metadata, legacy_consolidated_into: head.id },
          }, `${g.name}: tail original not preserved`);
        }
        const live = await db.queryObject<{ n: string }>(
          "select count(*)::text n from public.entries where id=any($1::uuid[]) and archived_at is null",
          [g.rows.map((r) => r.id)],
        );
        assertEquals(live.rows[0].n, "1", `${g.name}: ordinary live count must be one before any page limit`);
      }
      assertEquals(after.get(link.id), before.get(link.id));
      assertEquals(after.get(uppercaseLink.id), before.get(uppercaseLink.id));
    };

    const substitutions = [
      [
        "case-sensitive-reference-scan",
        "where true on conflict do nothing",
        "where matches.value[1] = lower(matches.value[1]) on conflict do nothing",
      ],
      ["missing-full-content", "set content = full_content,", "set content = content,"],
      [
        "broken-overlap-validation",
        "if n <> overlap_units or right(contents[i - 1], overlap_chars) <> prefix then valid := false; exit; end if;",
        "if false then valid := false; exit; end if;",
      ],
    ];
    for (const [name, from, to] of substitutions) {
      assertEquals(migration.split(from).length - 1, 1, `${name}: mutant was not applied`);
      await db.queryArray("savepoint negative_control");
      await db.queryArray(migration.replace(from, to));
      let detected = false;
      try {
        await contract();
      } catch (error) {
        if (!(error instanceof AssertionError)) throw error;
        detected = true;
      }
      assert(detected, `${name}: wrong data did not fail the actual database contract`);
      await db.queryArray("rollback to savepoint negative_control");
      await db.queryArray("release savepoint negative_control");
    }
    await db.queryArray(migration);
    await contract();
    const once = await snapshot(db, ids);
    await db.queryArray(migration);
    assertEquals(await snapshot(db, ids), once, "second execution changed an already consolidated or rejected group");
  } finally {
    await db.queryArray("rollback");
    await db.end();
  }
});
