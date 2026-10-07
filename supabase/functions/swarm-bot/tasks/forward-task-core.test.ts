import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildDescription, forwardSenderName, isFresh, taskTitle, waitStartedAt } from "./forward-task-core.ts";
import type { TgMessage } from "../lib/types.ts";

const chat = { id: 1 };

Deno.test("forwardSenderName: человек, скрытый, канал, легаси", () => {
  assertEquals(
    forwardSenderName({ chat, forward_origin: { type: "user", sender_user: { first_name: "Иван", last_name: "Петров" } } }),
    "Иван Петров",
  );
  assertEquals(forwardSenderName({ chat, forward_origin: { type: "hidden_user", sender_user_name: "Босс" } }), "Босс");
  assertEquals(forwardSenderName({ chat, forward_origin: { type: "channel", chat: { title: "Новости" } } }), "Новости");
  assertEquals(forwardSenderName({ chat, forward_from: { username: "boss" } } as TgMessage), "@boss");
  assertEquals(forwardSenderName({ chat }), null);
});

Deno.test("buildDescription: текст, ниже — от кого", () => {
  assertEquals(buildDescription(" Подготовь отчёт ", "Иван"), "Подготовь отчёт\n\n— переслано от: Иван");
  assertEquals(buildDescription("Текст", null), "Текст");
});

Deno.test("taskTitle: первая непустая строка, длинная обрезается по слову", () => {
  assertEquals(taskTitle("\n  Срочно позвони партнёру\nдальше"), "Срочно позвони партнёру");
  const long = taskTitle("слово ".repeat(40));
  assertEquals(long.endsWith("…"), true);
  assertEquals(long.length <= 91, true);
  assertEquals(taskTitle("   "), "Задача из пересланного");
});

Deno.test("isFresh и waitStartedAt", () => {
  assertEquals(isFresh(1000, 500, 1400), true);
  assertEquals(isFresh(1000, 500, 1600), false);
  assertEquals(isFresh(waitStartedAt("мусор"), 500, 1000), false);
  assertEquals(waitStartedAt("1700000000000"), 1700000000000);
  assertEquals(Number.isNaN(waitStartedAt(undefined)), true);
});
