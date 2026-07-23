// Тесты гейта групповых чатов. Запуск: deno test supabase/functions/swarm-bot/lib/group-gate.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { gateGroupMessage } from "./group-gate.ts";

const BOT = "swarm_brain_bot";

Deno.test("болтовня в группе без обращения — игнор", () => {
  assertEquals(gateGroupMessage("коллеги, во сколько созвон?", BOT), { process: false });
});

Deno.test("пустой текст / медиа без текста — игнор", () => {
  assertEquals(gateGroupMessage(undefined, BOT), { process: false });
  assertEquals(gateGroupMessage("", BOT), { process: false });
  assertEquals(gateGroupMessage("   ", BOT), { process: false });
});

Deno.test("голая команда — обрабатываем как есть", () => {
  assertEquals(gateGroupMessage("/tasks", BOT), { process: true, text: "/tasks" });
  assertEquals(gateGroupMessage("/ask что по срокам", BOT), { process: true, text: "/ask что по срокам" });
});

Deno.test("команда с @этот_бот — обрабатываем, суффикс вырезаем", () => {
  assertEquals(gateGroupMessage(`/tasks@${BOT}`, BOT), { process: true, text: "/tasks" });
  assertEquals(gateGroupMessage(`/ask@${BOT} что по срокам`, BOT), { process: true, text: "/ask что по срокам" });
});

Deno.test("команда с @другой_бот — игнор", () => {
  assertEquals(gateGroupMessage("/tasks@other_bot", BOT), { process: false });
});

Deno.test("@упоминание бота — обрабатываем, упоминание вырезаем", () => {
  assertEquals(gateGroupMessage(`@${BOT} что по задачам на неделю?`, BOT), {
    process: true,
    text: "что по задачам на неделю?",
  });
  assertEquals(gateGroupMessage(`глянь, @${BOT}, что там по релизу`, BOT), {
    process: true,
    text: "глянь, , что там по релизу",
  });
});

Deno.test("упоминание регистронезависимо", () => {
  assertEquals(gateGroupMessage("@Swarm_Brain_Bot привет", BOT), { process: true, text: "привет" });
});

Deno.test("@упоминание другого юзера — игнор", () => {
  assertEquals(gateGroupMessage("@vasya глянь задачу", BOT), { process: false });
});

Deno.test("username-префикс другого бота не матчится (граница слова)", () => {
  assertEquals(gateGroupMessage(`@${BOT}_v2 привет`, BOT), { process: false });
});

Deno.test("username бота неизвестен (getMe упал): команды работают, mention-детект выключен", () => {
  assertEquals(gateGroupMessage("/tasks", null), { process: true, text: "/tasks" });
  // адресата команды проверить не можем — безопаснее промолчать, чем ответить на чужую
  assertEquals(gateGroupMessage("/tasks@some_bot", null), { process: false });
  assertEquals(gateGroupMessage(`@${BOT} вопрос`, null), { process: false });
});
