import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { needsCalendarRepair } from "../../functions/_lib/calendar-repair.ts";

const base = { calendarGranted: true, gotRefreshToken: false, linked: false, askedRecently: false };

Deno.test("вход без токена и без привязки ведёт на согласие — иначе привязка не появится никогда (#828)", () => {
  assertEquals(needsCalendarRepair(base), true);
});

Deno.test("на согласие не ведём, когда незачем или нельзя", () => {
  assertEquals(needsCalendarRepair({ ...base, calendarGranted: false }), false, "сняли галочку");
  assertEquals(needsCalendarRepair({ ...base, gotRefreshToken: true }), false, "токен пришёл — привяжется сразу");
  assertEquals(needsCalendarRepair({ ...base, linked: true }), false, "уже привязан");
  assertEquals(needsCalendarRepair({ ...base, linked: null }), false, "не смогли проверить");
  assertEquals(needsCalendarRepair({ ...base, askedRecently: true }), false, "уже водили");
});
