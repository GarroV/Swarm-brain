// Тесты выбора события календаря среди перекрывающихся (Фаза A).
// Запуск: deno test supabase/functions/meeting-current/select.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { eventScore, type GEvent, pickCurrentEvent } from "./select.ts";

const NOW = Date.parse("2026-07-30T10:35:00Z");

function ev(o: {
  id: string;
  start: string;
  end: string;
  status?: string;
  transparency?: string;
  self?: string; // responseStatus текущего юзера
  organizer?: boolean;
  allDay?: boolean;
}): GEvent {
  return {
    id: o.id,
    status: o.status,
    transparency: o.transparency,
    start: o.allDay ? { date: "2026-07-30" } : { dateTime: o.start },
    end: o.allDay ? { date: "2026-07-31" } : { dateTime: o.end },
    organizer: o.organizer ? { self: true } : undefined,
    attendees: o.self ? [{ email: "me@dodobrands.io", self: true, responseStatus: o.self }] : undefined,
  };
}

const pick = (items: GEvent[]) => pickCurrentEvent(items, NOW)?.id ?? null;

Deno.test("выбирает 1:1 (accepted), а не более ранний олл-хендс (declined)", () => {
  const items = [
    ev({ id: "allhands", start: "2026-07-30T10:00:00Z", end: "2026-07-30T11:00:00Z", self: "declined" }),
    ev({ id: "oneonone", start: "2026-07-30T10:30:00Z", end: "2026-07-30T11:00:00Z", self: "accepted" }),
  ];
  assertEquals(pick(items), "oneonone");
});

Deno.test("accepted перевешивает tentative при перекрытии", () => {
  const items = [
    ev({ id: "tent", start: "2026-07-30T10:20:00Z", end: "2026-07-30T11:00:00Z", self: "tentative" }),
    ev({ id: "acc", start: "2026-07-30T10:10:00Z", end: "2026-07-30T11:00:00Z", self: "accepted" }),
  ];
  assertEquals(pick(items), "acc");
});

Deno.test("отменённое событие выкидывается", () => {
  const items = [
    ev({ id: "cancelled", start: "2026-07-30T10:00:00Z", end: "2026-07-30T11:00:00Z", self: "accepted", status: "cancelled" }),
    ev({ id: "real", start: "2026-07-30T10:30:00Z", end: "2026-07-30T11:00:00Z", self: "needsAction" }),
  ];
  assertEquals(pick(items), "real");
});

Deno.test("свободен/OOO (transparent) выкидывается", () => {
  const items = [
    ev({ id: "ooo", start: "2026-07-30T10:00:00Z", end: "2026-07-30T11:00:00Z", self: "accepted", transparency: "transparent" }),
    ev({ id: "busy", start: "2026-07-30T10:30:00Z", end: "2026-07-30T11:00:00Z", self: "needsAction" }),
  ];
  assertEquals(pick(items), "busy");
});

Deno.test("all-day событие не кандидат", () => {
  const items = [
    ev({ id: "allday", start: "", end: "", self: "accepted", allDay: true }),
    ev({ id: "timed", start: "2026-07-30T10:30:00Z", end: "2026-07-30T11:00:00Z", self: "needsAction" }),
  ];
  assertEquals(pick(items), "timed");
});

Deno.test("роль организатора — тай-брейк при равном RSVP", () => {
  const items = [
    ev({ id: "guest", start: "2026-07-30T10:00:00Z", end: "2026-07-30T11:00:00Z", self: "needsAction" }),
    ev({ id: "mine", start: "2026-07-30T10:00:00Z", end: "2026-07-30T11:00:00Z", self: "needsAction", organizer: true }),
  ];
  assertEquals(pick(items), "mine");
});

Deno.test("плотнее окно (короче + позже начато) при равном балле", () => {
  const items = [
    ev({ id: "long", start: "2026-07-30T10:00:00Z", end: "2026-07-30T11:00:00Z", self: "accepted" }),
    ev({ id: "tight", start: "2026-07-30T10:30:00Z", end: "2026-07-30T10:45:00Z", self: "accepted" }),
  ];
  assertEquals(pick(items), "tight");
});

Deno.test("нет идущих → ближайшее предстоящее", () => {
  const items = [
    ev({ id: "later", start: "2026-07-30T12:00:00Z", end: "2026-07-30T12:30:00Z", self: "accepted" }),
    ev({ id: "soon", start: "2026-07-30T10:50:00Z", end: "2026-07-30T11:00:00Z", self: "accepted" }),
  ];
  assertEquals(pick(items), "soon");
});

Deno.test("declined-но-единственное идущее всё равно берётся (не жёсткий дроп)", () => {
  const items = [
    ev({ id: "only", start: "2026-07-30T10:00:00Z", end: "2026-07-30T11:00:00Z", self: "declined" }),
  ];
  assertEquals(pick(items), "only");
});

Deno.test("пустой список → null", () => {
  assertEquals(pick([]), null);
});

Deno.test("eventScore: accepted+организатор = 5, declined = -3", () => {
  assertEquals(eventScore(ev({ id: "a", start: "2026-07-30T10:00:00Z", end: "2026-07-30T11:00:00Z", self: "accepted", organizer: true })), 5);
  assertEquals(eventScore(ev({ id: "b", start: "2026-07-30T10:00:00Z", end: "2026-07-30T11:00:00Z", self: "declined" })), -3);
});
