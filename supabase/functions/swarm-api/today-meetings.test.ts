import { assertEquals } from "@std/assert";
import { loadTodayMeetings } from "./today-meetings.ts";

Deno.test("web and recorder board attach only the authenticated employee's work account", async () => {
  for (const email of ["employee@example.com", null]) {
    const calls: unknown[] = [];
    const db = {
      from: (table: string) => {
        assertEquals(table, "allowed_users");
        return {
          select: (columns: string) => {
            assertEquals(columns.startsWith("email,"), true);
            return {
              eq: (column: string, value: unknown) => {
                calls.push([column, value]);
                return { maybeSingle: () => Promise.resolve({ data: { email }, error: null }) };
              },
            };
          },
        };
      },
    } as never;
    const result = await loadTodayMeetings(db, 17, 60, "test", (_db, id) => {
      assertEquals(id, 17);
      return Promise.resolve({
        ok: true,
        events: [{
          id: "event",
          start: { dateTime: "2026-11-24T10:00:00Z" },
          end: { dateTime: "2026-11-24T11:00:00Z" },
          hangoutLink: "https://meet.google.com/abc-defg-hij",
        }],
      });
    });
    assertEquals(calls, [["telegram_id", 17]]);
    if (!result.ok) throw new Error("expected a calendar result");
    assertEquals(result.meetings[0].join_url, "https://meet.google.com/abc-defg-hij");
    if (email) {
      const chooser = new URL(result.meetings[0].open_url!);
      assertEquals(chooser.searchParams.get("Email"), email);
      assertEquals(new URL(chooser.searchParams.get("continue")!).searchParams.get("authuser"), email);
    } else assertEquals(result.meetings[0].open_url, null);
  }
});
