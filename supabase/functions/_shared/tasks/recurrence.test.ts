// Запуск: deno test supabase/functions/_shared/tasks/recurrence.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildRecurPatch,
  nextOccurrence,
  recurrenceLabelRu,
  recurrencePatchFor,
  type RecurRow,
  resolveRecurrence,
  TASK_TZ,
  todayInTz,
} from "./recurrence.ts";

// ── daily ────────────────────────────────────────────────────────────────────

Deno.test("daily: выполнено в срок — следующий день", () => {
  assertEquals(
    nextOccurrence("daily", null, "2026-08-26", "2026-08-26"),
    "2026-08-27",
  );
});

Deno.test("daily: месяц простоя — следующий день от СЕГОДНЯ, а не от древнего срока", () => {
  // Иначе задача вынырнула бы со сроком 2026-07-02 и осталась просроченной навсегда.
  assertEquals(
    nextOccurrence("daily", null, "2026-07-01", "2026-08-26"),
    "2026-08-27",
  );
});

// ── weekly ───────────────────────────────────────────────────────────────────

Deno.test("weekly: выполнено в срок — та же среда через неделю", () => {
  assertEquals(
    nextOccurrence("weekly", null, "2026-08-26", "2026-08-26"),
    "2026-09-02",
  );
});

Deno.test("weekly: просрочено и выполнено в субботу — график цел, ближайшая среда", () => {
  // Решение владельца 2026-08-27: считаем ОТ ГРАФИКА, а не от даты выполнения —
  // «отчёт по средам» остаётся по средам, сколько бы раз ни опоздали.
  assertEquals(
    nextOccurrence("weekly", null, "2026-08-19", "2026-08-22"),
    "2026-08-26",
  );
});

Deno.test("weekly: выполнено досрочно — цикл не сбивается, срок уходит на неделю вперёд", () => {
  assertEquals(
    nextOccurrence("weekly", null, "2026-08-26", "2026-08-24"),
    "2026-09-02",
  );
});

Deno.test("weekly: переход года", () => {
  assertEquals(
    nextOccurrence("weekly", null, "2026-12-29", "2026-12-29"),
    "2027-01-05",
  );
});

// ── monthly ──────────────────────────────────────────────────────────────────

Deno.test("monthly: то же число следующего месяца", () => {
  assertEquals(
    nextOccurrence("monthly", 26, "2026-08-26", "2026-08-26"),
    "2026-09-26",
  );
});

Deno.test("monthly: 31-е в феврале зажимается по длине месяца", () => {
  assertEquals(
    nextOccurrence("monthly", 31, "2026-01-31", "2026-01-31"),
    "2026-02-28",
  );
});

Deno.test("monthly: после зажатия возвращается к 31-му — anchor помнит исходное число", () => {
  // Без anchor задача залипла бы на 28-м числе навсегда.
  assertEquals(
    nextOccurrence("monthly", 31, "2026-02-28", "2026-02-28"),
    "2026-03-31",
  );
});

Deno.test("monthly: переход года", () => {
  assertEquals(
    nextOccurrence("monthly", 15, "2026-12-15", "2026-12-15"),
    "2027-01-15",
  );
});

Deno.test("monthly: полгода простоя — первое вхождение строго после сегодня", () => {
  assertEquals(
    nextOccurrence("monthly", 15, "2026-02-15", "2026-08-26"),
    "2026-09-15",
  );
});

Deno.test("monthly без anchor: число берётся из срока", () => {
  // Задачи, которым цикличность включили до появления anchor'а (или через MCP без него).
  assertEquals(
    nextOccurrence("monthly", null, "2026-08-26", "2026-08-26"),
    "2026-09-26",
  );
});

// ── не регулярная ────────────────────────────────────────────────────────────

Deno.test("нет частоты — нет следующего вхождения", () => {
  assertEquals(nextOccurrence(null, null, "2026-08-26", "2026-08-26"), null);
});

Deno.test("нет срока — считать не от чего", () => {
  assertEquals(nextOccurrence("weekly", null, null, "2026-08-26"), null);
});

Deno.test("мусор в частоте не роняет перекат", () => {
  // freq приходит из БД/MCP; неизвестное значение = задача просто закрывается как обычная.
  assertEquals(
    nextOccurrence("hourly", null, "2026-08-26", "2026-08-26"),
    null,
  );
});

// ── buildRecurPatch: что именно меняем у задачи при закрытии цикла ────────────

const rrow = (over: Partial<RecurRow> = {}): RecurRow => ({
  status: "open",
  recur_freq: "weekly",
  recur_anchor_dom: null,
  recur_interval: 1,
  recur_weekdays: null,
  recur_setpos: null,
  due_date: "2026-08-26",
  start_date: null,
  remind_date: null,
  ...over,
});

