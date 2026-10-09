import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { feedLimit, loadNotificationFeed, markNotificationsRead } from "./feed.ts";

type Call = [string, ...unknown[]];

/** Подделка PostgREST-цепочки: пишет вызовы, отдаёт заранее заданный ответ. */
function fakeDb(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "order", "limit", "update"]) {
    builder[m] = (...a: unknown[]) => {
      calls.push([m, ...a]);
      return builder;
    };
  }
  builder.then = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
  const db = {
    from: (t: string) => {
      calls.push(["from", t]);
      return builder;
    },
  };
  return { db: db as never, calls };
}

const row = (id: string, type: string, hasTask: boolean) => ({
  id,
  type,
  task_id: hasTask ? `t-${id}` : null,
  comment_id: null,
  actor_telegram_id: 5,
  read_at: null,
  created_at: "2026-10-02T03:00:00Z",
  payload: null,
  tasks: hasTask ? { title: id } : null,
  task_comments: null,
});

const ROWS = [
  row("task", "comment", true),
  row("colleague-task", "comment", true),
  row("system", "maintenance", false),
  row("orphan", "comment", false),
];

Deno.test("лента: строка без задачи выпадает, задачи и системные остаются", async () => {
  const { db, calls } = fakeDb({ data: ROWS, error: null });
  const r = await loadNotificationFeed(db, 1, 30);
  assertEquals(r.ok && r.rows.map((x) => x.id), ["task", "colleague-task", "system"]);
  assertEquals(calls.find((c) => c[0] === "eq"), ["eq", "recipient_telegram_id", 1]);
  assertEquals(calls.find((c) => c[0] === "limit"), ["limit", 30]);
});

Deno.test("лента: ошибка чтения не превращается в пустую ленту", async () => {
  const { db } = fakeDb({ data: null, error: { message: "boom" } });
  const r = await loadNotificationFeed(db, 1, 30);
  assertEquals(r.ok, false);
});

Deno.test("прочитано: только свои и только непрочитанные, по списку id", async () => {
  const { db, calls } = fakeDb({ data: null, error: null });
  const r = await markNotificationsRead(db, 7, ["a", "b"]);
  assertEquals(r.ok, true);
  assertEquals(calls.filter((c) => c[0] !== "update" && c[0] !== "from"), [
    ["eq", "recipient_telegram_id", 7],
    ["is", "read_at", null],
    ["in", "id", ["a", "b"]],
  ]);
});

Deno.test("прочитано: без id — все свои; пустой список — в базу не ходим", async () => {
  const all = fakeDb({ data: null, error: null });
  await markNotificationsRead(all.db, 7, null);
  assertEquals(all.calls.some((c) => c[0] === "in"), false);
  assertEquals(all.calls.some((c) => c[0] === "eq" && c[1] === "recipient_telegram_id" && c[2] === 7), true);
  const none = fakeDb({ data: null, error: null });
  await markNotificationsRead(none.db, 7, []);
  assertEquals(none.calls, []);
});

Deno.test("прочитано: ошибка записи отдаётся наверх", async () => {
  const { db } = fakeDb({ data: null, error: { message: "boom" } });
  assertEquals((await markNotificationsRead(db, 7, null)).ok, false);
});

Deno.test("лимит: дефолт, границы и мусор", () => {
  assertEquals(feedLimit(undefined), 30);
  assertEquals(feedLimit(null), 30);
  assertEquals(feedLimit("abc"), 30);
  assertEquals(feedLimit("10"), 10);
  assertEquals(feedLimit(0), 1);
  assertEquals(feedLimit(500), 100);
  assertEquals(feedLimit(12.7), 12);
});
