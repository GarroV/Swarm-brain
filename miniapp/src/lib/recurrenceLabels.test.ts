// Раннер тот же, что у request-cache.test.ts: deno test miniapp/src/lib/recurrenceLabels.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  monthlyModes,
  previewDates,
  recurrenceBadge,
  recurrenceLabel,
  recurrenceOptions,
  type RecurValue,
} from "./recurrenceLabels.ts";

const rule = (over: Partial<RecurValue> & Pick<RecurValue, "freq">): RecurValue => ({
  interval: 1,
  weekdays: null,
  setpos: null,
  ...over,
});
const ru = (v: RecurValue, due: string, anchor?: number | null) => recurrenceLabel(v, due, anchor)?.ru;
const en = (v: RecurValue, due: string, anchor?: number | null) => recurrenceLabel(v, due, anchor)?.en;

Deno.test("без срока быстрых вариантов нет — меню подставит сегодня", () => {
  assertEquals(recurrenceOptions(""), null);
  assertEquals(recurrenceOptions(null), null);
});

Deno.test("быстрые варианты считаются от срока: 26.08.2026 — среда", () => {
  const opts = recurrenceOptions("2026-08-26");
  assertEquals(opts?.map((o) => o.id), ["daily", "weekly", "monthly", "yearly"]);
  assertEquals(opts?.map((o) => o.ru), ["Каждый день", "По средам", "Каждый месяц, 26-го", "Каждый год, 26 авг"]);
  assertEquals(opts?.map((o) => o.en), ["Every day", "Every Wednesday", "Monthly on the 26th", "Every year on Aug 26"]);
});

Deno.test("женский и средний род дней недели не ломают русскую подпись", () => {
  // «Каждый суббота» — ровно та ошибка, из-за которой weekly взят дательным «по субботам».
  assertEquals(recurrenceOptions("2026-08-22")?.[1].ru, "По субботам");
  assertEquals(recurrenceOptions("2026-08-23")?.[1].ru, "По воскресеньям");
  assertEquals(recurrenceOptions("2026-08-24")?.[1].ru, "По понедельникам");
});

Deno.test("английские порядковые числа: st/nd/rd/th, включая подлые 11–13", () => {
  const e = (iso: string) => recurrenceOptions(iso)?.[2].en;
  assertEquals(e("2026-08-01"), "Monthly on the 1st");
  assertEquals(e("2026-08-02"), "Monthly on the 2nd");
  assertEquals(e("2026-08-03"), "Monthly on the 3rd");
  assertEquals(e("2026-08-11"), "Monthly on the 11th");
  assertEquals(e("2026-08-12"), "Monthly on the 12th");
  assertEquals(e("2026-08-13"), "Monthly on the 13th");
  assertEquals(e("2026-08-21"), "Monthly on the 21st");
  assertEquals(e("2026-08-22"), "Monthly on the 22nd");
  assertEquals(e("2026-08-23"), "Monthly on the 23rd");
});

// ── подписи произвольного правила (#823) ─────────────────────────────────────

Deno.test("каждые N: русские числа и английское множественное", () => {
  assertEquals(ru(rule({ freq: "daily", interval: 3 }), "2026-10-07"), "Каждые 3 дня");
  assertEquals(ru(rule({ freq: "daily", interval: 5 }), "2026-10-07"), "Каждые 5 дней");
  assertEquals(ru(rule({ freq: "daily", interval: 21 }), "2026-10-07"), "Каждый 21 день");
  assertEquals(ru(rule({ freq: "daily", interval: 11 }), "2026-10-07"), "Каждые 11 дней");
  assertEquals(en(rule({ freq: "daily", interval: 3 }), "2026-10-07"), "Every 3 days");
});

Deno.test("недели: «Каждые 2 недели», «Каждую неделю: пн, чт»", () => {
  assertEquals(ru(rule({ freq: "weekly", interval: 2 }), "2026-10-07"), "Каждые 2 недели: ср");
  assertEquals(en(rule({ freq: "weekly", interval: 2 }), "2026-10-07"), "Every 2 weeks on Wed");
  assertEquals(ru(rule({ freq: "weekly", weekdays: [1, 4] }), "2026-10-05"), "Каждую неделю: пн, чт");
  assertEquals(en(rule({ freq: "weekly", weekdays: [1, 4] }), "2026-10-05"), "Every week on Mon, Thu");
});