Deno.test("обычная задача — патча нет, закрывается как всегда", () => {
  assertEquals(buildRecurPatch(rrow({ recur_freq: null }), "2026-08-26"), null);
});

Deno.test("регулярная: срок уезжает вперёд, статус снова открытый — не done", () => {
  const patch = buildRecurPatch(rrow(), "2026-08-26");
  assertEquals(patch?.due_date, "2026-09-02");
  assertEquals(patch?.status, "open");
});

Deno.test("регулярная из «в работе» возвращается в «открыто» — новый цикл с нуля", () => {
  assertEquals(
    buildRecurPatch(rrow({ status: "in_progress" }), "2026-08-26")?.status,
    "open",
  );
});

Deno.test("пинг взводится заново — иначе перенесённое напоминание молча не пришло бы", () => {
  assertEquals(buildRecurPatch(rrow(), "2026-08-26")?.reminded_at, null);
});

Deno.test("пинг сдвигается на ту же дельту, что и срок", () => {
  // Срок 26.08 → 02.09 (+7 дней), пинг 24.08 → 31.08. Иначе пинг остался бы в прошлом.
  const patch = buildRecurPatch(
    rrow({ remind_date: "2026-08-24" }),
    "2026-08-26",
  );
  assertEquals(patch?.remind_date, "2026-08-31");
});

Deno.test("начало сдвигается на ту же дельту — иначе start > due и валидация упадёт", () => {
  const patch = buildRecurPatch(
    rrow({ start_date: "2026-08-20" }),
    "2026-08-26",
  );
  assertEquals(patch?.start_date, "2026-08-27");
});

Deno.test("нет пинга и начала — не подставляем их в патч", () => {
  const patch = buildRecurPatch(rrow(), "2026-08-26");
  assertEquals("remind_date" in (patch ?? {}), false);
  assertEquals("start_date" in (patch ?? {}), false);
});

Deno.test("дельта считается от срока, даже когда закрыли с опозданием", () => {
  // Срок 19.08 просрочен, закрыли 22.08 → новый срок 26.08, дельта +7, пинг 17.08 → 24.08.
  const patch = buildRecurPatch(
    rrow({ due_date: "2026-08-19", remind_date: "2026-08-17" }),
    "2026-08-22",
  );
  assertEquals(patch?.due_date, "2026-08-26");
  assertEquals(patch?.remind_date, "2026-08-24");
});

Deno.test("регулярная без срока — патча нет, задача просто закрывается", () => {
  assertEquals(buildRecurPatch(rrow({ due_date: null }), "2026-08-26"), null);
});

// ── календарный «сегодня» ─────────────────────────────────────────────────────

Deno.test("сегодня берётся по часовому поясу команды, а не по UTC", () => {
  // 23:30 UTC 26-го = 01:30 27-го в Белграде. По UTC перекат уехал бы на день назад.
  assertEquals(
    todayInTz(new Date("2026-08-26T23:30:00Z"), TASK_TZ),
    "2026-08-27",
  );
});

// ── resolveRecurrence: приём цикличности из запроса (веб/бот/MCP) ─────────────

// Новые поля правила (#823) по умолчанию: «каждый», без дней недели и n-го дня.
const DEF = { recur_interval: 1, recur_weekdays: null, recur_setpos: null };

Deno.test("снятие цикличности: null гасит и частоту, и anchor", () => {
  assertEquals(resolveRecurrence(null, "2026-08-26"), {
    ok: true,
    ...DEF,
    recur_freq: null,
    recur_anchor_dom: null,
  });
});

Deno.test("monthly запоминает число месяца из срока — иначе залипнет на 28-м", () => {
  assertEquals(resolveRecurrence("monthly", "2026-01-31"), {
    ok: true,
    ...DEF,
    recur_freq: "monthly",
    recur_anchor_dom: 31,
  });
});

Deno.test("weekly и daily anchor не нужен — день недели живёт в самом сроке", () => {
  assertEquals(resolveRecurrence("weekly", "2026-08-26"), {
    ok: true,
    ...DEF,
    recur_freq: "weekly",
    recur_anchor_dom: null,
  });
  assertEquals(resolveRecurrence("daily", "2026-08-26"), {
    ok: true,
    ...DEF,
    recur_freq: "daily",
    recur_anchor_dom: null,
  });
});

Deno.test("цикличность без срока отбивается — считать не от чего", () => {
  const r = resolveRecurrence("weekly", null);
  assertEquals(r.ok, false);
});

