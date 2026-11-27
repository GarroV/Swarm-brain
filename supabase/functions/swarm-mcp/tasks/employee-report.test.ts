import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";

const previousUrl = Deno.env.get("SUPABASE_URL"), previousKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const fixtureUrl = previousUrl ?? "https://report-fixture.invalid";
Deno.env.set("SUPABASE_URL", fixtureUrl);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", previousKey ?? "fixture-not-a-secret");
const [{ toolGetEmployeeReport }, { reportCaller, REPORT_ACCESS_DENIED }, { toolGetTaskStats }] = await Promise.all([
  import("./employee-report.ts"),
  import("./report-access.ts"),
  import("./analytics.ts"),
]).finally(() => {
  if (previousUrl === undefined) Deno.env.delete("SUPABASE_URL");
  else Deno.env.set("SUPABASE_URL", previousUrl);
  if (previousKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", previousKey);
});

interface FixtureOptions {
  admin?: boolean;
  master?: boolean;
  memberGroup?: string | null;
  failTable?: string;
  cap?: boolean;
  truncated?: boolean;
}
async function withDatabase(options: FixtureOptions, run: (requests: URL[]) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];
  globalThis.fetch = (input, init) => {
    assertEquals(init?.method ?? (input instanceof Request ? input.method : "GET"), "GET");
    const url = new URL(input instanceof Request ? input.url : String(input));
    assertEquals(url.host, new URL(fixtureUrl).host);
    requests.push(url);
    const table = url.pathname.split("/").at(-1);
    if (options.failTable === table) {
      return Promise.resolve(Response.json({ message: "fixture read failure" }, { status: 500 }));
    }
    let rows: unknown[] = [];
    if (table === "allowed_users") {
      const select = url.searchParams.get("select");
      if (select === "group_id,is_admin") {
        rows = [{
          group_id: options.memberGroup === undefined ? "fixture" : options.memberGroup,
          is_admin: options.admin ?? true,
        }];
      } else {
        assertEquals(url.searchParams.get("group_id"), select === "telegram_id" ? "eq.fixture" : null);
        rows = [{ telegram_id: 2, username: "fixture-person", email: null }];
      }
    } else if (table === "master_admins") rows = options.master ? [{ telegram_id: 1 }] : [];
    else if (table === "user_profiles") rows = [{ telegram_id: 2, first_name: "Fixture", last_name: "Person" }];
    else if (table === "projects") {
      assertEquals(url.searchParams.get("group_id"), "eq.fixture");
      rows = [{ id: "private-project", parent_id: null, created_by: 99, is_private: true }];
    } else if (table === "tasks") {
      assertEquals(url.searchParams.get("group_id"), "eq.fixture");
      assertEquals(url.searchParams.get("confirmed"), "eq.true");
      assertEquals(url.searchParams.get("archived_at"), "is.null");
      assertStringIncludes(url.searchParams.get("assignee_telegram_ids") ?? "", "2");
      const task = {
        id: "visible-task",
        project_id: null,
        status: "done",
        assignee_telegram_ids: [2],
        created_at: "2026-10-20T00:00:00Z",
        completed_at: "2026-10-21T00:00:00Z",
        due_date: "2026-10-22",
        frozen_at: null,
      };
      rows = options.cap
        ? Array.from({ length: 2001 }, (_, i) => ({ ...task, id: `task-${i}` }))
        : [task, { ...task, id: "hidden-task", project_id: "private-project" }];
    } else if (table === "task_history") {
      assertEquals(url.searchParams.get("task_id"), "in.(visible-task)");
      assertEquals(url.searchParams.get("field"), "eq.due_date");
      assertEquals(url.searchParams.getAll("created_at"), [
        "gte.2026-10-19T00:00:00.000Z",
        "lt.2026-10-26T00:00:00.000Z",
      ]);
    } else throw new Error(`Unexpected table ${table}`);
    // PostgREST returns objects for maybeSingle when the SDK requests that media type.
    const body = table === "allowed_users" && url.searchParams.get("select") === "group_id,is_admin"
      ? rows[0] ?? null
      : rows;
    const count = rows.length + (options.truncated && table === "tasks" ? 1 : 0);
    return Promise.resolve(
      Response.json(body, { headers: { "content-range": `0-${Math.max(rows.length - 1, 0)}/${count}` } }),
    );
  };
  try {
    await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
    assertEquals(Deno.env.get("SUPABASE_URL"), previousUrl);
    assertEquals(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), previousKey);
  }
}

const args = { date_from: "2026-10-19", date_to: "2026-10-25", requesting_user_id: 1, employee_id: 2 };
Deno.test("employee report adapter: workspace admin sees only visible tasks, all operations are reads", async () => {
  await withDatabase({}, async (requests) => {
    const result = await toolGetEmployeeReport(args);
    assertStringIncludes(result, "Fixture Person");
    assertStringIncludes(result, "создано 1; закрыто 1");
    assert(requests.some((r) => r.pathname.endsWith("task_history")));
    assert(!requests.some((r) => r.pathname.endsWith("entries") || r.pathname.includes("storage")));
  });
});

Deno.test("employee report adapter: ordinary members cannot call either report tool", async () => {
  await withDatabase({ admin: false }, async (requests) => {
    assertEquals(await toolGetEmployeeReport(args), REPORT_ACCESS_DENIED);
    assertEquals(await toolGetTaskStats({ requesting_user_id: 1 }), REPORT_ACCESS_DENIED);
    assert(!requests.some((r) => /tasks|projects|user_profiles|task_history/.test(r.pathname)));
  });
});

Deno.test("employee report access: master admin still needs current workspace membership", async () => {
  await withDatabase({ admin: false, master: true }, async () => {
    assertEquals(await reportCaller(1), { userId: 1, groupId: "fixture" });
  });
  await withDatabase({ admin: false, master: true, memberGroup: null }, async () => {
    assertEquals(await reportCaller(1), null);
  });
});

Deno.test("employee report adapter: database errors and task cap fail closed", async () => {
  for (
    const options of [{ failTable: "allowed_users" }, { failTable: "tasks" }, { failTable: "task_history" }, {
      cap: true,
    }, { truncated: true }]
  ) {
    await withDatabase(options, async () => {
      await assertRejects(() => toolGetEmployeeReport(args));
    });
  }
});
