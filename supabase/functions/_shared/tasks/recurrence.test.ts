// Запуск: deno test supabase/functions/_shared/tasks/recurrence.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildRecurPatch, nextOccurrence, recurrencePatchFor, resolveRecurrence, TASK_TZ, todayInTz, type RecurRow } from "./recurrence.ts";

// ── daily ────────────────────────────────────────────────────────────────────

Deno.test("daily: выполнено в срок — следующий день", () => {
  assertEquals(nextOccurrence("daily", null, "2026-08-26", "2026-08-26"), "2026-08-27");
});

Deno.test("daily: месяц простоя — следующий день от СЕГОДНЯ, а не от древнего срока", () => {
  // Иначе задача вынырнула бы со сроком 2026-07-02 и осталась просроченной навсегда.
  assertEquals(nextOccurrence("daily", null, "2026-07-01", "2026-08-26"), "2026-08-27");
});

// ── weekly ───────────────────────────────────────────────────────────────────

Deno.test("weekly: выполнено в срок — та же среда через неделю", () => {
  assertEquals(nextOccurrence("weekly", null, "2026-08-26", "2026-08-26"), "2026-09-02");
});

Deno.test("weekly: просрочено и выполнено в субботу — график цел, ближайшая среда", () => {
  // Решение владельца 2026-08-27: считаем ОТ ГРАФИКА, а не от даты выполнения —
  // «отчёт по средам» остаётся по средам, сколько бы раз ни опоздали.
  assertEquals(nextOccurrence("weekly", null, "2026-08-19", "2026-08-22"), "2026-08-26");
});

Deno.test("weekly: выполнено досрочно — цикл не сбивается, срок уходит на неделю вперёд", () => {
  assertEquals(nextOccurrence("weekly", null, "2026-08-26", "2026-08-24"), "2026-09-02");
});

Deno.test("weekly: переход года", () => {
  assertEquals(nextOccurrence("weekly", null, "2026-12-29", "2026-12-29"), "2027-01-05");
});

// ── monthly ──────────────────────────────────────────────────────────────────

Deno.test("monthly: то же число следующего месяца", () => {
  assertEquals(nextOccurrence("monthly", 26, "2026-08-26", "2026-08-26"), "2026-09-26");
});

Deno.test("monthly: 31-е в феврале зажимается по длине месяца", () => {
  assertEquals(nextOccurrence("monthly", 31, "2026-01-31", "2026-01-31"), "2026-02-28");
});

Deno.test("monthly: после зажатия возвращается к 31-му — anchor помнит исходное число", () => {
  // Без anchor задача залипла бы на 28-м числе навсегда.
  assertEquals(nextOccurrence("monthly", 31, "2026-02-28", "2026-02-28"), "2026-03-31");
});

Deno.test("monthly: переход года", () => {
  assertEquals(nextOccurrence("monthly", 15, "2026-12-15", "2026-12-15"), "2027-01-15");
});

Deno.test("monthly: полгода простоя — первое вхождение строго после сегодня", () => {
  assertEquals(nextOccurrence("monthly", 15, "2026-02-15", "2026-08-26"), "2026-09-15");
});

Deno.test("monthly без anchor: число берётся из срока", () => {
  // Задачи, которым цикличность включили до появления anchor'а (или через MCP без него).
  assertEquals(nextOccurrence("monthly", null, "2026-08-26", "2026-08-26"), "2026-09-26");
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
  assertEquals(nextOccurrence("hourly", null, "2026-08-26", "2026-08-26"), null);
});

// ── buildRecurPatch: что именно меняем у задачи при закрытии цикла ────────────

const rrow = (over: Partial<RecurRow> = {}): RecurRow => ({
  status: "open",
  recur_freq: "weekly",
  recur_anchor_dom: null,
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
  assertEquals(buildRecurPatch(rrow({ status: "in_progress" }), "2026-08-26")?.status, "open");
});

Deno.test("пинг взводится заново — иначе перенесённое напоминание молча не пришло бы", () => {
  assertEquals(buildRecurPatch(rrow(), "2026-08-26")?.reminded_at, null);
});

Deno.test("пинг сдвигается на ту же дельту, что и срок", () => {
  // Срок 26.08 → 02.09 (+7 дней), пинг 24.08 → 31.08. Иначе пинг остался бы в прошлом.
  const patch = buildRecurPatch(rrow({ remind_date: "2026-08-24" }), "2026-08-26");
  assertEquals(patch?.remind_date, "2026-08-31");
});

Deno.test("начало сдвигается на ту же дельту — иначе start > due и валидация упадёт", () => {
  const patch = buildRecurPatch(rrow({ start_date: "2026-08-20" }), "2026-08-26");
  assertEquals(patch?.start_date, "2026-08-27");
});

Deno.test("нет пинга и начала — не подставляем их в патч", () => {
  const patch = buildRecurPatch(rrow(), "2026-08-26");
  assertEquals("remind_date" in (patch ?? {}), false);
  assertEquals("start_date" in (patch ?? {}), false);
});

