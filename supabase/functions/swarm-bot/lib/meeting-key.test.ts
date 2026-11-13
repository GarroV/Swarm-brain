import { assertEquals } from "jsr:@std/assert@1";
import { isSafeMeetingKey, meetingEntryFilter } from "./meeting-key.ts";

Deno.test("обычные ключи встречи проходят и попадают в фильтр", () => {
  assertEquals(isSafeMeetingKey("01HZX9ABCDEF"), true);
  assertEquals(isSafeMeetingKey("3f2b6c1e-0a4d-4c7e-9a55-1f3e2d4c5b6a"), true);
  assertEquals(
    meetingEntryFilter("abc-123"),
    "metadata->>meeting_id.eq.abc-123,id.eq.abc-123",
  );
});

Deno.test("ключ со служебными символами фильтра отвергается", () => {
  for (const bad of ["a,id.neq.0", "a)b", "a(b", 'a"b', "a b", "a\\b", "", "x".repeat(129)]) {
    assertEquals(isSafeMeetingKey(bad), false, bad);
    assertEquals(meetingEntryFilter(bad), "id.eq.00000000-0000-0000-0000-000000000000", bad);
  }
});