Deno.test("неизвестная частота отбивается, а не пишется в базу", () => {
  assertEquals(resolveRecurrence("hourly", "2026-08-26").ok, false);
});

// ── recurrencePatchFor: когда якорь пересчитывать, а когда НЕ трогать ─────────

type Stored = {
  recur_freq: string | null;
  recur_anchor_dom: number | null;
  recur_interval: number | null;
  recur_weekdays: number[] | null;
  recur_setpos: number | null;
  due_date: string | null;
};
const stored = (over: Partial<Stored> = {}): Stored => ({
  recur_freq: "monthly",
  recur_anchor_dom: 31,
  recur_interval: 1,
  recur_weekdays: null,
  recur_setpos: null,
  due_date: "2026-02-28",
  ...over,
});

Deno.test("включили цикличность впервые — якорь выводится из срока", () => {
  const r = recurrencePatchFor(
    "monthly",
    "2026-08-26",
    stored({
      recur_freq: null,
      recur_anchor_dom: null,
      due_date: "2026-08-26",
    }),
  );
  assertEquals(r, { ok: true, ...DEF, recur_freq: "monthly", recur_anchor_dom: 26 });
});

Deno.test("правка названия НЕ сбрасывает якорь 31 на 28 у зажатой задачи", () => {
  // Главный случай: TaskModal шлёт recur_freq и due_date при каждом автосейве. Пересчёт
  // «по любому запросу» молча сдвинул бы график с 31-го числа на 28-е — навсегда.
  const r = recurrencePatchFor("monthly", "2026-02-28", stored());
  assertEquals(r, { ok: true, ...DEF, recur_freq: "monthly" });
});

Deno.test("человек поменял срок — якорь идёт за новым числом", () => {
  const r = recurrencePatchFor("monthly", "2026-03-05", stored());
  assertEquals(r, { ok: true, ...DEF, recur_freq: "monthly", recur_anchor_dom: 5 });
});

Deno.test("сменили частоту — якорь пересчитывается под новую", () => {
  const r = recurrencePatchFor(
    "monthly",
    "2026-02-28",
    stored({ recur_freq: "weekly", recur_anchor_dom: null }),
  );
  assertEquals(r, { ok: true, ...DEF, recur_freq: "monthly", recur_anchor_dom: 28 });
});

Deno.test("сняли цикличность — гасим и частоту, и якорь", () => {
  const r = recurrencePatchFor(null, "2026-02-28", stored());
  assertEquals(r, { ok: true, ...DEF, recur_freq: null, recur_anchor_dom: null });
});

Deno.test("легаси-задача без якоря получает его при первой же правке", () => {
  const r = recurrencePatchFor(
    "monthly",
    "2026-02-28",
    stored({ recur_anchor_dom: null }),
  );
  assertEquals(r, { ok: true, ...DEF, recur_freq: "monthly", recur_anchor_dom: 28 });
});

Deno.test("weekly якоря не имеет — гасим, чтобы не остался от прошлой monthly", () => {
  const r = recurrencePatchFor("weekly", "2026-02-28", stored());
  assertEquals(r, { ok: true, ...DEF, recur_freq: "weekly", recur_anchor_dom: null });
});

Deno.test("цикличность без срока отбивается и здесь", () => {
  assertEquals(recurrencePatchFor("weekly", null, stored()).ok, false);
});

// ══ Произвольная повторяемость (#823): интервал, дни недели, n-й день, год ══════

const next = (
  freq: string,
  due: string,
  today: string,
  extra: {
    interval?: number | null;
    weekdays?: number[] | null;
    setpos?: number | null;
    anchorDom?: number | null;
  } = {},
) => nextOccurrence(freq, extra.anchorDom ?? null, due, today, extra);

Deno.test("daily каждые 3 дня: следующий через 3 дня от срока", () => {
  assertEquals(next("daily", "2026-10-01", "2026-10-01", { interval: 3 }), "2026-10-04");
});

Deno.test("daily каждые 3 дня с опозданием: фаза графика сохраняется", () => {
  // Вхождения 1, 4, 7, 10 окт; сегодня 8-е → 10-е, а не 11-е «от выполнения».
  assertEquals(next("daily", "2026-10-01", "2026-10-08", { interval: 3 }), "2026-10-10");
});

Deno.test("weekly каждые 2 недели: через 14 дней от срока", () => {
  assertEquals(next("weekly", "2026-10-07", "2026-10-07", { interval: 2 }), "2026-10-21");
});

Deno.test("weekly каждые 2 недели, опоздали на 3 недели: ближайшая дата той же фазы", () => {
  // Вхождения 7.10, 21.10, 4.11; сегодня 28.10 → 4.11 (не 11.11 и не 28.10+14).
  assertEquals(next("weekly", "2026-10-07", "2026-10-28", { interval: 2 }), "2026-11-04");
});

