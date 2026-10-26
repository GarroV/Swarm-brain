// Тесты правил склейки встреч для claim (issues #168, #181).
// Запуск: deno test supabase/functions/_shared/meeting-roster.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { mayGlueByRoom, rosterMatchApplies, scopeRoomKey } from "./meeting-roster.ts";

// ── Ключ комнаты сужается до дня (issue #181) ──────────────────────────────────

Deno.test("scopeRoomKey — комнатный ключ получает день", () => {
  assertEquals(scopeRoomKey("room", "kontur:c6957f9e", "2026-08-26T12:01:36+00:00"), "kontur:c6957f9e:2026-08-26");
  assertEquals(scopeRoomKey("room", "meet:nsm-zmvz-kyk", "2026-07-16T09:00:00+00:00"), "meet:nsm-zmvz-kyk:2026-07-16");
});

Deno.test("scopeRoomKey — регулярная встреча в ТОЙ ЖЕ комнате получает другой ключ", () => {
  const week1 = scopeRoomKey("room", "meet:nsm-zmvz-kyk", "2026-07-16T09:00:00+00:00");
  const week2 = scopeRoomKey("room", "meet:nsm-zmvz-kyk", "2026-07-23T09:00:00+00:00");
  assertEquals(week1 === week2, false);
});

Deno.test("scopeRoomKey — календарь и manual не трогаем, повторное сужение идемпотентно", () => {
  assertEquals(
    scopeRoomKey("calendar", "evt@google.com:2026-08-26", "2026-08-26T12:00:00+00:00"),
    "evt@google.com:2026-08-26",
  );
  assertEquals(scopeRoomKey("manual", "manual:uuid-1", "2026-08-26T12:00:00+00:00"), "manual:uuid-1");
  assertEquals(scopeRoomKey("room", "kontur:x:2026-08-26", "2026-08-26T12:00:00+00:00"), "kontur:x:2026-08-26");
  assertEquals(scopeRoomKey("room", "kontur:x", null), "kontur:x");
});

// 26.10.2026: два разных события календаря в одно время с общим участником — разные встречи.
Deno.test("два календарных ключа не склеиваются", () => {
  assertEquals(rosterMatchApplies("calendar", "calendar"), false);
});

Deno.test("календарь с комнатой и внешней системой допускают склейку по ссылке", () => {
  assertEquals(rosterMatchApplies("calendar", "room"), true);
  assertEquals(rosterMatchApplies("room", "calendar"), true);
  assertEquals(rosterMatchApplies("calendar", "external"), true);
  assertEquals(rosterMatchApplies("room", "room"), true);
  assertEquals(rosterMatchApplies("calendar", null), true);
});

Deno.test("по ссылке клеит только участника: записавший одной стороны есть в составе другой", () => {
  const cal = { ownerEmail: "v.garro@dodobrands.io", attendees: [{ email: "I.Ravilova@dodobrands.io" }] };
  const room = { ownerEmail: "i.ravilova@dodobrands.io", attendees: [] };
  assertEquals(mayGlueByRoom(room, cal), true);
  assertEquals(mayGlueByRoom(cal, room), true);
});

Deno.test("по ссылке не клеит постороннего, знающего ссылку", () => {
  const cal = { ownerEmail: "v.garro@dodobrands.io", attendees: [{ email: "i.ravilova@dodobrands.io" }] };
  const stranger = { ownerEmail: "x@dodobrands.io", attendees: [] };
  assertEquals(mayGlueByRoom(stranger, cal), false);
  assertEquals(mayGlueByRoom({ ownerEmail: null, attendees: [] }, { ownerEmail: null, attendees: [] }), false);
});

Deno.test("по ссылке клеит две записи одного человека", () => {
  const a = { ownerEmail: "v.garro@dodobrands.io", attendees: [] };
  assertEquals(mayGlueByRoom(a, { ownerEmail: "V.Garro@dodobrands.io", attendees: null }), true);
});
