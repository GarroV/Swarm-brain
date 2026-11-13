import { assertEquals } from "@std/assert";
import { draftDeleteResponse } from "./meeting-delete.ts";

Deno.test("draft deletion HTTP: preserves existing denial status and body, and returns 204 only on completed cleanup", async () => {
  const cases = [
    ["not_found", 404, "Not found"],
    ["published", 409, "Уже в базе — удаляйте через раздел «База»"],
    ["shared", 409, "This meeting has several owners — hide it for yourself instead"],
    ["forbidden", 403, "Only the person who recorded this meeting can delete the draft"],
    ["changed", 409, "Draft changed — reload before deleting"],
    ["storage", 500, "Draft file cleanup is incomplete — retry deletion"],
  ] as const;
  for (const [reason, status, error] of cases) {
    const response = draftDeleteResponse({ ok: false, reason }, "https://fixture.invalid");
    assertEquals(response.status, status);
    assertEquals((await response.json()).error, error);
  }
  const complete = draftDeleteResponse({ ok: true }, "https://fixture.invalid");
  assertEquals(complete.status, 204);
  assertEquals(await complete.text(), "");
});
