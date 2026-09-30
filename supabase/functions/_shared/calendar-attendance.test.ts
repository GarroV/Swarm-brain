// Идёт ли человек на встречу из своего календаря (решение D024). Ядро прав доступа: по этому
// правилу бот сам приходит на встречу и заводит человеку приватную запись. Ошибка молчалива —
// бот сидит на созвоне, куда человек не собирался, — поэтому каждая граница отдельным тестом.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { GEvent } from "../meeting-current/select.ts";
import { acceptedBySelf } from "./calendar-attendance.ts";

const me = (responseStatus?: string) => ({ email: "me@x.io", self: true, ...(responseStatus && { responseStatus }) });
const other = (responseStatus = "accepted") => ({ email: "b@x.io", responseStatus });

Deno.test("ответил «да» — идёт", () => {
  assertEquals(acceptedBySelf({ attendees: [me("accepted"), other()] }), true);
});

Deno.test("«может быть», «нет» и без ответа — не идёт", () => {
  for (const status of ["tentative", "declined", "needsAction"]) {
    assertEquals(acceptedBySelf({ attendees: [me(status), other()] }), false, status);
  }
});

Deno.test("свой ответ решает, а не чужой: «да» другого участника не в счёт", () => {
  assertEquals(acceptedBySelf({ attendees: [me("needsAction"), other("accepted")] }), false);
});

Deno.test("своя встреча без списка гостей (Google не ведёт статус организатору) — «да»", () => {
  assertEquals(acceptedBySelf({ organizer: { self: true } }), true);
});

Deno.test("своя встреча, но свой ответ есть — решает ответ: организатор без «да» не идёт", () => {
  assertEquals(acceptedBySelf({ organizer: { self: true }, attendees: [me("declined"), other()] }), false);
  assertEquals(acceptedBySelf({ organizer: { self: true }, attendees: [me("needsAction"), other()] }), false);
});

Deno.test("своя встреча, своя строка без поля ответа — «да»", () => {
  assertEquals(acceptedBySelf({ organizer: { self: true }, attendees: [me(), other()] }), true);
});

Deno.test("чужая встреча без ответа человека — не идёт (приглашение от кого угодно)", () => {
  const events: Array<Pick<GEvent, "attendees" | "organizer">> = [
    {},
    { attendees: [other()] },
    { attendees: [me(), other()] },
    { organizer: { self: false } },
  ];
  for (const ev of events) assertEquals(acceptedBySelf(ev), false, JSON.stringify(ev));
});
