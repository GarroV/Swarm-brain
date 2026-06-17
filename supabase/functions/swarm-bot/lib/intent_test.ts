import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyEntryCommand, parseManageCommand, extractUrl } from "./intent.ts";

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

Deno.test("extractUrl: достаёт первый URL или null", () => {
  assertEquals(extractUrl("замени на https://pyrus.com/t#uf714369"), "https://pyrus.com/t#uf714369");
  assertEquals(extractUrl("нет ссылки тут"), null);
});
