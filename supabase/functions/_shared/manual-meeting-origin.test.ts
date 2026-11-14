import { assertEquals, assertRejects } from "@std/assert";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadMeetingTextForModel } from "./meeting-processor.ts";

const legacyText =
  "Встреча: Synthetic meeting\n\nСтенограмма (реплики помечены «собеседник» — другие участники, «я» — это Synthetic Target (владелец записи)):\nя: Synthetic speech";

function fixture(
  origin?: Record<string, unknown> | null,
  sourceName: string | null = "Synthetic Source",
  confirmed = true,
  verificationError = false,
) {
  const queries: number[] = [];
  const row = {
    id: "target",
    title: "Synthetic meeting",
    claim_owner: 1,
    recorders: [{ telegram_id: 1 }],
    transcript: {
      segments: [{ start: 0, end: 1, speaker: "я", text: "Synthetic speech" }],
      ...(origin === undefined ? {} : { manual_merge_origin: origin }),
    },
  };
  const db = {
    rpc(_name: string, args: Record<string, unknown>) {
      if (args.p_meeting !== row.id) return Promise.resolve({ data: null, error: { code: "PGRST202" } });
      return Promise.resolve({
        data: confirmed ? origin ?? null : null,
        error: verificationError ? { code: "synthetic" } : null,
      });
    },
    from(table: string) {
      let id = 0;
      let columns: string[] = [];
      const query = {
        select(value: string) {
          columns = value.split(",").map((part) => part.trim());
          return query;
        },
        eq(_column: string, value: unknown) {
          id = Number(value);
          return query;
        },
        single() {
          return Promise.resolve({
            data: Object.fromEntries(Object.entries(row).filter(([key]) => columns.includes(key))),
            error: null,
          });
        },
        maybeSingle() {
          queries.push(id);
          const name = id === 1 ? "Synthetic Target" : id === 2 ? sourceName : null;
          return Promise.resolve({
            data: table === "user_profiles" && name ? { first_name: name, last_name: null } : null,
            error: null,
          });
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { db, queries };
}

Deno.test("legacy recording without origin retains the exact previous model context bytes", async () => {
  assertEquals(await loadMeetingTextForModel(fixture().db, "target"), legacyText);
  assertEquals(await loadMeetingTextForModel(fixture(null).db, "target"), legacyText);
});

Deno.test("merged recording resolves the microphone owner from original recording metadata", async () => {
  const f = fixture({
    meeting_id: "source",
    started_at: "2026-11-14T08:05:00Z",
    claim_owner: 2,
    recorders: [{ telegram_id: 2 }],
  });
  assertEquals(
    await loadMeetingTextForModel(f.db, "target"),
    legacyText.replace("Synthetic Target", "Synthetic Source"),
  );
  assertEquals(f.queries.every((id) => id === 2), true);
});

Deno.test("an unresolved original owner never falls back to an unrelated canonical owner", async () => {
  const f = fixture({ meeting_id: "source", claim_owner: 2, recorders: [{ telegram_id: 2 }] }, null);
  assertEquals(
    await loadMeetingTextForModel(f.db, "target"),
    legacyText.replace("«я» — это Synthetic Target (владелец записи)", "«я» — владелец записи"),
  );
});

Deno.test("a plain unconfirmed origin JSON keeps the legacy owner and never acquires authority", async () => {
  const f = fixture(
    { meeting_id: "unconfirmed", claim_owner: 2, recorders: [{ telegram_id: 2 }] },
    "Synthetic Source",
    false,
  );
  assertEquals(await loadMeetingTextForModel(f.db, "target"), legacyText);
});

Deno.test("failed origin verification refuses a new model context instead of misattributing the recording", async () => {
  const f = fixture(
    { meeting_id: "source", claim_owner: 2, recorders: [{ telegram_id: 2 }] },
    "Synthetic Source",
    true,
    true,
  );
  await assertRejects(
    () => loadMeetingTextForModel(f.db, "target"),
    Error,
    "Recording origin verification unavailable",
  );
  assertEquals(f.queries, []);
});
