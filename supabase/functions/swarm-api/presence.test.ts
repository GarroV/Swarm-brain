// Присутствие (#751): видно только админу, состояние считает сервер.
import { assertEquals } from "@std/assert";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePresenceRoutes, isOnline, parseLogMinutes, parsePing } from "./presence.ts";

const NO_DB = new Proxy({}, {
  get() {
    throw new Error("база не должна трогаться");
  },
}) as unknown as SupabaseClient;

const ctx = { telegramId: 1, groupId: "ws", isAdmin: false, isSuperadmin: false, isDemo: false };

Deno.test("GET /presence не админу — 403, база не читается", async () => {
  const res = await handlePresenceRoutes(
    NO_DB,
    new Request("https://x/presence"),
    "/presence",
    ctx,
    "",
  );
  assertEquals(res?.status, 403);
});

Deno.test("демо-пульс не пишется в базу", async () => {
  const res = await handlePresenceRoutes(
    NO_DB,
    new Request("https://x/presence", {
      method: "POST",
      body: JSON.stringify({ section: "tasks", active: true }),
    }),
    "/presence",
    { ...ctx, isDemo: true },
    "",
  );
  assertEquals(res?.status, 204);
});

Deno.test("состояние: away важнее active, без ввода — idle", () => {
  assertEquals(parsePing({ section: "tasks", active: true, away: true }), { section: "tasks", state: "away" });
  assertEquals(parsePing({ section: "tasks", active: true }), { section: "tasks", state: "active" });
  assertEquals(parsePing({ section: "tasks/mine/today", active: false }), {
    section: "tasks/mine/today",
    state: "idle",
  });
});

Deno.test("раздел: только короткий путь из [a-z0-9_-/]", () => {
  assertEquals(typeof parsePing({ section: "Tasks" }), "string");
  assertEquals(typeof parsePing({ section: "x".repeat(41) }), "string");
  assertEquals(typeof parsePing({ section: "<script>" }), "string");
  assertEquals(typeof parsePing({ section: "tasks", active: "yes" }), "string");
});

Deno.test("окно журнала: 1…1440 минут, мусор — 60", () => {
  assertEquals(parseLogMinutes(null), 60);
  assertEquals(parseLogMinutes("abc"), 60);
  assertEquals(parseLogMinutes("0"), 60);
  assertEquals(parseLogMinutes("99999"), 1440);
  assertEquals(parseLogMinutes("15"), 15);
});

Deno.test("в системе: пульс свежее 90 с и вкладка не скрыта", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  assertEquals(isOnline({ state: "idle", last_seen_at: "2026-10-09T11:59:00Z" }, now), true);
  assertEquals(isOnline({ state: "away", last_seen_at: "2026-10-09T11:59:50Z" }, now), false);
  assertEquals(isOnline({ state: "active", last_seen_at: "2026-10-09T11:58:00Z" }, now), false);
});
