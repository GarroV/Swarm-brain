// Transactional proof only against the isolated CI database; never a production repair.
import { assertEquals, assertRejects } from "@std/assert";
import { Client } from "postgres";

const DB = Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = new URL(DB).hostname;
if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) throw new Error("Isolated loopback database required");
const ACTOR = 918300;
const PEER = 918301;

async function connection() {
  const db = new Client(DB);
  await db.connect();
  return db;
}

async function value<T>(db: Client, sql: string, args: unknown[] = []): Promise<T> {
  return (await db.queryObject<{ value: T }>(sql, args)).rows[0].value;
}

async function setup(db: Client, ws: string) {
  await db.queryArray(
    "insert into storage.buckets(id,name,public) values('meeting-audio','meeting-audio',false) on conflict(id) do nothing",
  );
  await db.queryArray("insert into workspaces(id,name) values($1,$1)", [ws]);
  await db.queryArray(
    "insert into allowed_users(telegram_id,username,added_by,group_id) values($1,'synthetic183',0,$3),($2,'synthetic183peer',0,$3)",
    [ACTOR, PEER, ws],
  );
}

async function meeting(db: Client, ws: string, options: Record<string, unknown> = {}) {
  const id = String(options.id ?? crypto.randomUUID());
  const row = {
    id,
    group_id: ws,
    identity_kind: "manual",
    identity_key: "manual:" + id,
    title: "Synthetic meeting",
    status: "awaiting_review",
    claim_owner: ACTOR,
    started_at: "2026-11-14T08:05:00Z",
    recorders: [{ telegram_id: ACTOR }],
    draft_notes_md: "Synthetic original notes",
    transcript: { segments: [{ start: 5, end: 6, speaker: "я", text: "Synthetic speech" }] },
    ...options,
  };
  await db.queryArray(
    `insert into meetings(id,group_id,identity_kind,identity_key,title,status,claim_owner,
    started_at,recorders,co_owners,draft_notes_md,transcript,entry_id,process_state)
    select id,group_id,identity_kind,identity_key,title,status,claim_owner,
    started_at,recorders,co_owners,draft_notes_md,transcript,entry_id,process_state
    from jsonb_to_record($1::jsonb) as r(id uuid,group_id text,identity_kind text,identity_key text,title text,
      status text,claim_owner bigint,started_at timestamptz,recorders jsonb,co_owners bigint[],draft_notes_md text,
      transcript jsonb,entry_id uuid,process_state jsonb)`,
    [JSON.stringify({ co_owners: [], ...row })],
  );
  return id;
}

async function published(db: Client, ws: string, options: Record<string, unknown> = {}) {
  const entry = await value<string>(
    db,
    "insert into entries(content,entry_type,source,added_by,owner_id,group_id,is_private,metadata) values('Original','meeting','test','synthetic',$1,$2,false,'{\"confirmed\":true}') returning id as value",
    [ACTOR, ws],
  );
  return await meeting(db, ws, { ...options, status: "in_base", entry_id: entry });
}

async function snapshot(db: Client, source: string, target: string, entry = false) {
  return await value<Record<string, unknown>>(
    db,
    "select manual_meeting_pair_snapshot($1::uuid,$2::uuid,$3::uuid,false) as value",
    [source, entry ? null : target, entry ? target : null],
  );
}

async function decide(db: Client, ws: string, source: string, target: string, options: {
  expected?: unknown;
  decision?: string;
  replace?: boolean;
  patch?: unknown;
  entry?: boolean;
} = {}) {
  const ctx = await snapshot(db, source, target, options.entry);
  return await value<Record<string, unknown>>(
    db,
    `select decide_manual_meeting_pair($1,$2,$3::uuid,$4::uuid,$5::uuid,false,$6::jsonb,$7,$8,$9,$10::jsonb) as value`,
    [
      ACTOR,
      ws,
      source,
      options.entry ? null : target,
      options.entry ? target : null,
      JSON.stringify(options.expected ?? ctx.versions),
      options.decision ?? "merge",
      options.replace ?? false,
      options.replace ? "incoming_richer" : "not_richer",
      options.patch == null ? null : JSON.stringify(options.patch),
    ],
  );
}

async function fails(db: Client, code: string, fn: () => Promise<unknown>) {
  await db.queryArray("savepoint expected_failure");
  try {
    const error = await assertRejects(fn);
    assertEquals((error as { fields?: { code?: string } }).fields?.code, code);
  } finally {
    await db.queryArray("rollback to savepoint expected_failure");
    await db.queryArray("release savepoint expected_failure");
  }
}

