// Тесты склейки встреч по составу для claim (issues #168, #181).
// Запуск: deno test supabase/functions/_shared/meeting-roster.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { sameMeetingByRoster, scopeRoomKey } from "./meeting-roster.ts";

// Живой случай 26.08: «IT+BD» писали двое — у владельца событие в Google-календаре (18 участников),
// у коллеги события нет, рекордер опознал только комнату Контур.Толк (ни названия, ни участников).
const CALENDAR_SIDE = {
  startedAt: "2026-08-26T12:00:00+00:00",
  ownerEmail: "v.garro@dodobrands.io",
  attendees: [
    { email: "v.garro@dodobrands.io", name: "Vasiliy Garro" },
    { email: "i.ravilova@dodobrands.io", name: "Indira Ravilova" },
    { email: "s.artemov@dodobrands.io" },
  ],
};
const ROOM_SIDE = {
  startedAt: "2026-08-26T12:01:36+00:00",
  ownerEmail: "I.Ravilova@dodobrands.io",   // регистр не важен
  attendees: [],
};

Deno.test("запись из комнаты и календарная — одна встреча: записавший есть в списке участников", () => {
  assertEquals(sameMeetingByRoster(ROOM_SIDE, CALENDAR_SIDE), { same: true, reason: "owner_in_roster" });
  // Симметрично: кто пришёл первым, тот и «входящая».
  assertEquals(sameMeetingByRoster(CALENDAR_SIDE, ROOM_SIDE).same, true);
});

Deno.test("тот же человек, но другая встреча того же дня → НЕ склеиваем (окно времени)", () => {
  const otherMeeting = { ...CALENDAR_SIDE, startedAt: "2026-08-26T08:00:00+00:00" };
  assertEquals(sameMeetingByRoster(ROOM_SIDE, otherMeeting), { same: false, reason: "time_apart" });
});

Deno.test("записавшего нет в списке участников → нет сигнала, не склеиваем", () => {
  const stranger = { ...ROOM_SIDE, ownerEmail: "someone.else@dodobrands.io" };
  assertEquals(sameMeetingByRoster(stranger, CALENDAR_SIDE), { same: false, reason: "no_signal" });
});

Deno.test("сильное пересечение состава склеивает (две записи одного инвайта)", () => {
  const a = { startedAt: "2026-08-26T11:00:00+00:00", ownerEmail: null, attendees: [{ name: "Анна" }, { name: "Борис" }, { name: "Вера" }] };
  const b = { startedAt: "2026-08-26T11:02:00+00:00", ownerEmail: null, attendees: [{ name: "Анна" }, { name: "Борис" }, { name: "Вера" }] };
  assertEquals(sameMeetingByRoster(a, b), { same: true, reason: "roster_overlap" });
});

Deno.test("разные встречи, делящие одного человека, НЕ склеиваются (кейс 1-1 ⨯ большой созвон)", () => {
  const oneToOne = { startedAt: "2026-06-19T08:00:00+00:00", ownerEmail: null, attendees: [{ name: "Maria" }, { name: "Aleksandra" }] };
  const big = {
    startedAt: "2026-06-19T08:05:00+00:00", ownerEmail: null,
    attendees: Array.from({ length: 14 }, (_, i) => ({ name: `Человек ${i}` })).concat([{ name: "Aleksandra" }]),
  };
  assertEquals(sameMeetingByRoster(oneToOne, big), { same: false, reason: "no_signal" });
});

Deno.test("без времени хотя бы у одной стороны сопоставление не делаем", () => {
  assertEquals(sameMeetingByRoster({ ...ROOM_SIDE, startedAt: null }, CALENDAR_SIDE), { same: false, reason: "no_time" });
});

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
  assertEquals(scopeRoomKey("calendar", "evt@google.com:2026-08-26", "2026-08-26T12:00:00+00:00"), "evt@google.com:2026-08-26");
  assertEquals(scopeRoomKey("manual", "manual:uuid-1", "2026-08-26T12:00:00+00:00"), "manual:uuid-1");
  assertEquals(scopeRoomKey("room", "kontur:x:2026-08-26", "2026-08-26T12:00:00+00:00"), "kontur:x:2026-08-26");
  assertEquals(scopeRoomKey("room", "kontur:x", null), "kontur:x");
});
