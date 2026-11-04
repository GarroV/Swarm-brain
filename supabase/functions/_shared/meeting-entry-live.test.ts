import { assertEquals } from "jsr:@std/assert@1";
import { meetingEntryIsLive } from "./meeting-entry-live.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.test("исходник доступен только с живой записью своего пространства; ошибка закрывает доступ", async () => {
  const calls: unknown[][] = [];
  let data: unknown = { id: "e1" };
  let error: unknown = null;
  const q = {
    select: (v: unknown) => {
      calls.push(["select", v]);
      return q;
    },
    eq: (k: unknown, v: unknown) => {
      calls.push(["eq", k, v]);
      return q;
    },
    is: (k: unknown, v: unknown) => {
      calls.push(["is", k, v]);
      return q;
    },
    maybeSingle: () => Promise.resolve({ data, error }),
  };
  const db = { from: () => q } as unknown as SupabaseClient;
  assertEquals(await meetingEntryIsLive(db, { entry_id: null }), true);
  assertEquals(calls.length, 0);
  assertEquals(await meetingEntryIsLive(db, { entry_id: "e1", group_id: "a" }), true);
  assertEquals(calls.some((v) => v[0] === "is" && v[1] === "archived_at" && v[2] === null), true);
  assertEquals(calls.some((v) => v[0] === "eq" && v[1] === "group_id" && v[2] === "a"), true);
  data = null;
  assertEquals(await meetingEntryIsLive(db, { entry_id: "e1", group_id: "a" }), false);
  data = { id: "e1" };
  error = { message: "failed" };
  assertEquals(await meetingEntryIsLive(db, { entry_id: "e1", group_id: "a" }), false);
  assertEquals(await meetingEntryIsLive(db, { entry_id: "e1", group_id: null }), false);
});