async function row(db: Client, id: string) {
  return await value<Record<string, unknown>>(db, "select to_jsonb(m) as value from meetings m where id=$1::uuid", [
    id,
  ]);
}

async function fixture(fn: (db: Client, ws: string) => Promise<void>) {
  const db = await connection();
  const ws = "test-manual183-" + crypto.randomUUID();
  try {
    await db.queryArray("begin");
    await setup(db, ws);
    await db.queryArray("set local role service_role");
    await fn(db, ws);
  } finally {
    await db.queryArray("rollback");
    await db.end();
  }
}

Deno.test("manual Yes preserves original rows, authors, note offsets and immutable pre-copy versions", () =>
  fixture(async (db, ws) => {
    const source = await meeting(db, ws, {
      process_state: { parts: [{ path: "synthetic183/source/sys.m4a", offset: 0 }], stage: "summarize" },
    });
    const target = await published(db, ws, {
      process_state: { parts: [{ path: "synthetic183/target/mic.m4a", offset: 1 }], stage: "summarize" },
      draft_notes_md: "Synthetic target notes",
      transcript: { segments: [{ text: "Short" }] },
      started_at: "2026-11-14T08:00:00Z",
    });
    await db.queryArray(
      "insert into meeting_live_notes(meeting_id,group_id,author_id,offset_sec,text) values($1::uuid,$3,$4,9,'Source note'),($2::uuid,$3,$5,7,'Target note')",
      [source, target, ws, ACTOR, PEER],
    );
    const notes = await value<unknown[]>(
      db,
      "select jsonb_agg(to_jsonb(n) order by n.id) as value from meeting_live_notes n where group_id=$1",
      [ws],
    );
    const beforeSource = await row(db, source);
    const beforeTarget = await row(db, target);
    const originalMetadata = await value<Record<string, unknown>>(
      db,
      "select metadata as value from entries where id=$1::uuid",
      [beforeTarget.entry_id],
    );
    const result = await decide(db, ws, source, target, {
      replace: true,
      patch: { content: "Replacement", summary: "Replacement", embedding: null, metadata: originalMetadata },
    });
    const stored = await value<Record<string, unknown>>(
      db,
      "select to_jsonb(d) as value from manual_meeting_pair_decisions d where id=$1::uuid",
      [result.id],
    );
    assertEquals(stored.source_snapshot, beforeSource);
    assertEquals(stored.target_snapshot, beforeTarget);
    assertEquals([...(stored.source_notes as unknown[]), ...(stored.target_notes as unknown[])].length, 2);
    assertEquals(
      await value(
        db,
        "select jsonb_agg(to_jsonb(n) order by n.id) as value from meeting_live_notes n where group_id=$1",
        [ws],
      ),
      notes,
    );
    const afterSource = await row(db, source);
    const afterTarget = await row(db, target);
    for (const key of ["id", "claim_owner", "recorders", "co_owners", "group_id", "started_at", "process_state"]) {
      assertEquals(afterSource[key], beforeSource[key], "source " + key);
      assertEquals(afterTarget[key], beforeTarget[key], "target " + key);
    }
    assertEquals(afterSource.manual_merge_target_id, target);
    assertEquals(afterSource.status, "in_base");
    assertEquals(afterSource.entry_id, beforeTarget.entry_id);
    assertEquals(afterTarget.draft_notes_md, beforeSource.draft_notes_md);
    assertEquals(
      await value(db, "select manual_meeting_verified_origin($1::uuid,$2::jsonb) as value", [
        target,
        JSON.stringify(afterTarget.transcript),
      ]),
      stored.recording_origin,
    );
    assertEquals((stored.recording_origin as Record<string, unknown>).meeting_id, source);
    assertEquals(
      await value(db, "select metadata->'confirmed' as value from entries where id=$1::uuid", [beforeTarget.entry_id]),
      true,
    );
    const repeated = await decide(db, ws, source, target, { replace: true });
    assertEquals(repeated.id, result.id);
    assertEquals(repeated.repeated, true);
    await fails(
      db,
      "P0001",
      () =>
        db.queryArray("update manual_meeting_pair_decisions set source_snapshot='{}' where id=$1::uuid", [result.id]),
    );
  }));

