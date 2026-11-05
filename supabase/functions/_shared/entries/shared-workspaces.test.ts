// Признак принадлежности встречи — кто и что проставляет (этап 2 решения о втором пространстве).
// Ядро доступа: ошибка здесь молчит — встреча либо не видна второй команде, либо видна лишним.
import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { attendeeEmails, meetingVisibleGroupIds, visibleGroupIdsForMeeting } from "./shared-workspaces.ts";
import { isEntryVisibleInWorkspace, visibleInWorkspace } from "./workspace.ts";

// ── Чистая часть ─────────────────────────────────────────────────────────────

Deno.test("набор пространств: домашнее ∪ пространства участников, без повторов, отсортировано", () => {
  assertEquals(meetingVisibleGroupIds("world", ["cee", "world", "cee"]), ["cee", "world"]);
  assertEquals(meetingVisibleGroupIds("cee", []), ["cee"]);
});

Deno.test("набор пространств: домашнее есть всегда, даже если участников из него нет", () => {
  assertEquals(meetingVisibleGroupIds("cee", ["world"]), ["cee", "world"]);
});

Deno.test("набор пространств: мусор и кривые слаги в набор не попадают", () => {
  assertEquals(meetingVisibleGroupIds("cee", [null, undefined, "", "a,b", "x}"]), ["cee"]);
});

Deno.test("набор пространств: без домашнего — пусто (запись без пространства не видна нигде)", () => {
  assertEquals(meetingVisibleGroupIds(null, ["world"]), []);
  assertEquals(meetingVisibleGroupIds("", ["world"]), []);
});

Deno.test("e-mail участников: нижний регистр, без пустых, повторов и не-адресов", () => {
  assertEquals(
    attendeeEmails([{ email: " A@X.io " }, { email: "a@x.io" }, { name: "Без почты" }, { email: "nomail" }, null]),
    ["a@x.io"],
  );
  assertEquals(attendeeEmails(undefined), []);
});

Deno.test("видимость строки: домашнее или признак; без колонки — только дома", () => {
  const shared = { group_id: "cee", visible_group_ids: ["cee", "world"] };
  assertEquals(isEntryVisibleInWorkspace(shared, "world"), true);
  assertEquals(isEntryVisibleInWorkspace(shared, "other"), false);
  assertEquals(isEntryVisibleInWorkspace({ group_id: "cee" }, "world"), false);
  assertEquals(isEntryVisibleInWorkspace({ group_id: "cee" }, "cee"), true);
  assertEquals(isEntryVisibleInWorkspace(shared, null), false);
  assertEquals(isEntryVisibleInWorkspace({ group_id: null, visible_group_ids: [] }, ""), false);
});

Deno.test("фильтр выборки: cs по признаку; пустое пространство — пустая выборка", () => {
  const calls: Array<[string, unknown[]]> = [];
  const q = {
    contains: (...a: unknown[]) => (calls.push(["contains", a]), q),
    is: (...a: unknown[]) => (calls.push(["is", a]), q),
  };
  visibleInWorkspace(q, "world");
  visibleInWorkspace(q, "");
  visibleInWorkspace(q, undefined);
  assertEquals(calls, [
    ["contains", ["visible_group_ids", ["world"]]],
    ["is", ["id", null]],
    ["is", ["id", null]],
  ]);
});

// ── Ввод-вывод ───────────────────────────────────────────────────────────────

type Call = { table: string; method: string; args: unknown[] };

/** Построитель-заглушка: каждая таблица отдаёт свой ответ, все вызовы пишутся в `calls`. */
function fakeDb(answers: Record<string, { data: unknown; error: unknown }>) {
  const calls: Call[] = [];
  const updates: Array<{ id: unknown; patch: unknown }> = [];
  const from = (table: string) => {
    let patch: unknown = null;
    const b: Record<string, unknown> = {};
    for (const m of ["select", "in", "eq", "or", "not", "is", "contains"]) {
      b[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        if (patch !== null && m === "eq" && args[0] === "id") {
          updates.push({ id: args[1], patch });
          return Promise.resolve({ error: null });
        }
        return b;
      };
    }
    b.update = (p: unknown) => {
      patch = p;
      return b;
    };
    b.then = (ok: (v: unknown) => unknown) => Promise.resolve(answers[table] ?? { data: [], error: null }).then(ok);
    return b;
  };
  return { client: { from } as unknown as SupabaseClient, calls, updates };
}

Deno.test("публикация: пространства участников из allowed_users по e-mail", async () => {
  const db = fakeDb({ allowed_users: { data: [{ group_id: "world" }, { group_id: "cee" }], error: null } });
  const got = await visibleGroupIdsForMeeting(db.client, "cee", [{ email: "X@Y.io" }]);
  assertEquals(got, ["cee", "world"]);
  const byEmail = db.calls.find((c) => c.table === "allowed_users" && c.method === "in");
  assertEquals(byEmail?.args, ["email", ["x@y.io"]]);
});

Deno.test("публикация: без e-mail участников в базу не ходим — только домашнее", async () => {
  const db = fakeDb({});
  assertEquals(await visibleGroupIdsForMeeting(db.client, "cee", [{ name: "Без почты" }]), ["cee"]);
  assertEquals(db.calls.length, 0);
});

Deno.test("публикация: сбой allowed_users — только домашнее (fail-closed), а не исключение", async () => {
  const db = fakeDb({ allowed_users: { data: null, error: { message: "boom" } } });
  assertEquals(await visibleGroupIdsForMeeting(db.client, "cee", [{ email: "x@y.io" }]), ["cee"]);
});

// Склейка общей встречи (решение 05.11.2026): пространство записавшего по telegram_id в признак
// не идёт — в чужую строку можно было встать, зная только ключ. Публикующий (прошёл доступ) — идёт.
Deno.test("публикация: пространство публикующего — в признак, база по telegram_id не читается", async () => {
  const db = fakeDb({ allowed_users: { data: [], error: null } });
  const got = await visibleGroupIdsForMeeting(db.client, "cee", [{ email: "a@b.io" }], { knownGroupIds: ["world"] });
  assertEquals(got, ["cee", "world"]);
  assertEquals(
    db.calls.some((c) => c.table === "allowed_users" && c.method === "in" && c.args[0] === "telegram_id"),
    false,
  );
});

Deno.test("публикация: сбой allowed_users — остаются домашнее и известное пространство публикующего", async () => {
  const db = fakeDb({ allowed_users: { data: null, error: { message: "boom" } } });
  const got = await visibleGroupIdsForMeeting(db.client, "cee", [{ email: "x@y.io" }], {
    knownGroupIds: ["world"],
  });
  assertEquals(got, ["cee", "world"]);
});
