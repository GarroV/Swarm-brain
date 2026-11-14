import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { deleteDraftMeetingAsCaller, deleteDraftMeetingTool } from "./meeting-delete.ts";
import { annotationsFor, toolKind } from "./annotations.ts";
import { CONFIRM_TOKEN_ARGUMENT, decideConfirmation, withConfirmationArgument } from "./confirm.ts";
import { MEETING_REVIEW_TOOL_DEFINITIONS } from "./meetings-defs.ts";
import { withCallerIdentity } from "./auth.ts";

const id = "00000000-0000-4000-8000-000000001168";
const name = "delete_draft_meeting";
Deno.test("delete_draft_meeting: registered as destructive/idempotent with the existing confirmation schema", () => {
  const definition = MEETING_REVIEW_TOOL_DEFINITIONS.find((d) => d.name === name);
  assert(definition);
  assertEquals(toolKind(name), "destructive");
  assertEquals(annotationsFor(name)?.idempotentHint, true);
  assert(CONFIRM_TOKEN_ARGUMENT in withConfirmationArgument(definition).inputSchema.properties);
});

Deno.test("delete_draft_meeting: confirmation precedes mutation and binds the authenticated actor and exact id", async () => {
  let calls = 0;
  const args = withCallerIdentity({ meeting_id: id, requesting_user_id: 999 }, 1168);
  const base = { secret: "synthetic-confirmation-fixture-only", telegramId: 1168, tool: name, nowSec: 1000 };
  const invoke = async (input: Record<string, unknown>) => {
    const decision = await decideConfirmation({ ...base, args: input });
    if (decision.action !== "execute") return decision;
    const result = await deleteDraftMeetingTool(decision.args as { meeting_id: string; requesting_user_id: number }, {
      remove(meetingId, callerId) {
        assertEquals(meetingId, id);
        assertEquals(callerId, 1168);
        calls++;
        return Promise.resolve({ ok: true });
      },
    });
    return result;
  };
  const challenge = await invoke(args);
  assert(typeof challenge !== "string" && challenge.action === "challenge");
  assertEquals(calls, 0);
  const changed = await invoke({
    ...args,
    meeting_id: id.replace("1168", "1169"),
    [CONFIRM_TOKEN_ARGUMENT]: challenge.token,
  });
  assert(typeof changed !== "string" && changed.action === "refuse");
  assertEquals(calls, 0);
  assertStringIncludes(await invoke({ ...args, [CONFIRM_TOKEN_ARGUMENT]: challenge.token }) as string, "✅");
  assertEquals(calls, 1);
});

Deno.test("delete_draft_meeting: missing identity never calls deletion", async () => {
  let calls = 0;
  assertStringIncludes(
    await deleteDraftMeetingTool({ meeting_id: id }, {
      remove: () => {
        calls++;
        return Promise.resolve({ ok: true });
      },
    }),
    "Ошибка",
  );
  assertEquals(calls, 0);
});

Deno.test("delete_draft_meeting: partial cleanup never reports successful deletion", async () => {
  const text = await deleteDraftMeetingTool({ meeting_id: id, requesting_user_id: 1168 }, {
    remove: () => Promise.resolve({ ok: false, reason: "storage" }),
  });
  assertEquals(text.includes("✅"), false);
  assertStringIncludes(text, "не завершено");
  assertStringIncludes(text, "meeting_id");
});

for (
  const [workspaceAdmin, master, expected] of [[true, false, true], [false, false, false], [false, true, true]] as const
) {
  Deno.test(`delete_draft_meeting actual adapter: workspace admin=${workspaceAdmin}, master=${master}`, async () => {
    const filters: unknown[] = [];
    const sb = {
      from(table: string) {
        assertEquals(table, "allowed_users");
        const query = {
          select(columns: string) {
            assertEquals(columns, "email,is_admin");
            return query;
          },
          eq(key: string, value: unknown) {
            filters.push([key, value]);
            return query;
          },
          maybeSingle() {
            return Promise.resolve({
              data: { email: "fictional@example.invalid", is_admin: workspaceAdmin },
              error: null,
            });
          },
        };
        return query;
      },
    } as unknown as import("https://esm.sh/@supabase/supabase-js@2").SupabaseClient;
    let called = 0;
    const result = await deleteDraftMeetingAsCaller(sb, id, 1168, "fixture-home", master, (_sb, meetingId, caller) => {
      assertEquals(meetingId, id);
      assertEquals(caller, {
        telegramId: 1168,
        groupId: "fixture-home",
        isAdmin: expected,
        email: "fictional@example.invalid",
      });
      called++;
      return Promise.resolve({ ok: true });
    });
    assertEquals(filters, [["telegram_id", 1168], ["group_id", "fixture-home"]]);
    assertEquals(called, 1);
    assertEquals(result, { ok: true });
  });
}
