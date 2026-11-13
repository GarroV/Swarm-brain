import { assertEquals, assertRejects } from "@std/assert";
import { Client } from "postgres";
const url = Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

Deno.test("meeting facets: complete totals beyond 200, exact privacy/workspace/live/confirmed partition and invoker role", async () => {
  assertEquals(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname), true);
  const db = new Client(url);
  await db.connect();
  try {
    await db.queryArray("begin");
    await db.queryArray(
      "insert into public.workspaces(id,name) values ('qa-facets-104','QA facets'),('qa-foreign-104','QA foreign')",
    );
    await db.queryArray(
      `insert into public.entries(content,summary,entry_type,source,added_by,group_id,metadata,countries,owner_id,is_private)
      select 'Synthetic meeting '||n,'Synthetic','meeting','granola','Fixture Human','qa-facets-104',
      '{"confirmed":true}'::jsonb, array['RS','BG'],990104001,false from generate_series(1,235) n`,
    );
    await db.queryArray(
      `insert into public.entries(content,entry_type,source,added_by,group_id,metadata,countries,owner_id,is_private,shared_with,archived_at) values
      ('Own private','meeting','read_ai','read_ai','qa-facets-104','{"confirmed":true}',array['RS'],990104001,true,'{}',null),
      ('Shared private','meeting','read_ai','read_ai','qa-facets-104','{"confirmed":true}',array['RS'],990104002,true,'{990104001}',null),
      ('Other private','meeting','read_ai','read_ai','qa-facets-104','{"confirmed":true}',array['RS'],990104002,true,'{}',null),
      ('Pending','meeting','read_ai','read_ai','qa-facets-104','{}',array['RS'],990104001,false,'{}',null),
      ('Archived','meeting','read_ai','read_ai','qa-facets-104','{"confirmed":true}',array['RS'],990104001,false,'{}',now()),
      ('Not a meeting','note','read_ai','read_ai','qa-facets-104','{"confirmed":true}',array['RS'],990104001,false,'{}',null),
      ('Foreign','meeting','read_ai','read_ai','qa-foreign-104','{"confirmed":true}',array['RS'],990104001,false,'{}',null)`,
    );
    const run = async (group = "qa-facets-104") => {
      await db.queryArray("savepoint invoker_call");
      try {
        await db.queryArray("set local role service_role");
        const r = await db.queryObject<
          { value: { total: number; countries: [string, number][]; sources: unknown[]; authors: unknown[] } }
        >`
          select public.get_meeting_facets(${group},990104001) as value`;
        await db.queryArray("reset role");
        await db.queryArray("release savepoint invoker_call");
        return r.rows[0].value;
      } catch (e) {
        await db.queryArray("rollback to savepoint invoker_call");
        await db.queryArray("release savepoint invoker_call");
        throw e;
      }
    };
    const r = await run();
    assertEquals(r.total, 237);
    assertEquals(Object.fromEntries(r.countries), { RS: 237, BG: 235 });
    assertEquals((await run("missing-facets-104")).total, 0);
    await db.queryArray("savepoint anonymous_call");
    await db.queryArray("set local role anon");
    await assertRejects(
      () => db.queryArray("select public.get_meeting_facets('qa-facets-104',990104001)"),
      Error,
      "permission denied",
    );
    await db.queryArray("rollback to savepoint anonymous_call");
  } finally {
    await db.queryArray("rollback");
    await db.end();
  }
});