Deno.test("дельта считается от срока, даже когда закрыли с опозданием", () => {
  // Срок 19.08 просрочен, закрыли 22.08 → новый срок 26.08, дельта +7, пинг 17.08 → 24.08.
  const patch = buildRecurPatch(rrow({ due_date: "2026-08-19", remind_date: "2026-08-17" }), "2026-08-22");
  assertEquals(patch?.due_date, "2026-08-26");
  assertEquals(patch?.remind_date, "2026-08-24");
});

Deno.test("регулярная без срока — патча нет, задача просто закрывается", () => {
  assertEquals(buildRecurPatch(rrow({ due_date: null }), "2026-08-26"), null);
});

// ── календарный «сегодня» ─────────────────────────────────────────────────────

Deno.test("сегодня берётся по часовому поясу команды, а не по UTC", () => {
  // 23:30 UTC 26-го = 01:30 27-го в Белграде. По UTC перекат уехал бы на день назад.
  assertEquals(todayInTz(new Date("2026-08-26T23:30:00Z"), TASK_TZ), "2026-08-27");
});

// ── resolveRecurrence: приём цикличности из запроса (веб/бот/MCP) ─────────────

Deno.test("снятие цикличности: null гасит и частоту, и anchor", () => {
  assertEquals(resolveRecurrence(null, "2026-08-26"), { ok: true, recur_freq: null, recur_anchor_dom: null });
});

Deno.test("monthly запоминает число месяца из срока — иначе залипнет на 28-м", () => {
  assertEquals(resolveRecurrence("monthly", "2026-01-31"), { ok: true, recur_freq: "monthly", recur_anchor_dom: 31 });
});

Deno.test("weekly и daily anchor не нужен — день недели живёт в самом сроке", () => {
  assertEquals(resolveRecurrence("weekly", "2026-08-26"), { ok: true, recur_freq: "weekly", recur_anchor_dom: null });
  assertEquals(resolveRecurrence("daily", "2026-08-26"), { ok: true, recur_freq: "daily", recur_anchor_dom: null });
});

Deno.test("цикличность без срока отбивается — считать не от чего", () => {
  const r = resolveRecurrence("weekly", null);
  assertEquals(r.ok, false);
});

Deno.test("неизвестная частота отбивается, а не пишется в базу", () => {
  assertEquals(resolveRecurrence("hourly", "2026-08-26").ok, false);
});

// ── recurrencePatchFor: когда якорь пересчитывать, а когда НЕ трогать ─────────

const stored = (over: Partial<{ recur_freq: string | null; recur_anchor_dom: number | null; due_date: string | null }> = {}) => ({
  recur_freq: "monthly" as string | null,
  recur_anchor_dom: 31 as number | null,
  due_date: "2026-02-28" as string | null,
  ...over,
});

Deno.test("включили цикличность впервые — якорь выводится из срока", () => {
  const r = recurrencePatchFor("monthly", "2026-08-26", stored({ recur_freq: null, recur_anchor_dom: null, due_date: "2026-08-26" }));
  assertEquals(r, { ok: true, recur_freq: "monthly", recur_anchor_dom: 26 });
});

Deno.test("правка названия НЕ сбрасывает якорь 31 на 28 у зажатой задачи", () => {
  // Главный случай: TaskModal шлёт recur_freq и due_date при каждом автосейве. Пересчёт
  // «по любому запросу» молча сдвинул бы график с 31-го числа на 28-е — навсегда.
  const r = recurrencePatchFor("monthly", "2026-02-28", stored());
  assertEquals(r, { ok: true, recur_freq: "monthly" });
});

Deno.test("человек поменял срок — якорь идёт за новым числом", () => {
  const r = recurrencePatchFor("monthly", "2026-03-05", stored());
  assertEquals(r, { ok: true, recur_freq: "monthly", recur_anchor_dom: 5 });
});

Deno.test("сменили частоту — якорь пересчитывается под новую", () => {
  const r = recurrencePatchFor("monthly", "2026-02-28", stored({ recur_freq: "weekly", recur_anchor_dom: null }));
  assertEquals(r, { ok: true, recur_freq: "monthly", recur_anchor_dom: 28 });
});

Deno.test("сняли цикличность — гасим и частоту, и якорь", () => {
  const r = recurrencePatchFor(null, "2026-02-28", stored());
  assertEquals(r, { ok: true, recur_freq: null, recur_anchor_dom: null });
});

Deno.test("легаси-задача без якоря получает его при первой же правке", () => {
  const r = recurrencePatchFor("monthly", "2026-02-28", stored({ recur_anchor_dom: null }));
  assertEquals(r, { ok: true, recur_freq: "monthly", recur_anchor_dom: 28 });
});

Deno.test("weekly якоря не имеет — гасим, чтобы не остался от прошлой monthly", () => {
  const r = recurrencePatchFor("weekly", "2026-02-28", stored());
  assertEquals(r, { ok: true, recur_freq: "weekly", recur_anchor_dom: null });
});

Deno.test("цикличность без срока отбивается и здесь", () => {
  assertEquals(recurrencePatchFor("weekly", null, stored()).ok, false);
});