Deno.test("No remembers the eligible published pair across meeting-ID and entry-ID aliases", () =>
  fixture(async (db, ws) => {
    const source = await meeting(db, ws);
    const target = await published(db, ws);
    const entry = (await row(db, target)).entry_id as string;
    const before = [await row(db, source), await row(db, target)];
    const result = await decide(db, ws, source, target, { decision: "separate" });
    assertEquals([await row(db, source), await row(db, target)], before);
    const context = await snapshot(db, source, entry, true);
    assertEquals((context.previous as Record<string, unknown>).id, result.id);
    assertEquals((await decide(db, ws, source, entry, { entry: true, decision: "separate" })).id, result.id);
    await fails(db, "40001", () => decide(db, ws, source, entry, { entry: true }));
  }));

Deno.test("OPEN targets, including a linked but unpublished entry, cannot bypass the eligible subset", () =>
  fixture(async (db, ws) => {
    const source = await meeting(db, ws);
    const target = await meeting(db, ws);
    for (const decision of ["merge", "separate"]) {
      await fails(db, "42501", () => decide(db, ws, source, target, { decision }));
    }
    const entry = await value<string>(
      db,
      "insert into entries(content,entry_type,source,added_by,owner_id,group_id,is_private,metadata) values('Original','meeting','test','synthetic',$1,$2,false,'{\"confirmed\":true}') returning id as value",
      [ACTOR, ws],
    );
    await db.queryArray("update meetings set entry_id=$2::uuid where id=$1::uuid", [target, entry]);
    await fails(db, "42501", () => decide(db, ws, source, entry, { entry: true }));
    assertEquals(
      await value(db, "select count(*)::int as value from manual_meeting_pair_decisions where home_group_id=$1", [ws]),
      0,
    );
    assertEquals((await row(db, source)).status, "awaiting_review");
  }));

Deno.test("existing queued-upload metadata rejects confirmation without deleting or advancing its audio", () =>
  fixture(async (db, ws) => {
    const source = await meeting(db, ws);
    const target = await published(db, ws);
    const name = source + "/queued/agent_synthetic183.json";
    await db.queryArray("insert into storage.objects(bucket_id,name,metadata) values('meeting-audio',$1,'{}')", [name]);
    const before = await value(
      db,
      "select to_jsonb(o) as value from storage.objects o where bucket_id='meeting-audio' and name=$1",
      [name],
    );
    assertEquals(((await snapshot(db, source, target)).versions as Record<string, unknown>).queued, true);
    await fails(db, "55000", () => decide(db, ws, source, target));
    assertEquals(
      await value(
        db,
        "select to_jsonb(o) as value from storage.objects o where bucket_id='meeting-audio' and name=$1",
        [name],
      ),
      before,
    );
    assertEquals((await row(db, source)).manual_merge_target_id, null);
  }));

Deno.test("changed snapshot, edited notes, busy draft, missing member and lost original reader all reject atomically", () =>
  fixture(async (db, ws) => {
    const source = await meeting(db, ws);
    const target = await published(db, ws);
    const ctx = await snapshot(db, source, target);
    await db.queryArray("update meetings set title='Changed' where id=$1::uuid", [target]);
    // xmin is per transaction, so use an actual changed bound field in this same transaction.
    await fails(
      db,
      "40001",
      () => decide(db, ws, source, target, { expected: { ...(ctx.versions as object), target: "stale-version" } }),
    );
    await db.queryArray("update meetings set notes_edited_at=now() where id=$1::uuid", [target]);
    await fails(db, "40001", () => decide(db, ws, source, target, { replace: true }));
    await db.queryArray("update meetings set notes_edited_at=null,summary_status='processing' where id=$1::uuid", [
      target,
    ]);
    await fails(db, "55000", () => decide(db, ws, source, target));
    await db.queryArray("update meetings set summary_status=null where id=$1::uuid", [target]);
    await db.queryArray("update meetings set co_owners=$2::bigint[] where id=$1::uuid", [source, [PEER]]);
    await fails(db, "42501", () => decide(db, ws, source, target));
    await db.queryArray("update meetings set co_owners='{}' where id=$1::uuid", [source]);
    await db.queryArray("update allowed_users set group_id=null where telegram_id=$1", [ACTOR]);
    await fails(db, "42501", () => decide(db, ws, source, target));
    assertEquals(
      await value(db, "select count(*)::int as value from manual_meeting_pair_decisions where home_group_id=$1", [ws]),
      0,
    );
    assertEquals((await row(db, source)).manual_merge_target_id, null);
  }));

