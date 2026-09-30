// Отбор календарных встреч, на которые бот идёт сам (T100, решения D015/D016).
//
// Ядро прав доступа: здесь решается, ЗА КОГО и НА КАКУЮ встречу служебный агент заведёт приватную
// запись. Ошибка молчалива — бот сидит на встрече, куда человек не собирался, или не приходит туда,
// где его ждут, и никто этого не видит. Поэтому каждая граница — отдельным тестом.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { GEvent } from "../meeting-current/select.ts";
import { DISPATCH_LATE_MS, DISPATCH_LEAD_MS, mergeDispatch, planPersonDispatch } from "./calendar-dispatch.ts";

const NOW = Date.parse("2026-09-28T10:00:00+03:00");
const PERSON = 111;
const MEET = "https://meet.google.com/abc-defg-hij";

function at(offsetMin: number): string {
  // Смещение календаря сохраняется: ключ встречи берёт локальную дату начала.
  const d = new Date(NOW + offsetMin * 60_000 + 3 * 3_600_000);
  return d.toISOString().replace("Z", "+03:00").replace(/\.\d{3}/, "");
}

function event(over: Partial<GEvent> = {}, startMin = 1, lengthMin = 30): GEvent {
  return {
    id: "ev1",
    iCalUID: "uid1@google.com",
    summary: "Weekly",
    status: "confirmed",
    start: { dateTime: at(startMin) },
    end: { dateTime: at(startMin + lengthMin) },
    hangoutLink: MEET,
    // Своя встреча без гостей: Google не ведёт статус организатору, это «да» (D024).
    organizer: { self: true },
    ...over,
  };
}

const plan = (events: GEvent[], manualRooms = new Set<string>()) =>
  planPersonDispatch(events, PERSON, NOW, manualRooms);

Deno.test("встреча Meet, начинающаяся через минуту, — задание за владельца календаря", () => {
  const { jobs, skipped } = plan([event()]);
  assertEquals(skipped, []);
  assertEquals(jobs.length, 1);
  assertEquals(jobs[0].invited_by, PERSON);
  assertEquals(jobs[0].calendar_key, "uid1@google.com:2026-09-28");
  assertEquals(jobs[0].join_url, MEET);
  assertEquals(jobs[0].platform, "meet");
  assertEquals(jobs[0].title, "Weekly");
  assertEquals(Date.parse(jobs[0].starts_at), NOW + 60_000);
  assertEquals(Date.parse(jobs[0].ends_at), NOW + 31 * 60_000);
});

Deno.test("окно: раньше чем за DISPATCH_LEAD_MS до начала бот не идёт, в пределах — идёт", () => {
  const leadMin = DISPATCH_LEAD_MS / 60_000;
  assertEquals(plan([event({}, leadMin + 1)]).jobs.length, 0);
  assertEquals(plan([event({}, leadMin)]).jobs.length, 1);
});

Deno.test("окно: опоздание больше DISPATCH_LATE_MS — не идёт; уже закончилась — не идёт", () => {
  const lateMin = DISPATCH_LATE_MS / 60_000;
  assertEquals(plan([event({}, -lateMin, 60)]).jobs.length, 1);
  assertEquals(plan([event({}, -lateMin - 1, 60)]).jobs.length, 0);
  assertEquals(plan([event({}, -5, 5)]).jobs.length, 0);
});

Deno.test("вне окна — ни задания, ни пропуска: это не отказ, а не наше время", () => {
  const { jobs, skipped } = plan([event({ hangoutLink: undefined }, 120)]);
  assertEquals(jobs, []);
  assertEquals(skipped, []);
});

Deno.test("весь день и отменённые — не встречи бота, молча", () => {
  const allDay = event({ start: { date: "2026-09-28" }, end: { date: "2026-09-29" } });
  const cancelled = event({ status: "cancelled" });
  assertEquals(plan([allDay, cancelled]), { jobs: [], skipped: [] });
});

Deno.test("ГРОМКО: нет ссылки на звонок — пропуск с причиной no_conference_link", () => {
  const { jobs, skipped } = plan([event({ hangoutLink: undefined })]);
  assertEquals(jobs, []);
  assertEquals(skipped.length, 1);
  assertEquals(skipped[0].reason, "no_conference_link");
  assertEquals(skipped[0].invited_by, PERSON);
  assertEquals(skipped[0].calendar_key, "uid1@google.com:2026-09-28");
  assertEquals(skipped[0].title, "Weekly");
  // Время встречи едет с пропуском: по нему рекордер понимает, что встреча ещё идёт (T102).
  assertEquals(typeof skipped[0].starts_at, "string");
  assertEquals(typeof skipped[0].ends_at, "string");
});

Deno.test("ГРОМКО: не Meet и не Контур (Zoom, неизвестная ссылка) — пропуск unsupported_platform с площадкой", () => {
  const zoom = event({ id: "z", iCalUID: "z", hangoutLink: undefined, location: "https://us02web.zoom.us/j/123" });
  const other = event({ id: "o", iCalUID: "o", hangoutLink: undefined, location: "https://example.com/x" });
  const { jobs, skipped } = plan([zoom, other]);
  assertEquals(jobs, []);
  assertEquals(skipped.map((s) => [s.reason, s.platform]), [
    ["unsupported_platform", "zoom"],
    ["unsupported_platform", null],
  ]);
});