Deno.test("weekly каждые 2 недели, закрыли досрочно: цикл не сбивается", () => {
  assertEquals(next("weekly", "2026-10-21", "2026-10-15", { interval: 2 }), "2026-11-04");
});

Deno.test("weekly пн+чт: из понедельника — в четверг той же недели", () => {
  assertEquals(next("weekly", "2026-10-05", "2026-10-05", { weekdays: [1, 4] }), "2026-10-08");
  assertEquals(next("weekly", "2026-10-08", "2026-10-08", { weekdays: [1, 4] }), "2026-10-12");
});

Deno.test("weekly пн+чт каждые 2 недели: из чт — в пн через неделю-пропуск", () => {
  assertEquals(
    next("weekly", "2026-10-05", "2026-10-05", { weekdays: [1, 4], interval: 2 }),
    "2026-10-08",
  );
  assertEquals(
    next("weekly", "2026-10-08", "2026-10-08", { weekdays: [1, 4], interval: 2 }),
    "2026-10-19",
  );
});

Deno.test("weekly с днями недели: опоздание на неделю при interval=2 — следующий блок фазы", () => {
  // Блоки недель от 5.10: [5.10–11.10], [19.10–25.10]; сегодня 14.10 (вне блока) → 19.10.
  assertEquals(
    next("weekly", "2026-10-08", "2026-10-14", { weekdays: [1, 4], interval: 2 }),
    "2026-10-19",
  );
});

Deno.test("monthly 3-й понедельник: 19.10 → 16.11", () => {
  assertEquals(next("monthly", "2026-10-19", "2026-10-19", { setpos: 3 }), "2026-11-16");
});

Deno.test("monthly последняя пятница: 30.10 → 27.11", () => {
  assertEquals(next("monthly", "2026-10-30", "2026-10-30", { setpos: -1 }), "2026-11-27");
});

Deno.test("monthly 5-й четверг: в ноябре его нет — месяц пропускается, как в RRULE", () => {
  assertEquals(next("monthly", "2026-10-29", "2026-10-29", { setpos: 5 }), "2026-12-31");
});

Deno.test("monthly каждые 3 месяца 15-го: шаг от срока, опоздание держит фазу", () => {
  assertEquals(next("monthly", "2026-01-15", "2026-01-15", { interval: 3 }), "2026-04-15");
  assertEquals(next("monthly", "2026-01-15", "2026-05-01", { interval: 3 }), "2026-07-15");
});

Deno.test("yearly: 29 февраля → 28 февраля в невисокосный год", () => {
  assertEquals(next("yearly", "2028-02-29", "2028-02-29", { anchorDom: 29 }), "2029-02-28");
});

Deno.test("yearly: после зажатия возвращается на 29 февраля в високосный год", () => {
  assertEquals(next("yearly", "2031-02-28", "2031-02-28", { anchorDom: 29 }), "2032-02-29");
});

Deno.test("yearly каждые 2 года", () => {
  assertEquals(next("yearly", "2026-10-07", "2026-10-07", { interval: 2 }), "2028-10-07");
});

Deno.test("старые задачи: interval=1 и NULL в новых полях дают прежний ответ", () => {
  const cases: Array<[string, number | null, string, string]> = [
    ["daily", null, "2026-07-01", "2026-08-26"],
    ["weekly", null, "2026-08-19", "2026-08-22"],
    ["monthly", 31, "2026-02-28", "2026-02-28"],
  ];
  for (const [f, a, due, today] of cases) {
    const legacy = nextOccurrence(f, a, due, today);
    assertEquals(
      nextOccurrence(f, a, due, today, { interval: 1, weekdays: null, setpos: null }),
      legacy,
    );
    assertEquals(
      nextOccurrence(f, a, due, today, { interval: null, weekdays: null, setpos: null }),
      legacy,
    );
  }
});

Deno.test("перекат регулярной задачи учитывает интервал", () => {
  const patch = buildRecurPatch(rrow({ recur_interval: 2 }), "2026-08-26");
  assertEquals(patch?.due_date, "2026-09-09");
});

// ── приём новых полей ────────────────────────────────────────────────────────

Deno.test("дни недели нормализуются: по возрастанию, без повторов", () => {
  const r = resolveRecurrence("weekly", "2026-10-05", { recur_weekdays: [4, 1, 4] });
  assertEquals(r.ok && r.recur_weekdays, [1, 4]);
});

