import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { nextDay, seriesKeyOf, sortCallTasks, suggestCountryFromTitle } from "./calendar-series.ts";

const MARKETS = ["RS", "SI", "HR", "BG", "ME"];

Deno.test("seriesKeyOf: отрезает дату экземпляра, ключ без даты не трогает", () => {
  assertEquals(
    seriesKeyOf("a00c82783fa342b998e7d064e860f80f_R20260928T120000@google.com:2026-10-26"),
    "a00c82783fa342b998e7d064e860f80f_R20260928T120000@google.com",
  );
  assertEquals(seriesKeyOf("abc@google.com"), "abc@google.com");
  assertEquals(seriesKeyOf("abc:2026-10-26:2026-10-27"), "abc:2026-10-26");
});

Deno.test("suggestCountryFromTitle: RU, EN и местные названия", () => {
  assertEquals(suggestCountryFromTitle("Синк по Сербии", MARKETS), "RS");
  assertEquals(suggestCountryFromTitle("Serbia weekly", MARKETS), "RS");
  assertEquals(suggestCountryFromTitle("Srbija ops", MARKETS), "RS");
  assertEquals(suggestCountryFromTitle("Slovenia call", MARKETS), "SI");
  assertEquals(suggestCountryFromTitle("Словения: итоги", MARKETS), "SI");
  assertEquals(suggestCountryFromTitle("Slovenija", MARKETS), "SI");
  assertEquals(suggestCountryFromTitle("Bulgaria", MARKETS), "BG");
});

Deno.test("suggestCountryFromTitle: две страны, ни одной или страна вне markets — null", () => {
  assertEquals(suggestCountryFromTitle("Сербия и Хорватия", MARKETS), null);
  assertEquals(suggestCountryFromTitle("Weekly sync", MARKETS), null);
  assertEquals(suggestCountryFromTitle("Poland launch", MARKETS), null); // PL не в markets
  assertEquals(suggestCountryFromTitle("Сербия и Польша", MARKETS), "RS"); // Польша вне markets — не мешает
});

Deno.test("sortCallTasks: просрочено, сегодня, завтра, пинг, остальные по сроку, без срока в конце", () => {
  const today = "2026-10-27";
  const tomorrow = nextDay(today);
  const t = (id: string, due: string | null, remind: string | null = null) => ({
    id,
    due_date: due,
    remind_date: remind,
    created_at: "2026-10-01",
  });
  const sorted = sortCallTasks(
    [
      t("none", null),
      t("later", "2026-11-05"),
      t("ping", "2026-12-01", "2026-10-28"),
      t("tomorrow", "2026-10-28"),
      t("today", "2026-10-27"),
      t("overdue2", "2026-10-26"),
      t("overdue1", "2026-10-20"),
      t("later2", "2026-11-01"),
    ],
    today,
    tomorrow,
  );
  assertEquals(sorted.map((x) => x.id), [
    "overdue1",
    "overdue2",
    "today",
    "tomorrow",
    "ping",
    "later2",
    "later",
    "none",
  ]);
});

Deno.test("nextDay: через границу месяца", () => {
  assertEquals(nextDay("2026-10-31"), "2026-11-01");
});
