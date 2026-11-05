import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { publishDraftMeeting, resolvePublishVisibility } from "./meeting-publish.ts";

// Запрет срабатывает до любого запроса к базе: клиент, который падает на любом обращении,
// доказывает, что отказ случился раньше.
const noDb = new Proxy({}, {
  get() {
    throw new Error("к базе обращаться не должны");
  },
}) as unknown as SupabaseClient;

const opts = { groupId: "cee", telegramId: 1, viewerEmail: null, countries: undefined, entryColumns: "id" };

Deno.test("встреча трёх владельцев в личную базу не публикуется (веб и MCP)", async () => {
  const meeting = { id: "m1", status: "awaiting_review", recorders: [{ telegram_id: 1 }], co_owners: [2, 3] };
  const res = await publishDraftMeeting(noDb, meeting, { ...opts, isPrivate: true });
  assertEquals(res.ok, false);
  assertEquals(res.ok ? 0 : res.status, 409);
});

// ── Видимость публикуемой записи (#641) ──────────────────────────────────────────────────────
// Решение «куда и кому» принимает СЕРВЕР по составу встречи, клиенту не верим: он прислал
// только base=personal|workspace.

Deno.test("в команду: запись общая, ни с кем отдельно не делится", () => {
  const m = { recorders: [{ telegram_id: 1 }], co_owners: [2] };
  assertEquals(resolvePublishVisibility(m, 1, false), { ok: true, isPrivate: false, sharedWith: [] });
});

Deno.test("личная своя встреча: только автор", () => {
  const m = { recorders: [{ telegram_id: 1 }], co_owners: [] };
  assertEquals(resolvePublishVisibility(m, 1, true), { ok: true, isPrivate: true, sharedWith: [] });
});

Deno.test("личная 1-1: одна запись, второй участник получает доступ", () => {
  const m = { recorders: [{ telegram_id: 1 }], co_owners: [-37] };
  assertEquals(resolvePublishVisibility(m, 1, true), { ok: true, isPrivate: true, sharedWith: [-37] });
  // Публикует совладелец — владельцем записи становится он, записавший получает доступ.
  assertEquals(resolvePublishVisibility(m, -37, true), { ok: true, isPrivate: true, sharedWith: [1] });
});

Deno.test("личная при третьем человеке в календаре — отказ 409", () => {
  const m = {
    recorders: [{ telegram_id: 1 }],
    co_owners: [2],
    attendees: [{ email: "a@x.io" }, { email: "b@x.io" }, { email: "c@x.io" }],
  };
  const r = resolvePublishVisibility(m, 1, true);
  assertEquals(r.ok, false);
});

Deno.test("личная при трёх владельцах — отказ 409", () => {
  const r = resolvePublishVisibility({ recorders: [{ telegram_id: 1 }], co_owners: [2, 3] }, 1, true);
  assertEquals(r.ok, false);
});

// ── Склейка общей встречи между пространствами (решение 05.11.2026) ────────────────────────────
// Календарный ключ один на всех, и запись человека из «world» встаёт в строку `meetings` «cee».
// Публикует он из своей сессии (groupId=world), а запись обязана лечь в ДОМ строки: дедуп, ключ
// OpenAI и `entries.group_id` — «cee»; его пространство — в признак принадлежности.

/** База-заглушка: всё читается пустым, вставка в entries запоминается и возвращает строку. */
function recordingDb(groupsByTelegramId: Record<number, string>) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const eqs: Array<{ table: string; column: string; value: unknown }> = [];
  const from = (table: string) => {
    let inserted: Record<string, unknown> | null = null;
    let ids: unknown[] = [];
    let updated = false;
    const empty = () => {
      if (inserted) return { data: { id: "e-new", ...inserted }, error: null };
      // Привязка черновика к записи (update meetings … maybeSingle) — удалась.
      if (updated && table === "meetings") return { data: { id: "m1" }, error: null };
      return { data: table === "allowed_users" ? [] : null, error: null };
    };
    const b: Record<string, unknown> = {};
    b.update = () => {
      updated = true;
      return b;
    };
    for (
      const m of [
        "select",
        "eq",
        "neq",
        "is",
        "or",
        "not",
        "gte",
        "lte",
        "lt",
        "gt",
        "order",
        "limit",
        "contains",
        "ilike",
        "upsert",
        "filter",
        "match",
        "delete",
      ]
    ) {
      b[m] = (...args: unknown[]) => {
        if (m === "eq") eqs.push({ table, column: String(args[0]), value: args[1] });
        return b;
      };
    }
    b.in = (column: string, values: unknown[]) => {
      if (table === "allowed_users" && column === "telegram_id") ids = values;
      return b;
    };
    b.insert = (row: Record<string, unknown>) => {
      inserted = row;
      inserts.push({ table, row });
      return b;
    };
    b.single = () => Promise.resolve(empty());
    b.maybeSingle = () => Promise.resolve(empty());
    b.then = (ok: (v: unknown) => unknown) => {
      if (table === "allowed_users" && ids.length > 0) {
        const data = ids.map((id) => ({ group_id: groupsByTelegramId[id as number] ?? null }));
        return Promise.resolve({ data, error: null }).then(ok);
      }
      return Promise.resolve(empty()).then(ok);
    };
    return b;
  };
  return {
    client: { from, rpc: () => Promise.resolve({ data: null, error: null }) } as unknown as SupabaseClient,
    inserts,
    eqs,
  };
}

Deno.test("склейка между пространствами: запись ложится в дом строки, пространство записавшего — в признак", async () => {
  const db = recordingDb({ 111: "cee", 222: "world" });
  const meeting = {
    id: "m1",
    group_id: "cee",
    status: "awaiting_review",
    draft_notes_md: "Тезисы",
    started_at: "2026-11-05T10:00:00Z",
    identity_key: "evt:2026-11-05",
    title: "Weekly sync",
    recorders: [{ telegram_id: 111 }, { telegram_id: 222 }],
    attendees: [{ name: "Ann", email: "ann@x.io" }],
  };
  const res = await publishDraftMeeting(db.client, meeting, {
    ...opts,
    groupId: "world",
    telegramId: 222,
    isPrivate: false,
    countries: [],
    skipModel: true,
  });
  const entry = db.inserts.find((i) => i.table === "entries")?.row;
  assertEquals(res.ok, true);
  assertEquals(entry?.group_id, "cee");
  assertEquals(entry?.visible_group_ids, ["cee", "world"]);
  // Дедуп ищет дубль в доме строки, а не в пространстве публикующего.
  const dedupGroups = db.eqs.filter((e) => e.table === "entries" && e.column === "group_id").map((e) => e.value);
  assertEquals(dedupGroups.includes("cee"), true);
  assertEquals(dedupGroups.includes("world"), false);
});
