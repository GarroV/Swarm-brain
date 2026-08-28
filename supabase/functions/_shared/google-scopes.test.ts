import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CALENDAR_SCOPE, hasCalendarScope, LOGIN_SCOPES } from "./google-scopes.ts";

Deno.test("календарный scope найден среди выданных", () => {
  assertEquals(hasCalendarScope(`openid email profile ${CALENDAR_SCOPE}`), true);
  assertEquals(hasCalendarScope(CALENDAR_SCOPE), true);
});

Deno.test("человек снял галочку календаря → false, а не «наверное дали»", () => {
  assertEquals(hasCalendarScope("openid email profile"), false);
  assertEquals(hasCalendarScope(""), false);
  assertEquals(hasCalendarScope(undefined), false);
  assertEquals(hasCalendarScope(null), false);
});

Deno.test("похожий, но другой scope не считается календарным", () => {
  assertEquals(hasCalendarScope("https://www.googleapis.com/auth/calendar.events"), false);
  assertEquals(hasCalendarScope("https://www.googleapis.com/auth/calendar.readonly"), false);
  assertEquals(hasCalendarScope("calendar.events.readonly"), false);
});

Deno.test("разделители могут быть любыми пробелами и повторяться", () => {
  assertEquals(hasCalendarScope(`  openid\t${CALENDAR_SCOPE}\n `), true);
});

Deno.test("набор scope для входа включает профиль и календарь", () => {
  const parts = LOGIN_SCOPES.split(" ");
  assertEquals(parts.includes("openid"), true);
  assertEquals(parts.includes("email"), true);
  assertEquals(parts.includes("profile"), true);
  assertEquals(parts.includes(CALENDAR_SCOPE), true);
});
