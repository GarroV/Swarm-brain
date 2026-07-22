// Тесты разбора ответа chat/completions: пустой content = сбой вызова (а не «модель промолчала»).
// Запуск: deno test supabase/functions/_shared/openai-chat.test.ts
import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractChatContent } from "./openai-chat.ts";

Deno.test("нормальный ответ — возвращает content с trim", () => {
  const data = { choices: [{ message: { content: "  ### Тезисы\n- пункт  " }, finish_reason: "stop" }] };
  assertEquals(extractChatContent(data, "gpt-5.6-terra"), "### Тезисы\n- пункт");
});

Deno.test("пустой content (reasoning сжёг весь бюджет, finish=length) — бросает с диагностикой", () => {
  const data = {
    choices: [{ message: { content: "" }, finish_reason: "length" }],
    usage: { completion_tokens: 4000, completion_tokens_details: { reasoning_tokens: 4000 } },
  };
  const err = assertThrows(() => extractChatContent(data, "gpt-5.6-terra"), Error);
  // Диагностика обязана попасть в message — иначе по логам не понять, ПОЧЕМУ пусто.
  assertEquals(err.message.includes("finish_reason=length"), true);
  assertEquals(err.message.includes("reasoning_tokens"), true);
  assertEquals(err.message.includes("gpt-5.6-terra"), true);
});

Deno.test("content = null (refusal/фильтр) — бросает", () => {
  const data = { choices: [{ message: { content: null }, finish_reason: "content_filter" }] };
  assertThrows(() => extractChatContent(data, "gpt-4o"), Error);
});

Deno.test("content из одних пробелов — бросает (иначе пустые тезисы запишутся как готовые)", () => {
  const data = { choices: [{ message: { content: "   \n " }, finish_reason: "stop" }] };
  assertThrows(() => extractChatContent(data, "gpt-4o"), Error);
});

Deno.test("нет choices вовсе — бросает, не падает на undefined", () => {
  assertThrows(() => extractChatContent({}, "gpt-4o"), Error);
});
