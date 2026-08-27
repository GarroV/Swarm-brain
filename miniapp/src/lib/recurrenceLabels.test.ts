// Раннер тот же, что у request-cache.test.ts: deno test miniapp/src/lib/recurrenceLabels.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { recurrenceOptions, recurrenceBadge } from "./recurrenceLabels.ts";

Deno.test("без срока вариантов цикличности нет — считать не от чего", () => {
  assertEquals(recurrenceOptions(""), null);
  assertEquals(recurrenceOptions(null), null);
});

Deno.test("подписи считаются от срока: 26.08.2026 — среда", () => {
  const opts = recurrenceOptions("2026-08-26");
  assertEquals(opts?.map((o) => o.freq), ["daily", "weekly", "monthly"]);
  assertEquals(opts?.[0].ru, "Каждый день");
  assertEquals(opts?.[0].en, "Every day");
  assertEquals(opts?.[1].ru, "По средам");
  assertEquals(opts?.[1].en, "Every Wednesday");
  assertEquals(opts?.[2].ru, "26-го числа каждый месяц");
  assertEquals(opts?.[2].en, "Monthly on the 26th");
});

Deno.test("женский и средний род дней недели не ломают русскую подпись", () => {
  // «Каждый суббота» — ровно та ошибка, из-за которой взят дательный «по субботам».
  assertEquals(recurrenceOptions("2026-08-22")?.[1].ru, "По субботам");   // сб
  assertEquals(recurrenceOptions("2026-08-23")?.[1].ru, "По воскресеньям"); // вс
  assertEquals(recurrenceOptions("2026-08-24")?.[1].ru, "По понедельникам"); // пн
});

Deno.test("английские порядковые числа: st/nd/rd/th, включая подлые 11–13", () => {
  const en = (iso: string) => recurrenceOptions(iso)?.[2].en;
  assertEquals(en("2026-08-01"), "Monthly on the 1st");
  assertEquals(en("2026-08-02"), "Monthly on the 2nd");
  assertEquals(en("2026-08-03"), "Monthly on the 3rd");
  assertEquals(en("2026-08-04"), "Monthly on the 4th");
  assertEquals(en("2026-08-11"), "Monthly on the 11th");
  assertEquals(en("2026-08-12"), "Monthly on the 12th");
  assertEquals(en("2026-08-13"), "Monthly on the 13th");
  assertEquals(en("2026-08-21"), "Monthly on the 21st");
  assertEquals(en("2026-08-22"), "Monthly on the 22nd");
  assertEquals(en("2026-08-23"), "Monthly on the 23rd");
  assertEquals(en("2026-08-31"), "Monthly on the 31st");
});

Deno.test("бейдж в строке задачи — короткий, читается без срока в кадре", () => {
  assertEquals(recurrenceBadge("daily", "2026-08-26"), { ru: "каждый день", en: "daily" });
  assertEquals(recurrenceBadge("weekly", "2026-08-26"), { ru: "по средам", en: "weekly" });
  assertEquals(recurrenceBadge("monthly", "2026-08-26"), { ru: "26-го числа", en: "monthly" });
});

Deno.test("бейдж у нерегулярной задачи отсутствует", () => {
  assertEquals(recurrenceBadge(null, "2026-08-26"), null);
});

Deno.test("бейдж без срока не падает — частота ещё осмысленна", () => {
  // Срок могли снять в базе мимо веба; показать «повторяется» лучше, чем упасть.
  assertEquals(recurrenceBadge("weekly", null), { ru: "повторяется", en: "repeats" });
});

Deno.test("monthly показывает ЯКОРЬ, а не число срока: зажатая задача ходит по 31-м", () => {
  // Срок 28.02 (зажат коротким месяцем), якорь 31. «28-го числа» было бы неправдой.
  assertEquals(recurrenceBadge("monthly", "2026-02-28", 31), { ru: "31-го числа", en: "monthly" });
  assertEquals(recurrenceOptions("2026-02-28", 31)?.[2].ru, "31-го числа каждый месяц");
  assertEquals(recurrenceOptions("2026-02-28", 31)?.[2].en, "Monthly on the 31st");
});

Deno.test("без якоря подпись берётся из срока — как было", () => {
  assertEquals(recurrenceBadge("monthly", "2026-02-28", null), { ru: "28-го числа", en: "monthly" });
  assertEquals(recurrenceOptions("2026-02-28")?.[2].ru, "28-го числа каждый месяц");
});

Deno.test("якорь не влияет на daily и weekly — им число месяца безразлично", () => {
  assertEquals(recurrenceBadge("weekly", "2026-02-28", 31), { ru: "по субботам", en: "weekly" });
  assertEquals(recurrenceOptions("2026-02-28", 31)?.[1].ru, "По субботам");
});