Deno.test("published replacement rollback is atomic on missing prepared content and leaves entry identity/ACL untouched", () =>
  fixture(async (db, ws) => {
    const source = await meeting(db, ws, { co_owners: [PEER] });
    const entry = await value<string>(
      db,
      "insert into entries(content,entry_type,source,added_by,owner_id,group_id,is_private,metadata) values('Original','meeting','test','synthetic',$1,$2,false,'{\"confirmed\":true}') returning id as value",
      [ACTOR, ws],
    );
    const target = await meeting(db, ws, { status: "in_base", entry_id: entry });
    // A public entry alone must not hide the source from its old co-owner: its backing
    // draft still has the original guard, which must also permit that co-owner.
    await fails(db, "42501", () => decide(db, ws, source, entry, { entry: true, replace: true }));
    await db.queryArray("update meetings set co_owners=$2::bigint[] where id=$1::uuid", [target, [PEER]]);
    await fails(db, "22023", () => decide(db, ws, source, entry, { entry: true, replace: true }));
    assertEquals((await row(db, source)).manual_merge_target_id, null);
    assertEquals((await row(db, target)).draft_notes_md, "Synthetic original notes");
    assertEquals(
      await value(db, "select count(*)::int as value from manual_meeting_pair_decisions where home_group_id=$1", [ws]),
      0,
    );
    const original = await value<Record<string, unknown>>(
      db,
      "select to_jsonb(e) as value from entries e where id=$1::uuid",
      [entry],
    );
    await decide(db, ws, source, entry, {
      entry: true,
      replace: true,
      patch: { content: "Replacement", summary: "Replacement", embedding: null, metadata: original.metadata },
    });
    const current = await value<Record<string, unknown>>(
      db,
      "select to_jsonb(e) as value from entries e where id=$1::uuid",
      [entry],
    );
    assertEquals(current.content, "Replacement");
    for (const key of ["id", "owner_id", "added_by", "is_private", "shared_with", "group_id", "created_at"]) {
      assertEquals(current[key], original[key], key);
    }
  }));

Deno.test("a retained confirmed version inherits its recording origin; unconfirmed/tampered JSON never gains authority", () =>
  fixture(async (db, ws) => {
    // Seed a retained trusted version explicitly. The current published-only flow does not
    // create OPEN-to-OPEN chains; this is a provenance reader/inheritance contract fixture.
    const original = await meeting(db, ws);
    const origin = {
      meeting_id: original,
      started_at: "2026-11-14T08:05:00Z",
      claim_owner: ACTOR,
      recorders: [{ telegram_id: ACTOR }],
    };
    const applied = {
      segments: [{ start: 5, end: 6, speaker: "synthetic", text: "Recorded original" }],
      manual_merge_origin: origin,
    };
    const source = await meeting(db, ws, { transcript: applied });
    await db.queryArray(
      `insert into manual_meeting_pair_decisions(source_meeting_id,target_meeting_id,target_key,
    decision,actor_id,home_group_id,is_private,source_snapshot,target_snapshot,canonical_meeting_id,applied_transcript,recording_origin)
    values($1::uuid,$2::uuid,$3,'merge',$4,$5,false,$6::jsonb,$7::jsonb,$2::uuid,$8::jsonb,$9::jsonb)`,
      [
        original,
        source,
        "m:" + source,
        ACTOR,
        ws,
        JSON.stringify(await row(db, original)),
        JSON.stringify(await row(db, source)),
        JSON.stringify(applied),
        JSON.stringify(origin),
      ],
    );
    const last = await published(db, ws);
    const patch = {
      content: "Replacement",
      summary: "Replacement",
      embedding: null,
      metadata: await value<Record<string, unknown>>(
        db,
        "select metadata as value from entries where id=$1::uuid",
        [(await row(db, last)).entry_id],
      ),
    };
    await decide(db, ws, source, last, { replace: true, patch });
    const final = await row(db, last);
    const verified = await value<Record<string, unknown>>(
      db,
      "select manual_meeting_verified_origin($1::uuid,$2::jsonb) as value",
      [last, JSON.stringify(final.transcript)],
    );
    assertEquals(verified.meeting_id, original);
    const tampered = { ...(final.transcript as object), segments: [{ text: "Tampered" }] };
    assertEquals(
      await value(db, "select manual_meeting_verified_origin($1::uuid,$2::jsonb) as value", [
        last,
        JSON.stringify(tampered),
      ]),
      null,
    );
    const plain = await meeting(db, ws, {
      transcript: { segments: [{ text: "Plain" }], manual_merge_origin: { meeting_id: original, claim_owner: PEER } },
    });
    const destination = await published(db, ws);
    await decide(db, ws, plain, destination, {
      replace: true,
      patch: {
        ...patch,
        metadata: await value<Record<string, unknown>>(
          db,
          "select metadata as value from entries where id=$1::uuid",
          [(await row(db, destination)).entry_id],
        ),
      },
    });
    const dest = await row(db, destination);
    assertEquals(
      (await value<Record<string, unknown>>(db, "select manual_meeting_verified_origin($1::uuid,$2::jsonb) as value", [
        destination,
        JSON.stringify(dest.transcript),
      ])).meeting_id,
      plain,
    );
  }));

