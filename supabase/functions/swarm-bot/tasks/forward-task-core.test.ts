import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildDescription,
  draftFromModel,
  fallbackTitle,
  forwardSenderName,
  isFresh,
  parseState,
} from "./forward-task-core.ts";
import type { TgMessage } from "../lib/types.ts";

const chat = { id: 1 };

Deno.test("forwardSenderName: человек, скрытый, канал, легаси", () => {
  assertEquals(
    forwardSenderName({
      chat,
      forward_origin: { type: "user", sender_user: { first_name: "Иван", last_name: "Петров" } },
    }),
    "Иван Петров",
  );
  assertEquals(forwardSenderName({ chat, forward_origin: { type: "hidden_user", sender_user_name: "Босс" } }), "Босс");
  assertEquals(forwardSenderName({ chat, forward_origin: { type: "channel", chat: { title: "Новости" } } }), "Новости");
  assertEquals(forwardSenderName({ chat, forward_from: { username: "boss" } } as TgMessage), "@boss");
  assertEquals(forwardSenderName({ chat }), null);
});

Deno.test("buildDescription: текст, затем откуда и комментарий", () => {
  assertEquals(
    buildDescription(" Подготовь отчёт ", "Иван", "до пятницы"),
    "Подготовь отчёт\n\n—\nПереслано от: Иван\nКомментарий: до пятницы",
  );
  assertEquals(buildDescription("Текст", null, ""), "Текст");
});

Deno.test("draftFromModel: ответ модели и срок через нормализацию", () => {
  assertEquals(
    draftFromModel('{"title":"Подготовить отчёт","assignee":"Ксении","due_date":"2026-10-10"}', "x", "2026-10-07"),
    { title: "Подготовить отчёт", assignee: "Ксении", dueDate: "2026-10-10" },
  );
});

Deno.test("draftFromModel: битый ответ — название из текста, срок по умолчанию", () => {
  assertEquals(draftFromModel("не json", "\n Срочно позвони партнёру\nдальше", "2026-10-07"), {
    title: "Срочно позвони партнёру",
    assignee: null,
    dueDate: null,
  });
  assertEquals(draftFromModel('{"title":"","due_date":"когда-нибудь"}', "Текст", "2026-10-07").dueDate, null);
});

Deno.test("fallbackTitle: длинная строка обрезается по слову", () => {
  const t = fallbackTitle("слово ".repeat(40));
  assertEquals(t.endsWith("…"), true);
  assertEquals(t.length <= 91, true);
});

Deno.test("isFresh и parseState", () => {
  assertEquals(isFresh(1000, 500, 1400), true);
  assertEquals(isFresh(1000, 500, 1600), false);
  assertEquals(isFresh(NaN, 500, 1000), false);
  assertEquals(parseState<{ a: number }>('{"a":1}'), { a: 1 });
  assertEquals(parseState("{"), null);
  assertEquals(parseState(undefined), null);
});
