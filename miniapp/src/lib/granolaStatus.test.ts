import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { formatGranolaAttempt, granolaCheckStatus } from "./granolaStatus.ts";
import type { Integration } from "@/types";

const attemptedAt = "2026-11-14T08:15:00Z";
const integration = (fields: Partial<Integration> = {}): Integration => ({
  service: "granola",
  last_polled_at: attemptedAt,
  skipped_note_ids: [],
  ...fields,
});

Deno.test("Granola status is absent when disconnected, including calendar-only accounts", () => {
  assertEquals(granolaCheckStatus([]), null);
  assertEquals(
    granolaCheckStatus([integration({ service: "google_calendar" })]),
    null,
  );
});

Deno.test("Granola status selects its own attempt, not another integration's newer timestamp", () => {
  assertEquals(
    granolaCheckStatus([
      integration({
        service: "google_calendar",
        last_polled_at: "2026-11-14T09:00:00Z",
      }),
      integration(),
    ]),
    { attemptedAt, failed: false },
  );
});

Deno.test("failed checks retain their attempt timestamp and expose only a boolean error state", () => {
  assertEquals(
    granolaCheckStatus([
      integration({ last_error: "Synthetic upstream error" }),
    ]),
    {
      attemptedAt,
      failed: true,
    },
  );
  assertEquals(granolaCheckStatus([integration({ last_error: "" })]), {
    attemptedAt,
    failed: false,
  });
});

Deno.test("a never-polled connection is distinct from disconnected or failed", () => {
  assertEquals(granolaCheckStatus([integration({ last_polled_at: null })]), {
    attemptedAt: null,
    failed: false,
  });
  assertEquals(
    granolaCheckStatus([
      integration({ last_polled_at: null, last_error: "Synthetic failure" }),
    ]),
    {
      attemptedAt: null,
      failed: true,
    },
  );
});

Deno.test("attempt date formatting handles missing/invalid timestamps without inventing a time", () => {
  assertEquals(formatGranolaAttempt(null, "en-GB"), null);
  assertEquals(formatGranolaAttempt("not-a-date", "ru-RU"), null);
  assertNotEquals(formatGranolaAttempt(attemptedAt, "en-GB"), null);
  assertNotEquals(formatGranolaAttempt(attemptedAt, "ru-RU"), null);
  assertNotEquals(
    formatGranolaAttempt(attemptedAt, "ru-RU"),
    formatGranolaAttempt(attemptedAt, "en-GB"),
  );
});

Deno.test("status projection does not modify the integration response", () => {
  const row = Object.freeze(integration({ last_error: "Synthetic error" }));
  const rows = Object.freeze([row]);
  assertEquals(granolaCheckStatus(rows), { attemptedAt, failed: true });
  assertEquals(row.last_error, "Synthetic error");
  assertEquals(row.last_polled_at, attemptedAt);
});