Deno.test("deleting either original preserves the survivor and immutable history without blocking existing lifecycle", () =>
  fixture(async (db, ws) => {
    for (const deleteTarget of [false, true]) {
      const source = await meeting(db, ws);
      const target = await published(db, ws);
      const receipt = await decide(db, ws, source, target);
      const deleted = deleteTarget ? target : source;
      const survivor = deleteTarget ? source : target;
      await db.queryArray("delete from meetings where id=$1::uuid", [deleted]);
      const remaining = await row(db, survivor);
      assertEquals(remaining.id, survivor);
      assertEquals(remaining.manual_merge_target_id, null);
      const audit = await value<Record<string, unknown>>(
        db,
        "select to_jsonb(d) as value from manual_meeting_pair_decisions d where id=$1::uuid",
        [receipt.id],
      );
      assertEquals(audit.active, false);
      assertEquals((audit.source_snapshot as Record<string, unknown>).id, source);
      assertEquals((audit.target_snapshot as Record<string, unknown>).id, target);
    }
  }));

Deno.test("a legacy published entry without a backing meeting retains the first Yes receipt on retry", () =>
  fixture(async (db, ws) => {
    const source = await meeting(db, ws);
    const entry = await value<string>(
      db,
      "insert into entries(content,entry_type,source,added_by,owner_id,group_id,is_private,metadata) values('Original','meeting','test','synthetic',$1,$2,false,'{\"confirmed\":true}') returning id as value",
      [ACTOR, ws],
    );
    const first = await decide(db, ws, source, entry, { entry: true });
    assertEquals(first.target_meeting_id, null);
    assertEquals((await row(db, source)).entry_id, entry);
    const second = await decide(db, ws, source, entry, { entry: true });
    assertEquals(second.id, first.id);
    assertEquals(second.repeated, true);
    assertEquals((await snapshot(db, source, entry, true)).target, null);
    assertEquals(
      await value(
        db,
        "select count(*)::int as value from manual_meeting_pair_decisions where source_meeting_id=$1::uuid",
        [source],
      ),
      1,
    );
  }));

Deno.test("nonpublished or nonmeeting entries are ineligible with or without a linked in_base meeting", () =>
  fixture(async (db, ws) => {
    const source = await meeting(db, ws);
    for (
      const { metadata, type } of [
        { metadata: {}, type: "meeting" },
        { metadata: { confirmed: false }, type: "meeting" },
        { metadata: { confirmed: true }, type: "note" },
      ]
    ) {
      for (const backing of [false, true]) {
        const entry = await value<string>(
          db,
          "insert into entries(content,entry_type,source,added_by,owner_id,group_id,is_private,metadata) values('Pending',$4,'test','synthetic',$1,$2,false,$3::jsonb) returning id as value",
          [ACTOR, ws, JSON.stringify(metadata), type],
        );
        if (backing) await meeting(db, ws, { status: "in_base", entry_id: entry });
        await fails(db, "42501", () => decide(db, ws, source, entry, { entry: true }));
        assertEquals((await row(db, source)).status, "awaiting_review");
      }
    }
  }));

// These cases deliberately use separately committed transactions: xmin, row contention and
// self-FK DELETE lock order cannot be proved by a single rollback transaction or a mock.
async function concurrentFixture(fn: (a: Client, b: Client, control: Client, ws: string) => Promise<void>) {
  const clients: Client[] = [];
  for (let n = 0; n < 3; n++) clients.push(await connection());
  const [a, b, control] = clients;
  const ws = "test-manual183-" + crypto.randomUUID();
  try {
    await setup(control, ws);
    for (const client of clients) {
      await client.queryArray("set statement_timeout='3s'");
      await client.queryArray("set role service_role");
    }
    await fn(a, b, control, ws);
  } finally {
    // All started request promises must settle before connections/fixtures are removed.
    for (const client of clients) await client.queryArray("rollback");
    await control.queryArray("delete from meetings where group_id=$1", [ws]);
    await control.queryArray("reset role");
    await control.queryArray("delete from entries where group_id=$1", [ws]);
    await control.queryArray("delete from manual_meeting_pair_decisions where home_group_id=$1", [ws]);
    await control.queryArray("delete from allowed_users where group_id=$1", [ws]);
    await control.queryArray("delete from workspaces where id=$1", [ws]);
    await Promise.all(clients.map((client) => client.end()));
  }
}

