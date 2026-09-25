import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { publishDraftMeeting } from "./meeting-publish.ts";

// Запрет срабатывает до любого запроса к базе: клиент, который падает на любом обращении,
// доказывает, что отказ случился раньше.
const noDb = new Proxy({}, {
  get() {
    throw new Error("к базе обращаться не должны");
  },
}) as unknown as SupabaseClient;

const opts = { groupId: "cee", telegramId: 1, viewerEmail: null, countries: undefined, entryColumns: "id" };

Deno.test("встреча нескольких владельцев в личную базу не публикуется (веб и MCP)", async () => {
  const meeting = { id: "m1", status: "awaiting_review", recorders: [{ telegram_id: 1 }], co_owners: [2] };
  const res = await publishDraftMeeting(noDb, meeting, { ...opts, isPrivate: true });
  assertEquals(res.ok, false);
  assertEquals(res.ok ? 0 : res.status, 409);
});
