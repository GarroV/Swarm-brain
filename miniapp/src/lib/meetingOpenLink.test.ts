import { assertEquals } from "@std/assert";
import { meetingOpenLink } from "./meetingOpenLink.ts";

const room = "https://meet.google.com/abc-defg-hij";
const open = "https://accounts.google.com/AccountChooser?Email=work%40example.com&continue=" + encodeURIComponent(room);

Deno.test("browser uses the work-account entry while the bot retains the room URL", () => {
  const meeting = { join_url: room, open_url: open };
  assertEquals(meetingOpenLink(meeting), open);
  assertEquals(meeting.join_url, room);
});
Deno.test("explicitly blocked entry never falls back to the personal account", () => {
  for (const open_url of [null, "", "javascript:alert(1)", "http://meet.google.com/x"]) {
    assertEquals(meetingOpenLink({ join_url: room, open_url }), null);
  }
});
Deno.test("old API responses and other conference links remain supported", () => {
  assertEquals(meetingOpenLink({ join_url: room }), room);
  assertEquals(
    meetingOpenLink({ join_url: "https://ktalk.ru/room", open_url: "https://ktalk.ru/room" }),
    "https://ktalk.ru/room",
  );
});
