import { assertEquals } from "@std/assert";
import { meetingStatusResponse } from "./meeting-status-response.ts";

Deno.test("status response explicitly ends polling for absent and inaccessible IDs alike", () => {
  const own = { id: "own", status: "processing", summary_status: "pending" };
  assertEquals(meetingStatusResponse(["own", "deleted", "foreign", "deleted"], [own]), {
    ok: true,
    statuses: [own],
    unavailable_ids: ["deleted", "foreign"],
  });
});

Deno.test("status response preserves publication and does not invent unavailable IDs", () => {
  const published = { id: "own", status: "in_base", summary_status: "done" };
  assertEquals(meetingStatusResponse(["own"], [published]), {
    ok: true,
    statuses: [published],
    unavailable_ids: [],
  });
  assertEquals(meetingStatusResponse([], []), { ok: true, statuses: [], unavailable_ids: [] });
});
