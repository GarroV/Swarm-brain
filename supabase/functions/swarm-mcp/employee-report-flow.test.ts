import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { sha256 } from "../_shared/mcp-oauth/rules.ts";

Deno.env.set("SUPABASE_URL", "https://report-flow.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-not-a-secret");

// Capture the production Request handler without opening a local server or port.
let handler: (request: Request) => Promise<Response>;
const originalServe = Deno.serve;
const importFetch = globalThis.fetch;
// Usage telemetry captures fetch on import; keep it inside the same synthetic fixture.
globalThis.fetch = (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assertEquals(url.host, "report-flow.invalid");
  assert(url.pathname.endsWith("/model_usage"));
  return Promise.resolve(new Response(null, { status: 201 }));
};
Deno.serve = ((callback: (request: Request) => Promise<Response>) => {
  handler = callback;
  return {};
}) as typeof Deno.serve;
try {
  await import("./index.ts");
} finally {
  Deno.serve = originalServe;
  globalThis.fetch = importFetch;
}

Deno.test("MCP report flow: token roles, discovery, direct calls, spoof rejection, private save", async () => {
  const originalFetch = globalThis.fetch;
  const tokens = { admin: "smcp_fixture_admin", member: "smcp_fixture_member" };
  const hashes = { admin: await sha256(tokens.admin), member: await sha256(tokens.member) };
  const saved: Array<Record<string, unknown>> = [];
  const taskReads: string[] = [];
  const unexpected: string[] = [];
  let adminRole = true;
  globalThis.fetch = async (input, init) => {
    const requestBody = init?.body == null ? null : await new Response(init.body).text();
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (url.host === "api.openai.com") {
      return url.pathname.endsWith("embeddings")
        ? Response.json({ data: [{ embedding: [0.1, 0.2] }] })
        : Response.json({
          choices: [{ message: { content: '{"countries":[],"entry_type":"note","entry_date":null}' } }],
        });
    }
    if (url.host !== "report-flow.invalid") unexpected.push(url.host);
    assertEquals(url.host, "report-flow.invalid");
    const table = url.pathname.split("/").at(-1);
    if (table === "mcp_oauth_take_rate") return Response.json(true);
    if (table === "allowed_users" && method === "PATCH") return new Response(null, { status: 204 });
    if ((table === "mcp_tool_journal" || table === "ai_key_health") && method === "POST") {
      return new Response(null, { status: 201 });
    }
    if (table === "entries" && method === "POST") {
      saved.push(JSON.parse(requestBody!));
      return new Response(null, { status: 201 });
    }
    assertEquals(method, "GET");
    let rows: unknown[] = [];
    if (table === "allowed_users") {
      const select = url.searchParams.get("select") ?? "";
      const id = url.searchParams.get("telegram_id") === "eq.2" ? 2 : 1;
      if (select.includes("claude_mcp_token_hash")) {
        const admin = (url.searchParams.get("or") ?? "").includes(hashes.admin);
        rows = [{
          telegram_id: admin ? 1 : 2,
          claude_mcp_token_hash: admin ? hashes.admin : hashes.member,
          chatgpt_mcp_token_hash: null,
          claude_mcp_token_expires_at: "2099-01-01T00:00:00Z",
        }];
      } else if (select === "group_id,is_admin") rows = [{ group_id: "fixture", is_admin: id === 1 && adminRole }];
      else if (select === "group_id") rows = [{ group_id: "fixture" }];
      else rows = [{ telegram_id: 3, username: "fixture-person" }];
    } else if (table === "user_profiles") rows = [{ telegram_id: 3, first_name: "Fixture", last_name: "Person" }];
    else if (table === "master_admins" || table === "projects" || table === "task_history") rows = [];
    else if (table === "tasks") {
      taskReads.push(url.search);
      rows = [{
        id: "fixture-task",
        status: "done",
        project_id: null,
        assignee_telegram_ids: [3],
        created_at: "2026-10-20T00:00:00Z",
        completed_at: "2026-10-21T00:00:00Z",
        due_date: "2026-10-22",
      }];
    } else if (table === "workspace_secrets" || table === "ai_key_health") rows = [];
    else {
      unexpected.push(String(table));
      throw new Error(`Unexpected fixture request ${table}`);
    }
    return Response.json(rows, { headers: { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` } });
  };
  async function rpc(role: keyof typeof tokens, method: string, params?: Record<string, unknown>) {
    const response = await handler(
      new Request("https://swarm-fixture.invalid/mcp", {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens[role]}`, "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
    assertEquals(response.status, 200);
    return await response.json();
  }
  try {
    const adminTools = (await rpc("admin", "tools/list")).result.tools.map((t: { name: string }) => t.name);
    const memberTools = (await rpc("member", "tools/list")).result.tools.map((t: { name: string }) => t.name);
    for (const tool of ["get_employee_report", "get_task_stats"]) {
      assert(adminTools.includes(tool));
      assert(!memberTools.includes(tool));
    }
    const reportArgs = { date_from: "2026-10-19", date_to: "2026-10-25", employee_id: 3 };
    const report = await rpc("admin", "tools/call", { name: "get_employee_report", arguments: reportArgs });
    assertStringIncludes(JSON.stringify(report.result), "создано 1; закрыто 1");
    assertEquals(saved.length, 0);
    const reads = taskReads.length;
    const denied = await rpc("member", "tools/call", { name: "get_employee_report", arguments: reportArgs });
    assertStringIncludes(JSON.stringify(denied.result), "только администраторам");
    assertEquals(taskReads.length, reads);
    const spoofed = await rpc("member", "tools/call", {
      name: "get_employee_report",
      arguments: { ...reportArgs, requesting_user_id: 1 },
    });
    assert(spoofed.error);
    assertEquals(taskReads.length, reads);
    // Exercise the actual persistence dispatch with deterministic enrichment responses.
    await rpc("admin", "tools/call", {
      name: "add_knowledge",
      arguments: { source: "claude-weekly-tracker", summary: "SWARM-REPORT-SNAPSHOT | fixture", is_private: false },
    });
    assertEquals(saved.length, 1);
    assertEquals(saved[0].is_private, true);
    assertEquals(saved[0].owner_id, 1);
    adminRole = false;
    const revoked = await rpc("admin", "tools/call", { name: "get_employee_report", arguments: reportArgs });
    assertStringIncludes(JSON.stringify(revoked.result), "только администраторам");
    assertEquals(taskReads.length, reads);
    assertEquals(unexpected, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