Deno.test("two concurrent Yes requests produce one atomic association; retries retain its receipt", () =>
  concurrentFixture(async (a, b, control, ws) => {
    const source = await meeting(control, ws);
    const target = await published(control, ws);
    const ctx = await snapshot(control, source, target);
    const results = await Promise.allSettled([
      decide(a, ws, source, target, { expected: ctx.versions }),
      decide(b, ws, source, target, { expected: ctx.versions }),
    ]);
    assertEquals(results.some((r) => r.status === "fulfilled"), true);
    for (const result of results) {
      if (result.status === "rejected") assertEquals(result.reason.fields.code, "55P03");
    }
    const receipt = await decide(control, ws, source, target);
    assertEquals(receipt.repeated, true);
    for (const result of results) if (result.status === "fulfilled") assertEquals(result.value.id, receipt.id);
    assertEquals(
      await value(control, "select count(*)::int as value from manual_meeting_pair_decisions where home_group_id=$1", [
        ws,
      ]),
      1,
    );
  }));

Deno.test("a real committed target change invalidates a previously displayed candidate", () =>
  concurrentFixture(async (a, b, control, ws) => {
    const source = await meeting(control, ws);
    const target = await published(control, ws);
    const ctx = await snapshot(a, source, target);
    await b.queryArray("update meetings set title='Changed after proposal' where id=$1::uuid", [target]);
    const error = await assertRejects(() => decide(a, ws, source, target, { expected: ctx.versions }));
    assertEquals((error as { fields: { code: string } }).fields.code, "40001");
    assertEquals(
      await value(control, "select count(*)::int as value from manual_meeting_pair_decisions where home_group_id=$1", [
        ws,
      ]),
      0,
    );
  }));

Deno.test("association yields promptly to an existing target DELETE lock instead of deadlocking its source FK", () =>
  concurrentFixture(async (merge, deleting, control, ws) => {
    // Child UUID sorts before target: old sorted blocking locks inverted the self-FK DELETE.
    const child = await meeting(control, ws, { id: "00000000-0000-4000-8000-000000001831" });
    const target = await published(control, ws, { id: "00000000-0000-4000-8000-000000001832" });
    const source = await meeting(control, ws, { id: "00000000-0000-4000-8000-000000001833" });
    const oldReceipt = await decide(control, ws, child, target);
    const sourceBefore = await row(control, source);
    const childBefore = await row(control, child);
    await deleting.queryArray("begin");
    await deleting.queryArray("select id from meetings where id=$1::uuid for update", [target]);
    const mergePid = await value<number>(merge, "select pg_backend_pid() as value");
    const deletingPid = await value<number>(deleting, "select pg_backend_pid() as value");
    let observed: { code: string } | null = null;
    const pending = decide(merge, ws, source, target).then(
      () => observed = { code: "SUCCESS" },
      (error) => observed = { code: String(error.fields?.code ?? "UNKNOWN") },
    );
    let initial = { code: "UNSETTLED" };
    try {
      const deadline = performance.now() + 2000;
      while (performance.now() < deadline) {
        if (observed) {
          initial = observed;
          break;
        }
        const blockers = await value<number[]>(control, "select pg_blocking_pids($1) as value", [mergePid]);
        if (blockers.includes(deletingPid)) {
          initial = { code: "BLOCKED" };
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await deleting.queryArray("delete from meetings where id=$1::uuid", [target]);
      await deleting.queryArray("commit");
    } finally {
      await deleting.queryArray("rollback");
      await pending;
    }
    assertEquals(initial.code, "55P03");
    assertEquals(await row(control, source), sourceBefore);
    const childAfter = await row(control, child);
    assertEquals(childAfter.manual_merge_target_id, null);
    for (const field of ["id", "transcript", "recorders", "claim_owner", "draft_notes_md", "started_at"]) {
      assertEquals(childAfter[field], childBefore[field]);
    }
    assertEquals(
      await value(control, "select active as value from manual_meeting_pair_decisions where id=$1::uuid", [
        oldReceipt.id,
      ]),
      false,
    );
  }));
