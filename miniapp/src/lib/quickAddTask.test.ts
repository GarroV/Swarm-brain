// Раннер тот же, что у request-cache.test.ts и edge-функций: deno test miniapp/src/lib/quickAddTask.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildQuickAddInput } from "./quickAddTask.ts";

const ME = { telegram_id: 744230399 };

Deno.test("быстрое добавление назначает задачу на меня — единый дефолт всех точек", () => {
  // Решение владельца 2026-08-27: раньше «+» на доске проектов создавал задачу БЕЗ исполнителя,
  // она уходила в линзу «Команда» и исчезала из «Моих».
  assertEquals(buildQuickAddInput("Позвонить в банк", ME)?.assignee_telegram_id, 744230399);
});

Deno.test("без опознанного пользователя исполнителя не выдумываем", () => {
  const input = buildQuickAddInput("Позвонить в банк", null);
  assertEquals(input?.title, "Позвонить в банк");
  assertEquals("assignee_telegram_id" in (input ?? {}), false);
});

Deno.test("пустой заголовок задачу не создаёт", () => {
  assertEquals(buildQuickAddInput("   ", ME), null);
  assertEquals(buildQuickAddInput("", ME), null);
});

Deno.test("заголовок обрезается по краям", () => {
  assertEquals(buildQuickAddInput("  Отчёт  ", ME)?.title, "Отчёт");
});

Deno.test("контекст доски прокидывается: статус, проект, спринт", () => {
  const input = buildQuickAddInput("Отчёт", ME, { status: "in_progress", projectId: "p1", sprintId: "s1" });
  assertEquals(input?.status, "in_progress");
  assertEquals(input?.project_id, "p1");
  assertEquals(input?.sprint_id, "s1");
});

Deno.test("в списке «Сегодня» задача получает сегодняшний срок", () => {
  assertEquals(buildQuickAddInput("Отчёт", ME, { todayISO: "2026-08-27" })?.due_date, "2026-08-27");
});

Deno.test("под активной меткой задача личная, а срок «сегодня» не подставляется", () => {
  // Метки живут только на личных задачах (API отобьёт метку на общей), и список метки — не
  // «Сегодня»: срок там был бы навязан.
  const input = buildQuickAddInput("Отчёт", ME, { todayISO: "2026-08-27", labelId: "l1" });
  assertEquals(input?.is_private, true);
  assertEquals("due_date" in (input ?? {}), false);
});

Deno.test("без контекста лишних полей не появляется", () => {
  const input = buildQuickAddInput("Отчёт", ME);
  assertEquals(Object.keys(input ?? {}).sort(), ["assignee_telegram_id", "title"]);
});
