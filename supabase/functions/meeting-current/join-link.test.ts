import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { joinLink } from "./join-link.ts";
import type { GEvent } from "./select.ts";

// Ссылка на звонок для кнопки «Подключиться» в уведомлении рекордера (#193).
// Смысл: человек не должен идти в календарь и искать ссылку руками, когда встреча уже началась.

Deno.test("берёт видео-точку входа из conferenceData", () => {
  const ev = {
    id: "e1",
    conferenceData: {
      entryPoints: [
        { entryPointType: "more", uri: "https://meet.google.com/tel/123" },
        { entryPointType: "phone", uri: "tel:+7999" },
        { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" },
      ],
    },
  } as GEvent;

  assertEquals(joinLink(ev), "https://meet.google.com/abc-defg-hij");
});

Deno.test("падает на hangoutLink, когда conferenceData нет", () => {
  const ev = { id: "e1", hangoutLink: "https://meet.google.com/xyz-1234-abc" } as GEvent;

  assertEquals(joinLink(ev), "https://meet.google.com/xyz-1234-abc");
});

Deno.test("conferenceData важнее hangoutLink", () => {
  const ev = {
    id: "e1",
    hangoutLink: "https://meet.google.com/старая",
    conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://ktalk.ru/room-42" }] },
  } as GEvent;

  assertEquals(joinLink(ev), "https://ktalk.ru/room-42");
});

Deno.test("вытаскивает ссылку из места проведения", () => {
  const ev = { id: "e1", location: "https://ktalk.ru/imf-bd-weekly" } as GEvent;

  assertEquals(joinLink(ev), "https://ktalk.ru/imf-bd-weekly");
});

Deno.test("место проведения без ссылки ссылкой не считается", () => {
  const ev = { id: "e1", location: "Переговорка 3, второй этаж" } as GEvent;

  assertEquals(joinLink(ev), null);
});

Deno.test("находит ссылку внутри текста места проведения", () => {
  const ev = { id: "e1", location: "Zoom: https://us02web.zoom.us/j/8912345678?pwd=abc (пароль в описании)" } as GEvent;

  assertEquals(joinLink(ev), "https://us02web.zoom.us/j/8912345678?pwd=abc");
});

Deno.test("пропускает не-https схемы", () => {
  // Приглашение в календарь может прислать кто угодно, а ссылку рекордер ОТКРЫВАЕТ по клику.
  // Всё, кроме https, отбиваем: javascript:, file:, http: — не адрес встречи, а способ навредить.
  for (const location of [
    "javascript:alert(1)",
    "file:///Users/garva/secret",
    "http://ktalk.ru/room-42",
  ]) {
    assertEquals(joinLink({ id: "e1", location } as GEvent), null, location);
  }

  // Те же схемы, но пришедшие из полей самого Google — проверять надо каждый источник.
  assertEquals(joinLink({ id: "e1", hangoutLink: "javascript:alert(1)" } as GEvent), null, "hangoutLink");
  assertEquals(
    joinLink({
      id: "e1",
      conferenceData: { entryPoints: [{ entryPointType: "video", uri: "http://ktalk.ru/room-42" }] },
    } as GEvent),
    null,
    "conferenceData",
  );
});

Deno.test("пустое событие — без ссылки", () => {
  assertEquals(joinLink({ id: "e1" } as GEvent), null);
});

Deno.test("мусор вместо uri не проходит", () => {
  const ev = {
    id: "e1",
    conferenceData: { entryPoints: [{ entryPointType: "video", uri: "не ссылка" }] },
  } as GEvent;

  assertEquals(joinLink(ev), null);
});
