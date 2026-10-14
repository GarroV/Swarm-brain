import { assert, assertEquals } from "jsr:@std/assert@1";
import { annotationsFor, isUntrustedResult, TOOL_CLASSES, withAnnotations } from "./annotations.ts";
import { negotiateProtocolVersion, SERVER_INSTRUCTIONS } from "./protocol.ts";

// tool-definitions.ts тянет модули с клиентом базы, которому нужны переменные окружения при импорте.
Deno.env.set("SUPABASE_URL", Deno.env.get("SUPABASE_URL") ?? "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "test-key");
const { TOOLS } = await import("./tool-definitions.ts");

Deno.test("every tool in tools/list is classified (a new tool cannot ship unclassified)", () => {
  const missing = TOOLS.map((t) => t.name).filter((n) => !annotationsFor(n));
  assertEquals(missing, [], `Add these tools to TOOL_CLASSES in swarm-mcp/annotations.ts: ${missing.join(", ")}`);
});

Deno.test("the classification map has no entries for tools that do not exist", () => {
  const names = new Set(TOOLS.map((t) => t.name));
  const stale = Object.keys(TOOL_CLASSES).filter((n) => !names.has(n));
  assertEquals(stale, [], `Remove from TOOL_CLASSES: ${stale.join(", ")}`);
});

Deno.test("tool names are unique", () => {
  const names = TOOLS.map((t) => t.name);
  assertEquals(names.length, new Set(names).size);
});

Deno.test("delete / remove / archive tools are destructive", () => {
  const risky = TOOLS.map((t) => t.name).filter((n) => /delete|remove|archive/.test(n));
  assert(risky.length > 0);
  for (const n of risky) assertEquals(annotationsFor(n)?.destructiveHint, true, `${n} must be destructive`);
});

Deno.test("annotations are internally consistent: read-only is never destructive, no open world", () => {
  for (const t of TOOLS) {
    const a = annotationsFor(t.name)!;
    assert(!(a.readOnlyHint && a.destructiveHint), `${t.name}: readOnly and destructive at once`);
    assertEquals(a.openWorldHint, false);
  }
});

Deno.test("read-only tools by name pattern really are read-only", () => {
  const reads = TOOLS.map((t) => t.name).filter((n) => /^(get_|search_|list_)/.test(n) || n === "whoami");
  for (const n of reads) assertEquals(annotationsFor(n)?.readOnlyHint, true, `${n} must be read-only`);
});

Deno.test("withAnnotations adds annotations; an unknown tool gets the cautious ones", () => {
  const known = withAnnotations({ name: "get_tasks", description: "", inputSchema: {} });
  assertEquals(known.annotations.readOnlyHint, true);
  const unknown = withAnnotations({ name: "brand_new_tool", description: "", inputSchema: {} });
  assertEquals(unknown.annotations.readOnlyHint, false);
  assertEquals(unknown.annotations.destructiveHint, true);
});

Deno.test("tools that return people's text are wrapped, write confirmations are not", () => {
  for (const n of ["get_meetings", "get_entry", "search_knowledge", "get_task_comments", "get_draft_meeting"]) {
    assert(isUntrustedResult(n), `${n} must be wrapped`);
  }
  for (const n of ["whoami", "add_task", "delete_entry", "market_set_block", "unknown_tool"]) {
    assert(!isUntrustedResult(n), `${n} must not be wrapped`);
  }
  for (const t of TOOLS) {
    if (isUntrustedResult(t.name)) assertEquals(annotationsFor(t.name)?.readOnlyHint, true, `${t.name}`);
  }
});

Deno.test("negotiateProtocolVersion echoes known versions, falls back to 2025-03-26", () => {
  for (const v of ["2025-06-18", "2025-03-26", "2024-11-05"]) assertEquals(negotiateProtocolVersion(v), v);
  for (const v of ["2099-01-01", "", undefined, null, 5]) assertEquals(negotiateProtocolVersion(v), "2025-03-26");
});

Deno.test("server instructions stay short and name the markers", () => {
  assert(SERVER_INSTRUCTIONS.length <= 900, `length ${SERVER_INSTRUCTIONS.length}`);
  assert(SERVER_INSTRUCTIONS.includes("untrusted_data"));
});
