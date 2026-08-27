// Раннер тот же, что у остальных edge-тестов: deno test -A supabase/functions/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readOpenAiSseChunk } from "./openai-sse.ts";

// Фикстура повторяет реальный формат стриминга chat/completions: строки `data: {…}` с
// `choices[0].delta.content`, служебные поля, финальный `data: [DONE]`.
const frame = (content: string) =>
  `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`;

Deno.test("вытаскивает content из дельт по порядку", () => {
  const r = readOpenAiSseChunk(frame("[{") + frame('"title"') + frame(':"A"}]'), false);
  assertEquals(r.deltas, ["[{", '"title"', ':"A"}]']);
  assertEquals(r.done, false);
  assertEquals(r.rest, "");
});

Deno.test("недописанное событие остаётся в хвосте до следующего куска", () => {
  const full = frame("первый") + frame("второй");
  const cut = full.length - 12;
  const a = readOpenAiSseChunk(full.slice(0, cut), false);
  assertEquals(a.deltas, ["первый"]);
  const b = readOpenAiSseChunk(a.rest + full.slice(cut), false);
  assertEquals(b.deltas, ["второй"]);
});

Deno.test("[DONE] завершает поток и не считается дельтой", () => {
  const r = readOpenAiSseChunk(frame("хвост") + "data: [DONE]\n\n", false);
  assertEquals(r.deltas, ["хвост"]);
  assertEquals(r.done, true);
});

Deno.test("первая дельта роли без content не даёт пустышку", () => {
  const roleFrame = `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" }, finish_reason: null }] })}\n\n`;
  const r = readOpenAiSseChunk(roleFrame + frame("A"), false);
  assertEquals(r.deltas, ["A"]);
});

Deno.test("финальная дельта без content (finish_reason) не роняет разбор", () => {
  const stopFrame = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`;
  const r = readOpenAiSseChunk(frame("A") + stopFrame, false);
  assertEquals(r.deltas, ["A"]);
  assertEquals(r.done, false);
});

Deno.test("битое событие пропускается, поток продолжается — один кривой кадр не должен ронять разбор", () => {
  const r = readOpenAiSseChunk(frame("A") + "data: {не json}\n\n" + frame("B"), false);
  assertEquals(r.deltas, ["A", "B"]);
});

Deno.test("комментарии keep-alive и пустые строки игнорируются", () => {
  const r = readOpenAiSseChunk(": ping\n\n" + frame("A") + "\n\n", false);
  assertEquals(r.deltas, ["A"]);
});

Deno.test("после [DONE] хвост не разбирается — поток закончен", () => {
  const r = readOpenAiSseChunk("data: [DONE]\n\n" + frame("поздний"), false);
  assertEquals(r.deltas, []);
  assertEquals(r.done, true);
});
