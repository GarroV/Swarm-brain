// Присутствие (#751): админский GET видит только админ, состояние считает сервер, полоска анонимна.
import { assertEquals } from "@std/assert";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { derivePseudonymKey } from "./presence-pseudonyms.ts";
import { buildStrip, handlePresenceRoutes, isOnline, parseLogMinutes, parsePing } from "./presence.ts";

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

Deno.test("в системе: пульс свежее 45 с и вкладка не скрыта", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  assertEquals(isOnline({ state: "idle", last_seen_at: "2026-10-09T11:59:30Z" }, now), true);
  assertEquals(isOnline({ state: "away", last_seen_at: "2026-10-09T11:59:50Z" }, now), false);
  assertEquals(isOnline({ state: "active", last_seen_at: "2026-10-09T11:59:00Z" }, now), false);
});

// ── Полоска /presence/strip ────────────────────────────────────────────────────────────────
const KEY = await derivePseudonymKey("test-secret");
const NOW = Date.parse("2026-10-15T12:00:00Z");
const MEMBERS = [101_234_567, 202_345_678, 303_456_789, 404_567_890];
const fresh = "2026-10-15T11:59:50Z";

Deno.test("полоска: себя нет, ушедших и протухших нет, чужой воркспейс не показывается", async () => {
  const strip = await buildStrip(
    KEY,
    MEMBERS,
    [
      { telegram_id: MEMBERS[0], section: "tasks", state: "active", last_seen_at: fresh },
      { telegram_id: MEMBERS[1], section: "meetings", state: "idle", last_seen_at: fresh },
      { telegram_id: MEMBERS[2], section: "home", state: "away", last_seen_at: fresh },
      { telegram_id: MEMBERS[3], section: "home", state: "active", last_seen_at: "2026-10-15T11:58:00Z" },
      { telegram_id: 999, section: "home", state: "active", last_seen_at: fresh },
    ],
    MEMBERS[0],
    NOW,
  );
  assertEquals(strip.people.length, 1);
  assertEquals(strip.people[0].section, "meetings");
  assertEquals(strip.people[0].state, "idle");
});

Deno.test("полоска: активные первыми, зверь и стиль не меняются между вызовами", async () => {
  const rows = [
    { telegram_id: MEMBERS[1], section: "a", state: "idle" as const, last_seen_at: fresh },
    { telegram_id: MEMBERS[2], section: "b", state: "active" as const, last_seen_at: fresh },
  ];
  const a = await buildStrip(KEY, MEMBERS, rows, MEMBERS[0], NOW);
  const b = await buildStrip(KEY, MEMBERS, [...rows].reverse(), MEMBERS[0], NOW);
  assertEquals(a, b);
  assertEquals(a.people.map((p) => p.state), ["active", "idle"]);
});

Deno.test("полоска: ответ не содержит telegram_id, имён и e-mail (детектор приватности)", async () => {
  const rows = MEMBERS.map((id) => ({
    telegram_id: id,
    section: "tasks/mine/today",
    state: "active",
    last_seen_at: fresh,
  }));
  const supabase = {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const data = table === "presence"
        ? rows
        : MEMBERS.map((telegram_id) => ({ telegram_id, email: "x@y.z", name: "Иван" }));
      for (const m of ["select", "eq", "gte", "neq", "not"]) chain[m] = () => chain;
      chain.then = (ok: (v: unknown) => unknown) => ok({ data, error: null });
      return chain;
    },
  } as unknown as SupabaseClient;
  const res = await handlePresenceRoutes(
    supabase,
    new Request("https://x/presence/strip"),
    "/presence/strip",
    { ...ctx, telegramId: MEMBERS[0], pseudonymSecret: "test-secret" },
    "",
  );
  assertEquals(res?.status, 200);
  const text = await res!.text();
  for (const id of MEMBERS) assertEquals(text.includes(String(id)), false, `id ${id} в ответе`);
  for (const bad of ["telegram_id", "email", "name", "x@y.z", "Иван"]) {
    assertEquals(text.includes(bad), false, `«${bad}» в ответе`);
  }
  const body = JSON.parse(text) as { window: number; people: Record<string, unknown>[] };
  assertEquals(body.people.length, 3);
  for (const p of body.people) assertEquals(Object.keys(p).sort(), ["animal", "key", "section", "state", "style"]);
});

Deno.test("полоска: демо — пустой список без базы; не GET — 405", async () => {
  const demo = await handlePresenceRoutes(NO_DB, new Request("https://x/presence/strip"), "/presence/strip", {
    ...ctx,
    isDemo: true,
  }, "");
  assertEquals(demo?.status, 200);
  assertEquals((await demo!.json()).people, []);
  const post = await handlePresenceRoutes(
    NO_DB,
    new Request("https://x/presence/strip", { method: "POST" }),
    "/presence/strip",
    ctx,
    "",
  );
  assertEquals(post?.status, 405);
});

Deno.test("полоска: нет серверного секрета — 500, а не раздача без ключа; база не читается", async () => {
  const res = await handlePresenceRoutes(NO_DB, new Request("https://x/presence/strip"), "/presence/strip", ctx, "");
  assertEquals(res?.status, 500);
});
