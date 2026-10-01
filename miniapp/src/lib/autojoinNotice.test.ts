import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { autojoinNotice } from "./autojoinNotice.ts";

const NOW = Date.parse("2026-10-01T08:00:00Z");
const empty = { meetings: 0, events: 0, next: null };

Deno.test("нет календаря и пропавший доступ — предупреждение с кнопкой подключить", () => {
  for (const status of ["not_connected", "no_access"] as const) {
    const n = autojoinNotice({ status, ...empty }, "ru", NOW);
    assertEquals([n.tone, n.connect], ["warn", true]);
    assertStringIncludes(n.text, "Календарь не подключён");
    assertEquals(autojoinNotice({ status, ...empty }, "en", NOW).connect, true);
  }
});

Deno.test("Google не ответил — без призыва переподключаться", () => {
  const n = autojoinNotice({ status: "unavailable", ...empty }, "ru", NOW);
  assertEquals([n.tone, n.connect], ["soft", false]);
});

Deno.test("доступ есть, встреч нет — мягко, без кнопки", () => {
  const n = autojoinNotice({ status: "no_meetings", ...empty, events: 2 }, "ru", NOW);
  assertEquals([n.tone, n.connect], ["soft", false]);
  assertStringIncludes(n.text, "нет встреч со ссылкой на звонок");
});

Deno.test("встречи есть — число с правильным словом и ближайшая", () => {
  const next = { title: "Weekly", starts_at: "2026-10-01T09:00:00Z", platform: "meet" };
  const one = autojoinNotice({ status: "ok", meetings: 1, events: 1, next }, "ru", NOW);
  assertEquals(one.tone, "ok");
  assertStringIncludes(one.text, "Бот видит 1 встречу на неделю");
  assertStringIncludes(one.text, "«Weekly»");
  assertStringIncludes(autojoinNotice({ status: "ok", meetings: 3, events: 3, next }, "ru", NOW).text, "3 встречи");
  assertStringIncludes(autojoinNotice({ status: "ok", meetings: 11, events: 11, next }, "ru", NOW).text, "11 встреч");
  assertStringIncludes(autojoinNotice({ status: "ok", meetings: 2, events: 2, next }, "en", NOW).text, "2 meetings");
});
