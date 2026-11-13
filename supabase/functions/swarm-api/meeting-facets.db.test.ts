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
    const run = async (group = "qa-facets-104", email: string | null = null) => {
      await db.queryArray("savepoint invoker_call");
      try {
        await db.queryArray("set local role service_role");
        const r = await db.queryObject<
          { value: { total: number; countries: [string, number][]; sources: unknown[]; authors: unknown[] } }
        >`
          select public.get_meeting_facets(${group},990104001,${email}) as value`;
        await db.queryArray("reset role");
        await db.queryArray("release savepoint invoker_call");
        return r.rows[0].value;
      } catch (e) {
        await db.queryArray("rollback to savepoint invoker_call");
        await db.queryArray("release savepoint invoker_call");
        throw e;
      }
    };
    await db.queryArray(
      `insert into public.entries(content,entry_type,source,added_by,group_id,metadata,countries,owner_id,is_private,shared_with) values
      ('Attendee pending','meeting','read_ai','read_ai','qa-facets-104','{"attendees":[{"email":"viewer@example.invalid"}]}',array['RS'],990104002,true,'{}'),
      ('Unrelated public pending','meeting','read_ai','read_ai','qa-facets-104','{}',array['RS'],990104002,false,'{}'),
      ('Shared-only pending','meeting','read_ai','read_ai','qa-facets-104','{}',array['RS'],990104002,true,'{990104001}'),
      ('Attendee-only confirmed','meeting','read_ai','read_ai','qa-facets-104','{"confirmed":true,"attendees":[{"email":"viewer@example.invalid"}]}',array['RS'],990104002,true,'{}'),
      ('Uppercase stored attendee','meeting','read_ai','read_ai','qa-facets-104','{"attendees":[{"email":"VIEWER@EXAMPLE.INVALID"}]}',array['RS'],990104002,true,'{}'),
      ('Visible from second workspace','meeting','read_ai','read_ai','qa-foreign-104','{"confirmed":true}',array['RS'],990104002,false,'{}')`,
    );
    await db.queryArray(
      "update public.entries set visible_group_ids=array['qa-foreign-104','qa-facets-104'] where content='Visible from second workspace'",
    );
    const check = async () => {
      assertEquals((await run()).total, 239, "complete facet total");
      assertEquals((await run("qa-facets-104", " VIEWER@EXAMPLE.INVALID ")).total, 240, "branch parity");
    };
    const r = await run();
    assertEquals(r.total, 239, "complete facet total");
    assertEquals((r as unknown as { includesPending: boolean }).includesPending, true);
    await check();
    assertEquals((await run("qa-facets-104", "bad,email")).total, 239);
    assertEquals(Object.fromEntries(r.countries), { RS: 239, BG: 235 });
    assertEquals((await run("missing-facets-104")).total, 0);
    const migration = await Deno.readTextFile(
      new URL("../../migrations/20261113183000_meeting_facets.sql", import.meta.url),
    );
    const replacement = migration.replace(
      "create function public.get_meeting_facets",
      "create or replace function public.get_meeting_facets",
    );
    for (
      const [name, from, to, expected = "complete facet total"] of [
        ["page-truncated aggregate", "), country_groups as (", "limit 200\n), country_groups as ("],
        ["missing workspace guard", "e.visible_group_ids @> array[p_group]", "true"],
        [
          "missing private guard",
          "(e.is_private = false or e.owner_id = p_viewer or e.shared_with @> array[p_viewer])",
          "true",
        ],
        ["public pending cannot bypass participation", "e.owner_id = p_viewer or (", "true or ("],
        [
          "attendee pending keeps its own guard",
          "coalesce(lower(btrim(p_email)), '') ~",
          "(e.is_private = false or e.owner_id = p_viewer or e.shared_with @> array[p_viewer]) and coalesce(lower(btrim(p_email)), '') ~",
          "branch parity",
        ],
      ]
    ) {
      assertEquals(replacement.split(from).length - 1, 1, `${name}: mutation anchor`);
      await db.queryArray("savepoint negative_control");
      await db.queryArray(replacement.replace(from, to));
      await assertRejects(
        () => check(),
        Error,
        expected,
      );
      await db.queryArray("rollback to savepoint negative_control");
    }

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
