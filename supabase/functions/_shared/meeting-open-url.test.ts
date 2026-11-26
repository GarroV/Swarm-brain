import { assertEquals } from "@std/assert";
import { meetingOpenUrl } from "./meeting-open-url.ts";

Deno.test("Meet opens through Google AccountChooser using the saved work email", () => {
  const room =
    "https://meet.google.com/abc-defg-hij?authuser=0&authuser=2&login_hint=personal%40example.com&hs=122#notes";
  const result = new URL(meetingOpenUrl(room, " Work+Meet@Example.com ")!);
  assertEquals(result.origin + result.pathname, "https://accounts.google.com/AccountChooser");
  assertEquals(result.searchParams.get("Email"), "work+meet@example.com");
  const destination = new URL(result.searchParams.get("continue")!);
  assertEquals(destination.origin + destination.pathname, "https://meet.google.com/abc-defg-hij");
  assertEquals(destination.searchParams.getAll("authuser"), ["work+meet@example.com"]);
  assertEquals(destination.searchParams.has("login_hint"), false);
  assertEquals(destination.searchParams.get("hs"), "122");
  assertEquals(destination.hash, "#notes");
  assertEquals(room.includes("authuser=0"), true);
});

Deno.test("the work account is pinned to Meet itself without relying on account order", () => {
  const original = "https://meet.google.com/abc-defg-hij";
  for (const email of ["first@example.com", "other+work@example.org"]) {
    const chooser = new URL(meetingOpenUrl(original, email)!);
    const destination = new URL(chooser.searchParams.get("continue")!);
    assertEquals(chooser.searchParams.get("Email"), email);
    assertEquals(destination.searchParams.get("authuser"), email);
    assertEquals(original, "https://meet.google.com/abc-defg-hij");
  }
});

Deno.test("missing or malformed work email cannot silently open Meet with another account", () => {
  for (const email of [null, undefined, "", "   ", "work", "a@example.com&Email=other", "a\n@example.com"]) {
    assertEquals(meetingOpenUrl("https://meet.google.com/abc-defg-hij", email), null);
  }
});

Deno.test("other conference platforms retain their original links", () => {
  for (
    const raw of [
      "https://ktalk.ru/room?x=1",
      "https://us02web.zoom.us/j/123?pwd=abc",
      "https://meet.google.com.example.org/x",
    ]
  ) {
    assertEquals(meetingOpenUrl(raw, "work@example.com"), raw);
  }
});

Deno.test("unsafe and malformed destinations cannot be opened", () => {
  for (
    const raw of [
      null,
      "",
      "not a URL",
      "javascript:alert(1)",
      "http://meet.google.com/x",
      "https://user:pass@meet.google.com/x",
    ]
  ) {
    assertEquals(meetingOpenUrl(raw, "work@example.com"), null);
  }
});
