// Терминальные исходы двери по журналу нотис: какие виды считаются «бот не вошёл» и что читается
// только журнал ЭТОЙ встречи — параллельная встреча человека арбитраж не задевает.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOOR_TERMINAL_KINDS, latestDoorFailureMs, loadDoorFailureMs } from "./door-failure.ts";

const T1 = "2026-09-28T11:59:00.000Z";
const T2 = "2026-09-28T12:03:00.000Z";

Deno.test("терминальные виды двери, второй door_waiting — исход; первый door_waiting, no_audio и container_died — нет", () => {
  for (const kind of DOOR_TERMINAL_KINDS) {
    assertEquals(latestDoorFailureMs([{ kind, attempt: 1, sent_at: T1 }]), Date.parse(T1), kind);
  }
  assertEquals(latestDoorFailureMs([{ kind: "door_waiting", attempt: 2, sent_at: T1 }]), Date.parse(T1));
  assertEquals(latestDoorFailureMs([{ kind: "door_waiting", attempt: 1, sent_at: T1 }]), null);
  assertEquals(latestDoorFailureMs([{ kind: "no_audio", attempt: 1, sent_at: T1 }]), null);
  assertEquals(latestDoorFailureMs([{ kind: "container_died", attempt: 1, sent_at: T1 }]), null);
  assertEquals(latestDoorFailureMs([]), null);
});

Deno.test("из нескольких нотис берётся последняя", () => {
  assertEquals(
    latestDoorFailureMs([
      { kind: "guest_access_closed", attempt: 1, sent_at: T2 },
      { kind: "door_denied", attempt: 1, sent_at: T1 },
    ]),
    Date.parse(T2),
  );
});

/** Журнал по двум встречам: запрос обязан фильтровать по `meeting_id`. */
function fakeClient(rows: Array<{ meeting_id: string; kind: string; attempt: number; sent_at: string }>, fail = false) {
  const query = () => {
    const filters: Array<[string, unknown]> = [];
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push([c, v]), q),
      in: () => q,
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
        Promise.resolve().then(() => {
          if (fail) return { data: null, error: { message: "boom" } };
          const id = filters.find(([c]) => c === "meeting_id")?.[1];
          return { data: rows.filter((r) => r.meeting_id === id), error: null };
        }).then(ok, bad),
    };
    return q;
  };
  return { from: query } as unknown as SupabaseClient;
}

Deno.test("БЛОКИРУЮЩИЙ: нотиса двери ДРУГОЙ встречи (параллельной) исходом этой не считается", async () => {
  const client = fakeClient([{ meeting_id: "other", kind: "guest_access_closed", attempt: 1, sent_at: T1 }]);
  assertEquals(await loadDoorFailureMs(client, "this"), null);
  assertEquals(await loadDoorFailureMs(client, "other"), Date.parse(T1));
});

Deno.test("журнал не прочитан — null (прежняя льгота), а не исключение", async () => {
  assertEquals(await loadDoorFailureMs(fakeClient([], true), "this"), null);
});
