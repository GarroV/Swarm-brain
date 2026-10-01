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
