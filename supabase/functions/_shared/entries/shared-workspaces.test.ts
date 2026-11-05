// Признак принадлежности встречи — кто и что проставляет (этап 2 решения о втором пространстве).
// Ядро доступа: ошибка здесь молчит — встреча либо не видна второй команде, либо видна лишним.
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  attendeeEmails,
  meetingPeopleIds,
  meetingVisibleGroupIds,
  shareMeetingsOfPerson,
  visibleGroupIdsForMeeting,
} from "./shared-workspaces.ts";
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

Deno.test("люди черновика: записавшие, держатель записи, совладельцы — без повторов и мусора", () => {
  assertEquals(
    meetingPeopleIds({
      recorders: [{ telegram_id: 1 }, { telegram_id: "2" }, null, { telegram_id: 0 }],
      claim_owner: 3,
      co_owners: [1, "4", "x"],
    }),
    [1, 2, 3, 4],
  );
  assertEquals(meetingPeopleIds(null), []);
});

// Склейка общей встречи (решение 05.11.2026): запись человека из B лежит в строке `meetings`
// пространства A. Его e-mail может не быть в календаре — пространство берётся по telegram_id.
Deno.test("публикация склеенной встречи: пространство записавшего из B — по telegram_id", async () => {
  const answers: Record<string, { data: unknown; error: unknown }> = {};
  const db = fakeDb(answers);
  answers.allowed_users = { data: [{ group_id: "world" }], error: null };
  const got = await visibleGroupIdsForMeeting(db.client, "cee", [], { peopleIds: [222] });
  assertEquals(got, ["cee", "world"]);
  const byId = db.calls.find((c) => c.table === "allowed_users" && c.method === "in");
  assertEquals(byId?.args, ["telegram_id", [222]]);
});

Deno.test("публикация: сбой allowed_users — остаются домашнее и известное пространство публикующего", async () => {
  const db = fakeDb({ allowed_users: { data: null, error: { message: "boom" } } });
  const got = await visibleGroupIdsForMeeting(db.client, "cee", [{ email: "x@y.io" }], {
    peopleIds: [222],
    knownGroupIds: ["world"],
  });
  assertEquals(got, ["cee", "world"]);
});

Deno.test("переезд: общие встречи человека получают новое пространство, лишние записи не трогаются", async () => {
  const db = fakeDb({
    meetings: { data: [{ entry_id: "e-rec" }], error: null },
    entries: {
      data: [
        { id: "e-own", group_id: "cee", visible_group_ids: ["cee"] },
        { id: "e-rec", group_id: "cee", visible_group_ids: ["cee"] },
        { id: "e-done", group_id: "cee", visible_group_ids: ["cee", "world"] },
      ],
      error: null,
    },
  });
  const changed = await shareMeetingsOfPerson(db.client, { email: "Me@X.io", telegramId: 42, toGroupId: "world" });
  assertEquals(changed, 2);
  assertEquals(db.updates, [
    { id: "e-own", patch: { visible_group_ids: ["cee", "world"] } },
    { id: "e-rec", patch: { visible_group_ids: ["cee", "world"] } },
  ]);
  // Кандидаты — только ОБЩИЕ встречи: личные круг не расширяют.
  const entryFilters = db.calls.filter((c) => c.table === "entries" && c.method === "eq").map((c) => c.args);
  assertEquals(entryFilters.some((a) => a[0] === "is_private" && a[1] === false), true);
  assertEquals(entryFilters.some((a) => a[0] === "entry_type" && a[1] === "meeting"), true);
  const or = String(db.calls.find((c) => c.table === "entries" && c.method === "or")?.args[0]);
  assertEquals(or.includes("owner_id.eq.42"), true);
  assertEquals(or.includes(`"email":"me@x.io"`), true);
  assertEquals(or.includes("id.in.(e-rec)"), true);
});

Deno.test("переезд: без e-mail и id — ничего не трогаем; кривое пространство — отказ", async () => {
  const db = fakeDb({});
  assertEquals(await shareMeetingsOfPerson(db.client, { email: null, telegramId: null, toGroupId: "world" }), 0);
  assertEquals(db.calls.length, 0);
  await assertRejects(() => shareMeetingsOfPerson(db.client, { email: "a@b.c", telegramId: 1, toGroupId: "a,b" }));
});
