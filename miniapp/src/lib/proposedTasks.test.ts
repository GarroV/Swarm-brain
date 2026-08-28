// Раннер тот же, что у quickAddTask.test.ts и edge-функций: deno test miniapp/src/lib/proposedTasks.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { effectiveAssigneeId, normalizeProposedTask, normalizeProposedTasks, resolveAssigneeId, taskCountLabel } from "./proposedTasks.ts";

const USERS = [
  { telegram_id: 744230399, name: "Vasiliy Garro", username: "garro" },
  { telegram_id: 100, name: "Мария Иванова", username: null },
  { telegram_id: 200, name: "Пётр Смирнов", username: "petr_s" },
  { telegram_id: 300, name: "Пётр Ковалёв", username: null },
];

// ── Нормализация ответа GPT ───────────────────────────────────────────────────
// Issue #125: промпт просит «... или null», модель пишет СТРОКУ "null" — и на карточке
// разбора висел серый чип «null» вместо страны.

Deno.test("строковый \"null\" от GPT становится настоящим null", () => {
  const t = normalizeProposedTask({
    title: "Проверить поставщиков",
    description: "null",
    assignee: "null",
    due_date: "null",
    country: "null",
  });
  assertEquals(t, { title: "Проверить поставщиков", description: null, assignee: null, due_date: null, country: null });
});

Deno.test("пустышки в любом регистре и виде тоже гасятся", () => {
  for (const junk of ["NULL", " null ", "none", "None", "", "   ", "-", "—", "n/a", "N/A", "undefined"]) {
    assertEquals(normalizeProposedTask({ title: "T", country: junk }).country, null, `не погашено: ${JSON.stringify(junk)}`);
  }
});

Deno.test("настоящие значения не трогаются, только обрезаются пробелы", () => {
  const t = normalizeProposedTask({
    title: "  Найти замену маскарпоне  ",
    description: " Поставщик сорвал поставку ",
    assignee: " Vasiliy Garro ",
    due_date: "2026-08-29",
    country: "RS",
  });
  assertEquals(t.title, "Найти замену маскарпоне");
  assertEquals(t.description, "Поставщик сорвал поставку");
  assertEquals(t.assignee, "Vasiliy Garro");
  assertEquals(t.due_date, "2026-08-29");
  assertEquals(t.country, "RS");
});

Deno.test("описание-дубль заголовка выбрасывается — в разборе от него ноль пользы", () => {
  const t = normalizeProposedTask({ title: "Разобраться с Wolt Drive", description: "разобраться с wolt drive" });
  assertEquals(t.description, null);
});

Deno.test("задачи без заголовка в разбор не попадают", () => {
  const list = normalizeProposedTasks([
    { title: "Живая задача" },
    { title: "   " },
    { title: "null" },
    { title: "Вторая живая" },
  ]);
  assertEquals(list.map((t) => t.title), ["Живая задача", "Вторая живая"]);
});

Deno.test("не массив на входе — пустой разбор, а не падение", () => {
  assertEquals(normalizeProposedTasks(null), []);
  assertEquals(normalizeProposedTasks(undefined), []);
  assertEquals(normalizeProposedTasks("не массив"), []);
});

// ── Резолв исполнителя ────────────────────────────────────────────────────────
// Issue #126: GPT отдаёт ИМЯ, а задаче нужен telegram_id. Не совпало — «Не назначен»,
// исполнителя не выдумываем.

Deno.test("полное имя резолвится в telegram_id без оглядки на регистр и пробелы", () => {
  assertEquals(resolveAssigneeId("  vasiliy   garro ", USERS), 744230399);
  assertEquals(resolveAssigneeId("Мария Иванова", USERS), 100);
});

Deno.test("username резолвится, с собакой и без", () => {
  assertEquals(resolveAssigneeId("@garro", USERS), 744230399);
  assertEquals(resolveAssigneeId("petr_s", USERS), 200);
});

Deno.test("одно имя без фамилии резолвится, только если совпадение единственное", () => {
  assertEquals(resolveAssigneeId("Мария", USERS), 100);
  // «Пётр» — их двое: назначать наугад нельзя.
  assertEquals(resolveAssigneeId("Пётр", USERS), null);
});

Deno.test("незнакомое имя и пустой ввод исполнителя не дают", () => {
  assertEquals(resolveAssigneeId("Кто-то Посторонний", USERS), null);
  assertEquals(resolveAssigneeId(null, USERS), null);
  assertEquals(resolveAssigneeId("", USERS), null);
  assertEquals(resolveAssigneeId("Vasiliy Garro", []), null);
});

// ── Числительное на главной кнопке ────────────────────────────────────────────

Deno.test("«Добавить N задач» склоняется по-русски", () => {
  assertEquals(taskCountLabel(1), "1 задачу");
  assertEquals(taskCountLabel(2), "2 задачи");
  assertEquals(taskCountLabel(4), "4 задачи");
  assertEquals(taskCountLabel(5), "5 задач");
  assertEquals(taskCountLabel(11), "11 задач");
  assertEquals(taskCountLabel(21), "21 задачу");
  assertEquals(taskCountLabel(0), "0 задач");
});

// ── Кому уйдёт задача при публикации ─────────────────────────────────────────
// Прод-инцидент 28.08.2026: коллега разобрала встречу, нажала «Добавить» — задачи легли
// БЕЗ исполнителя и без срока (модель не назвала ответственного). В «Сегодня» их нет
// (список требует срок), в группировке по сотрудникам — нет её секции: человек решил, что
// задачи не сохранились. Правило: ответственного не назвали — задача остаётся на том, кто
// её публикует; назвали чужое/неизвестное имя — по-прежнему никого не выдумываем.

Deno.test("исполнитель не назван — задача остаётся на публикующем", () => {
  assertEquals(effectiveAssigneeId(null, USERS, 326345803), 326345803);
  assertEquals(effectiveAssigneeId("", USERS, 326345803), 326345803);
  assertEquals(effectiveAssigneeId("   ", USERS, 326345803), 326345803);
});

Deno.test("названный исполнитель важнее публикующего", () => {
  assertEquals(effectiveAssigneeId("Мария Иванова", USERS, 326345803), 100);
  assertEquals(effectiveAssigneeId("@garro", USERS, 326345803), 744230399);
});

Deno.test("названо чужое или неоднозначное имя — исполнителя не выдумываем", () => {
  assertEquals(effectiveAssigneeId("Илья Голдин", USERS, 326345803), null);
  assertEquals(effectiveAssigneeId("Пётр", USERS, 326345803), null);
});

Deno.test("личность публикующего неизвестна — поведение как раньше", () => {
  assertEquals(effectiveAssigneeId(null, USERS, null), null);
  assertEquals(effectiveAssigneeId("Мария Иванова", USERS, null), 100);
});
