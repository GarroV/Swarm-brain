import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isEditEntryCommand } from "./intent.ts";

Deno.test("isEditEntryCommand: команды-инструкции с записью → true", () => {
  const commands = [
    "замени эту форму на https://pyrus.com/t#uf714369", // реальный провалившийся кейс
    "Замени форму на https://example.com",
    "заменить ссылку",
    "обнови ссылку на дашборд https://x.io",
    "обновить запись про форму",
    "удали эту запись",
    "удалить запись про форму",
    "измени дату встречи",
    "поменяй ссылку на актуальную",
    "переименуй запись",
    "исправь заголовок",
    "отмени сохранение",
    "перенеси в общую базу",
  ];
  for (const text of commands) {
    assertEquals(isEditEntryCommand(text), true, `должно быть командой: "${text}"`);
  }
});

Deno.test("isEditEntryCommand: легитимные сейвы и вопросы → false", () => {
  const saves = [
    "https://pyrus.com/t#uf714369", // голая ссылка
    "статья про Postgres https://pg.io", // ссылка с описанием-заголовком
    "форма запроса доступа https://pyrus.com/t#uf714369",
    "добавь в базу: https://example.com",
    "сохрани https://example.com",
    "дай ссылку на форму", // вопрос-поиск, не команда
    "что это https://example.com",
    "заменитель сахара полезен?", // не должно ловить «замени» как префикс слова
    "обновление вышло вчера", // «обнови» не должно ловить «обновление»
    "удалённая команда работает", // «удали» не должно ловить «удалённая»
  ];
  for (const text of saves) {
    assertEquals(isEditEntryCommand(text), false, `НЕ должно быть командой: "${text}"`);
  }
});