Deno.test("n-й день недели месяца — по родам: каждый понедельник, каждую пятницу, каждое воскресенье", () => {
  assertEquals(ru(rule({ freq: "monthly", setpos: 3 }), "2026-10-19"), "Каждый 3-й понедельник месяца");
  assertEquals(en(rule({ freq: "monthly", setpos: 3 }), "2026-10-19"), "Every 3rd Monday of the month");
  assertEquals(ru(rule({ freq: "monthly", setpos: -1 }), "2026-10-30"), "Каждую последнюю пятницу месяца");
  assertEquals(en(rule({ freq: "monthly", setpos: -1 }), "2026-10-30"), "Every last Friday of the month");
  assertEquals(ru(rule({ freq: "monthly", setpos: 1 }), "2026-10-04"), "Каждое 1-е воскресенье месяца");
  assertEquals(ru(rule({ freq: "monthly", setpos: 2 }), "2026-10-14"), "Каждую 2-ю среду месяца");
  assertEquals(ru(rule({ freq: "monthly", setpos: 3, interval: 2 }), "2026-10-21"), "Каждые 2 месяца: 3-я среда");
});

Deno.test("месяцы и годы: «Каждые 3 месяца, 15-го», «Каждый год, 7 окт»", () => {
  assertEquals(ru(rule({ freq: "monthly", interval: 3 }), "2026-10-15"), "Каждые 3 месяца, 15-го");
  assertEquals(en(rule({ freq: "monthly", interval: 3 }), "2026-10-15"), "Every 3 months on the 15th");
  assertEquals(ru(rule({ freq: "yearly" }), "2026-10-07"), "Каждый год, 7 окт");
  assertEquals(en(rule({ freq: "yearly" }), "2026-10-07"), "Every year on Oct 7");
  assertEquals(ru(rule({ freq: "yearly", interval: 2 }), "2026-10-07"), "Каждые 2 года, 7 окт");
  assertEquals(ru(rule({ freq: "yearly", interval: 5 }), "2026-10-07"), "Каждые 5 лет, 7 окт");
});

Deno.test("якорь важнее числа срока: зажатая задача ходит по 31-м и по 29 февраля", () => {
  assertEquals(ru(rule({ freq: "monthly" }), "2026-02-28", 31), "Каждый месяц, 31-го");
  assertEquals(ru(rule({ freq: "yearly" }), "2029-02-28", 29), "Каждый год, 29 фев");
  // weekly якорь не читает — ему число месяца безразлично.
  assertEquals(recurrenceOptions("2026-02-28", 31)?.[1].ru, "По субботам");
});

// ── бейдж строки задачи ──────────────────────────────────────────────────────

Deno.test("бейдж — та же подпись со строчной", () => {
  assertEquals(recurrenceBadge({ recur_freq: "daily" }, "2026-08-26"), { ru: "каждый день", en: "every day" });
  assertEquals(recurrenceBadge({ recur_freq: "weekly" }, "2026-08-26"), { ru: "по средам", en: "every Wednesday" });
  assertEquals(
    recurrenceBadge({ recur_freq: "weekly", recur_interval: 2 }, "2026-08-26"),
    { ru: "каждые 2 недели: ср", en: "every 2 weeks on Wed" },
  );
  assertEquals(
    recurrenceBadge({ recur_freq: "monthly", recur_setpos: 3 }, "2026-10-19")?.ru,
    "каждый 3-й понедельник месяца",
  );
});

Deno.test("бейдж у нерегулярной задачи отсутствует", () => {
  assertEquals(recurrenceBadge({ recur_freq: null }, "2026-08-26"), null);
});

Deno.test("бейдж без срока не падает — частота ещё осмысленна", () => {
  assertEquals(recurrenceBadge({ recur_freq: "weekly" }, null), { ru: "повторяется", en: "repeats" });
});

// ── меню правила ─────────────────────────────────────────────────────────────

Deno.test("варианты месяца от срока: число, n-й день недели, последний", () => {
  const m = monthlyModes("2026-10-19"); // 3-й понедельник октября
  assertEquals(m.map((x) => x.setpos), [null, 3, -1]);
  assertEquals(m.map((x) => x.ru), ["19-го числа", "3-й понедельник", "последний понедельник"]);
  assertEquals(m.map((x) => x.en), ["on the 19th", "3rd Monday", "last Monday"]);
});

Deno.test("5-й день недели — он же последний: варианта два, а не три одинаковых", () => {
  assertEquals(monthlyModes("2026-10-29").map((x) => x.setpos), [null, -1]); // 5-й чт
});

Deno.test("превью: три ближайшие даты после max(срок, сегодня)", () => {
  assertEquals(
    previewDates(rule({ freq: "weekly", interval: 2 }), "2026-10-07", "2026-10-07"),
    ["2026-10-21", "2026-11-04", "2026-11-18"],
  );
  assertEquals(
    previewDates(rule({ freq: "monthly", setpos: 3 }), "2026-10-19", "2026-10-07"),
    ["2026-11-16", "2026-12-21", "2027-01-18"],
  );
});
