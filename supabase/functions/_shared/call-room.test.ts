// Тесты ключа комнаты звонка для склейки встреч (meeting-claim).
// Запуск: deno test supabase/functions/_shared/call-room.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { callRoomOfKey, callRoomOfUrl } from "./call-room.ts";

Deno.test("Meet: код из ссылки, параметры, слеш и регистр хоста не мешают", () => {
  assertEquals(callRoomOfUrl("https://meet.google.com/abc-defg-hij"), "meet:abc-defg-hij");
  assertEquals(callRoomOfUrl("https://meet.google.com/abc-defg-hij?authuser=0"), "meet:abc-defg-hij");
  assertEquals(callRoomOfUrl("https://meet.google.com/abc-defg-hij/"), "meet:abc-defg-hij");
  assertEquals(callRoomOfUrl("https://MEET.Google.com/abc-defg-hij"), "meet:abc-defg-hij");
});

Deno.test("Meet: не код комнаты (lookup, заглавные, без дефиса) → null", () => {
  assertEquals(callRoomOfUrl("https://meet.google.com/landing"), null);
  assertEquals(callRoomOfUrl("https://meet.google.com/"), null);
  assertEquals(callRoomOfUrl("https://meet.google.com/ABC-DEFG-HIJ"), null);
});

Deno.test("Контур.Толк: первая часть пути — комната", () => {
  assertEquals(callRoomOfUrl("https://ktalk.ru/myroom"), "kontur:myroom");
  assertEquals(callRoomOfUrl("https://talk.kontur.ru/abc123?x=1"), "kontur:abc123");
  assertEquals(callRoomOfUrl("https://ktalk.ru/"), null);
});

Deno.test("чужая площадка и мусор → null", () => {
  assertEquals(callRoomOfUrl("https://us02web.zoom.us/j/123456789"), null);
  assertEquals(callRoomOfUrl("not a url"), null);
  assertEquals(callRoomOfUrl(""), null);
  assertEquals(callRoomOfUrl(undefined), null);
  assertEquals(callRoomOfUrl(42), null);
});

Deno.test("ключ комнаты: дневной суффикс снимается, совпадает с комнатой из ссылки", () => {
  assertEquals(callRoomOfKey("room", "meet:abc-defg-hij:2026-10-26"), "meet:abc-defg-hij");
  assertEquals(callRoomOfKey("room", "kontur:myroom"), "kontur:myroom");
  assertEquals(
    callRoomOfKey("room", "meet:abc-defg-hij:2026-10-26"),
    callRoomOfUrl("https://meet.google.com/abc-defg-hij?authuser=0"),
  );
});

Deno.test("ключ не комнаты → null", () => {
  assertEquals(callRoomOfKey("calendar", "abc@google.com:2026-10-26"), null);
  assertEquals(callRoomOfKey("manual", "meet:abc-defg-hij"), null);
});