Deno.test("yearly запоминает число срока как якорь — для 29 февраля", () => {
  const r = resolveRecurrence("yearly", "2028-02-29");
  assertEquals(r.ok && r.recur_anchor_dom, 29);
});

Deno.test("мусор в новых полях отбивается, а не пишется в базу", () => {
  const bad: Array<[string, Record<string, unknown>]> = [
    ["weekly", { recur_interval: 0 }],
    ["weekly", { recur_interval: 100 }],
    ["weekly", { recur_interval: 1.5 }],
    ["weekly", { recur_interval: "2" }],
    ["weekly", { recur_weekdays: [0] }],
    ["weekly", { recur_weekdays: [8] }],
    ["weekly", { recur_weekdays: "1,4" }],
    ["daily", { recur_weekdays: [1] }],
    ["monthly", { recur_setpos: 6 }],
    ["monthly", { recur_setpos: 0 }],
    ["weekly", { recur_setpos: 3 }],
  ];
  for (const [f, extra] of bad) {
    assertEquals(
      resolveRecurrence(f, "2026-10-05", extra).ok,
      false,
      `${f} ${JSON.stringify(extra)}`,
    );
  }
});

Deno.test("снятие цикличности обнуляет и новые поля — централизованно", () => {
  const r = recurrencePatchFor(
    null,
    "2026-10-19",
    stored({ recur_freq: "monthly", recur_interval: 2, recur_setpos: 3 }),
    { recur_setpos: 3 },
  );
  assertEquals(r, { ok: true, ...DEF, recur_freq: null, recur_anchor_dom: null });
});

Deno.test("правка без новых полей не сбрасывает сохранённое правило", () => {
  // TaskModal старой вкладки шлёт только recur_freq — интервал и n-й день должны уцелеть.
  const r = recurrencePatchFor(
    "monthly",
    "2026-10-19",
    stored({ recur_interval: 2, recur_setpos: 3, recur_anchor_dom: 19, due_date: "2026-10-19" }),
  );
  assertEquals(r, { ok: true, recur_freq: "monthly", recur_interval: 2, recur_weekdays: null, recur_setpos: 3 });
});

Deno.test("сменили частоту без новых полей — правило берёт значения по умолчанию", () => {
  // Дни недели от weekly не должны пережить переход на monthly (CHECK-несовместимость).
  const r = recurrencePatchFor(
    "monthly",
    "2026-10-05",
    stored({
      recur_freq: "weekly",
      recur_weekdays: [1, 4],
      recur_interval: 2,
      recur_anchor_dom: null,
      due_date: "2026-10-05",
    }),
  );
  assertEquals(r, { ok: true, ...DEF, recur_freq: "monthly", recur_anchor_dom: 5 });
});

Deno.test("новые поля без частоты берут сохранённую частоту", () => {
  const r = recurrencePatchFor(
    undefined,
    "2026-10-07",
    stored({ recur_freq: "weekly", recur_anchor_dom: null, due_date: "2026-10-07" }),
    { recur_interval: 2 },
  );
  assertEquals(r, { ok: true, recur_freq: "weekly", recur_interval: 2, recur_weekdays: null, recur_setpos: null });
});

Deno.test("интервал у нерегулярной задачи без частоты — ошибка, а не молчаливый пропуск", () => {
  const r = recurrencePatchFor(
    undefined,
    "2026-10-07",
    stored({ recur_freq: null, recur_anchor_dom: null }),
    { recur_interval: 2 },
  );
  assertEquals(r.ok, false);
});

// ── подпись для бота ─────────────────────────────────────────────────────────

Deno.test("подпись бота — словами правило, тем же модулем, что веб", () => {
  const t = (over: Record<string, unknown>) =>
    recurrenceLabelRu({
      recur_freq: "weekly",
      recur_anchor_dom: null,
      recur_interval: 1,
      recur_weekdays: null,
      recur_setpos: null,
      due_date: "2026-10-07",
      ...over,
    });
  assertEquals(t({ recur_freq: "daily" }), "каждый день");
  assertEquals(t({}), "по средам");
  assertEquals(t({ recur_interval: 2 }), "каждые 2 недели: ср");
  assertEquals(t({ recur_freq: "monthly", recur_setpos: 3, due_date: "2026-10-19" }), "каждый 3-й понедельник месяца");
  assertEquals(t({ recur_freq: "yearly" }), "каждый год, 7 окт");
  assertEquals(
    t({ recur_freq: "monthly", recur_setpos: -1, due_date: "2026-10-30" }),
    "каждую последнюю пятницу месяца",
  );
  assertEquals(t({ recur_freq: null }), null);
  assertEquals(t({ recur_freq: "hourly" }), null);
});