Deno.test("встреча Контур.Толка — задание, площадка kontur: адаптер у бота есть (T111)", () => {
  const kontur = event({
    id: "k",
    iCalUID: "k",
    hangoutLink: undefined,
    location: "https://ktalk.ru/room42",
  });
  const { jobs, skipped } = plan([kontur]);
  assertEquals(skipped, []);
  assertEquals(jobs.length, 1);
  assertEquals(jobs[0].platform, "kontur");
  assertEquals(jobs[0].join_url, "https://ktalk.ru/room42");
});

Deno.test("ссылка Meet без комнаты — пропуск unrecognized_link, а не бот в никуда", () => {
  const { jobs, skipped } = plan([event({ hangoutLink: "https://meet.google.com/" })]);
  assertEquals(jobs, []);
  assertEquals(skipped.map((s) => s.reason), ["unrecognized_link"]);
});

Deno.test("ДОСТУП: человек отклонил приглашение — бот за него не идёт", () => {
  const declined = event({
    attendees: [{ email: "me@x.io", self: true, responseStatus: "declined" }, { email: "b@x.io" }],
  });
  const { jobs, skipped } = plan([declined]);
  assertEquals(jobs, []);
  assertEquals(skipped.map((s) => s.reason), ["declined"]);
});

Deno.test("ДОСТУП (D024): не ответил «да» — бот не идёт, пропуск not_accepted; «да» — идёт", () => {
  for (const status of ["needsAction", "tentative"]) {
    const ev = event({
      organizer: { self: false },
      attendees: [{ email: "me@x.io", self: true, responseStatus: status }, { email: "b@x.io" }],
    });
    const { jobs, skipped } = plan([ev]);
    assertEquals(jobs, [], status);
    assertEquals(skipped.map((s) => s.reason), ["not_accepted"], status);
  }
  const yes = event({
    organizer: { self: false },
    attendees: [{ email: "me@x.io", self: true, responseStatus: "accepted" }, { email: "b@x.io" }],
  });
  assertEquals(plan([yes]).jobs.length, 1);
});

Deno.test("ДОСТУП (D024): чужое событие без строки человека — не идёт", () => {
  const ev = event({ organizer: { self: false }, attendees: [{ email: "b@x.io", responseStatus: "accepted" }] });
  assertEquals(plan([ev]).jobs, []);
  assertEquals(plan([ev]).skipped.map((s) => s.reason), ["not_accepted"]);
});

Deno.test("отклонил ДРУГОЙ участник — не повод не идти", () => {
  const ev = event({ attendees: [{ email: "me@x.io", self: true }, { email: "b@x.io", responseStatus: "declined" }] });
  assertEquals(plan([ev]).jobs.length, 1);
});

Deno.test("человек уже позвал бота на эту комнату руками — второго бота по календарю нет", () => {
  const { jobs, skipped } = plan([event()], new Set(["meet.google.com/abc-defg-hij"]));
  assertEquals(jobs, []);
  assertEquals(skipped.map((s) => s.reason), ["manual_invite_exists"]);
});

Deno.test("ссылка отдаётся без фрагмента — ровно та, по которой бот стучится", () => {
  const { jobs } = plan([event({ hangoutLink: `${MEET}#frag` })]);
  assertEquals(jobs[0].join_url, MEET);
});

// ── Сведение по воркспейсу ──────────────────────────────────────────────────

Deno.test("одна встреча у двух людей воркспейса — одно задание, за первого по порядку", () => {
  const a = planPersonDispatch([event()], 1, NOW, new Set());
  const b = planPersonDispatch([event()], 2, NOW, new Set());
  const merged = mergeDispatch([a, b]);
  assertEquals(merged.jobs.map((j) => j.invited_by), [1]);
});

Deno.test("сведение: одна встреча пошла заданием — пропуск той же встречи у другого (отклонил) не громкий", () => {
  const a = planPersonDispatch([event()], 1, NOW, new Set());
  const declined = event({ attendees: [{ email: "b@x.io", self: true, responseStatus: "declined" }] });
  const b = planPersonDispatch([declined], 2, NOW, new Set());
  const merged = mergeDispatch([a, b]);
  assertEquals(merged.jobs.length, 1);
  assertEquals(merged.skipped, []);
});

Deno.test("сведение: разные встречи не склеиваются, пропуски сохраняются", () => {
  const a = planPersonDispatch([event()], 1, NOW, new Set());
  const b = planPersonDispatch([event({ id: "e2", iCalUID: "uid2", hangoutLink: undefined })], 2, NOW, new Set());
  const merged = mergeDispatch([a, b]);
  assertEquals(merged.jobs.length, 1);
  assertEquals(merged.skipped.map((s) => [s.invited_by, s.reason]), [[2, "no_conference_link"]]);
});
