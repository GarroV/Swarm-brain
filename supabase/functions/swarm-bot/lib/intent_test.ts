import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyEntryCommand, parseManageCommand, extractUrl, parseSaveCommand, parseCreateTaskCommand } from "./intent.ts";

Deno.test("parseCreateTaskCommand: создание задачи себе", () => {
  for (const [t, title] of [
    ["добавь задачу купить молоко", "купить молоко"],
    ["создай мне задачу: позвонить партнёру", "позвонить партнёру"],
    ["поставь себе задачу проверить отчёт", "проверить отчёт"],
    ["заведи задачу: отправить документы по Сербии", "отправить документы по Сербии"],
  ] as const) {
    assertEquals(parseCreateTaskCommand(t), { title, assigneeMention: null }, `create-self: "${t}"`);
  }
});

Deno.test("parseCreateTaskCommand: создание задачи на исполнителя", () => {
  assertEquals(
    parseCreateTaskCommand("поставь Ксении задачу проверить доступ"),
    { title: "проверить доступ", assigneeMention: "Ксении" },
  );
  assertEquals(
    parseCreateTaskCommand("создай для Ани задачу: подготовить пост"),
    { title: "подготовить пост", assigneeMention: "Ани" },
  );
});

Deno.test("parseCreateTaskCommand: НЕ создание → null", () => {
  for (const t of [
    "какие у меня задачи по Сербии?",  // поиск задач
    "покажи задачи команды",            // поиск
    "добавь в базу: важный факт",       // сохранение (нет слова «задачу»)
    "сохрани задачу компании на потом", // не команда создания (глагол «сохрани»)
    "создай отчёт по продажам",         // нет слова «задачу»
    "создай задачу",                    // пустой заголовок → пусть /addtask
  ]) {
    assertEquals(parseCreateTaskCommand(t), null, `not-create: "${t}"`);
  }
});

Deno.test("classifyEntryCommand: команды удаления → 'delete'", () => {
  for (const t of [
    "удали запись про форму",
    "удалить заметку",
    "убери эту ссылку",
    "сотри запись",
    "стереть это",
    "отмени сохранение про форму",
  ]) {
    assertEquals(classifyEntryCommand(t), "delete", `delete: "${t}"`);
  }
});

Deno.test("classifyEntryCommand: команды замены → 'replace'", () => {
  for (const t of [
    "замени эту форму на https://pyrus.com/t#uf714369", // реальный кейс
    "заменить ссылку",
    "поменяй ссылку на актуальную",
    "обнови ссылку на дашборд https://x.io",
    "отредактируй запись про X",
    "редактируй заметку",
  ]) {
    assertEquals(classifyEntryCommand(t), "replace", `replace: "${t}"`);
  }
});

Deno.test("classifyEntryCommand: метаданные/вопросы/обычный текст → null", () => {
  for (const t of [
    "переименуй запись", // метаданные → агент
    "измени дату встречи", // метаданные (date) → агент
    "исправь заголовок", // метаданные → агент
    "как удалить запись", // вопрос, не команда
    "заменитель сахара полезен", // не «замени» как префикс
    "обновление вышло вчера", // не «обнови»
    "удалённая работа удобна", // не «удали»
    "https://x.io", // голая ссылка → это сейв, не команда
    "добавь в базу https://x.io", // сейв
    "дай ссылку на форму", // вопрос-поиск
  ]) {
    assertEquals(classifyEntryCommand(t), null, `null: "${t}"`);
  }
});

Deno.test("parseManageCommand: тема и новое значение", () => {
  assertEquals(parseManageCommand("удали запись про форму"), {
    cmd: "delete",
    query: "форму",
    newValue: undefined,
  });
  assertEquals(parseManageCommand("замени эту форму на https://pyrus.com/t#uf714369"), {
    cmd: "replace",
    query: "форму",
    newValue: "https://pyrus.com/t#uf714369",
  });
  assertEquals(parseManageCommand("замени форму"), {
    cmd: "replace",
    query: "форму",
    newValue: undefined,
  });
  assertEquals(parseManageCommand("обнови ссылку на дашборд https://x.io"), {
    cmd: "replace",
    query: "дашборд",
    newValue: "https://x.io",
  });
  assertEquals(parseManageCommand("как удалить запись"), null);
});

Deno.test("parseSaveCommand: явный сейв → контент без префикса", () => {
  assertEquals(parseSaveCommand("сохрани: важный текст"), "важный текст");
  assertEquals(parseSaveCommand("сохрани важный текст"), "важный текст");
  assertEquals(parseSaveCommand("запомни это"), "это");
  assertEquals(parseSaveCommand("запиши: пароль 1234"), "пароль 1234");
  assertEquals(parseSaveCommand("добавь в базу: текст встречи"), "текст встречи");
  assertEquals(parseSaveCommand("запихни в улей логи"), "логи");
  assertEquals(parseSaveCommand("кинь в знания отчёт"), "отчёт");
  assertEquals(parseSaveCommand("сохрани"), ""); // только глагол → пустой контент (бот спросит текст)
});

Deno.test("parseSaveCommand: НЕ сейв → null", () => {
  for (const t of [
    "сохранил ли кто-то отчёт по Сербии", // вопрос, не «сохрани»
    "добавь задачу купить молоко", // голый «добавь» без destination → не сейв (это задача)
    "что нового по Сербии", // вопрос
    "удали запись про форму", // команда управления, не сейв
    "записаться на встречу", // не «запиши» как префикс
    "что последнее сохранили в базе", // вопрос про базу, не команда
  ]) {
    assertEquals(parseSaveCommand(t), null, `null: "${t}"`);
  }
});

Deno.test("extractUrl: достаёт первый URL или null", () => {
  assertEquals(extractUrl("замени на https://pyrus.com/t#uf714369"), "https://pyrus.com/t#uf714369");
  assertEquals(extractUrl("нет ссылки тут"), null);
});
