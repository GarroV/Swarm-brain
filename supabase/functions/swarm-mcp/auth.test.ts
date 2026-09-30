import { assertEquals } from "jsr:@std/assert@1";
import {
  AUTH_ERROR_CODE,
  authorizeToolCall,
  NO_WORKSPACE_MESSAGE,
  resolveCallerScope,
  UNAUTHORIZED_MESSAGE,
  withCallerIdentity,
} from "./auth.ts";

const CALLER = 111;
const OTHER = 222;

Deno.test("tools/call without a token is rejected", () => {
  const res = authorizeToolCall({
    toolName: "search_knowledge",
    verifiedTelegramId: null,
    tokenError: null,
    groupId: null,
  });
  assertEquals(res, { ok: false, code: AUTH_ERROR_CODE, message: UNAUTHORIZED_MESSAGE });
});

Deno.test("tools/call without a token is rejected even for whoami", () => {
  const res = authorizeToolCall({ toolName: "whoami", verifiedTelegramId: null, tokenError: null, groupId: null });
  assertEquals(res.ok, false);
});

Deno.test("invalid or expired token is rejected with its own message", () => {
  const res = authorizeToolCall({
    toolName: "get_tasks",
    verifiedTelegramId: null,
    tokenError: "Token expired",
    groupId: null,
  });
  assertEquals(res, { ok: false, code: AUTH_ERROR_CODE, message: "Token expired" });
});

Deno.test("valid token passes with identity and workspace from the token", () => {
  const res = authorizeToolCall({
    toolName: "get_tasks",
    verifiedTelegramId: CALLER,
    tokenError: null,
    groupId: "ws1",
  });
  assertEquals(res, { ok: true, telegramId: CALLER, groupId: "ws1" });
});

Deno.test("valid token without a workspace is denied, not widened to all workspaces", () => {
  for (const groupId of [null, ""]) {
    const res = authorizeToolCall({ toolName: "list_entries", verifiedTelegramId: CALLER, tokenError: null, groupId });
    assertEquals(res, { ok: false, code: AUTH_ERROR_CODE, message: NO_WORKSPACE_MESSAGE });
  }
});

Deno.test("whoami works without a workspace (reads only the caller's own row)", () => {
  const res = authorizeToolCall({ toolName: "whoami", verifiedTelegramId: CALLER, tokenError: null, groupId: null });
  assertEquals(res, { ok: true, telegramId: CALLER, groupId: null });
});

Deno.test("identity fields in arguments are overwritten by the token identity", () => {
  const args = { query: "x", requesting_user_id: OTHER, owner_telegram_id: OTHER };
  const forced = withCallerIdentity(args, CALLER);
  assertEquals(forced, { query: "x", requesting_user_id: CALLER, owner_telegram_id: CALLER });
});

Deno.test("identity is set even when the client did not send it", () => {
  const forced = withCallerIdentity({ query: "x" }, CALLER);
  assertEquals(forced.requesting_user_id, CALLER);
});

Deno.test("source arguments are not mutated", () => {
  const args = { requesting_user_id: OTHER };
  withCallerIdentity(args, CALLER);
  assertEquals(args.requesting_user_id, OTHER);
});

Deno.test("caller scope: no identity → null, lookup is not even asked", async () => {
  let asked = false;
  const lookup = (_id: number) => {
    asked = true;
    return Promise.resolve("ws1");
  };
  assertEquals(await resolveCallerScope(undefined, lookup), null);
  assertEquals(await resolveCallerScope(null, lookup), null);
  assertEquals(asked, false);
});

Deno.test("caller scope: user without workspace → null", async () => {
  assertEquals(await resolveCallerScope(CALLER, () => Promise.resolve(null)), null);
  assertEquals(await resolveCallerScope(CALLER, () => Promise.resolve("")), null);
});

Deno.test("caller scope: user with workspace → user and workspace", async () => {
  assertEquals(await resolveCallerScope(CALLER, () => Promise.resolve("ws1")), { userId: CALLER, groupId: "ws1" });
});
