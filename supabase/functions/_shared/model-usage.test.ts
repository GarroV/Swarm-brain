import { assertEquals } from "@std/assert";
import { costUsd, parseUsage, requestModel } from "./model-usage.ts";

Deno.test("стоимость чата: вход и выход по своим ценам", () => {
  // gpt-4o-mini: $0.15 / 1M вход, $0.60 / 1M выход
  assertEquals(
    costUsd({ model: "gpt-4o-mini", kind: "chat", promptTokens: 1_000_000, completionTokens: 1_000_000 }),
    0.75,
  );
  assertEquals(costUsd({ model: "gpt-4o", kind: "chat", promptTokens: 2000, completionTokens: 500 }), 0.01);
});

Deno.test("стоимость эмбеддинга и транскрибации", () => {
  assertEquals(costUsd({ model: "text-embedding-3-small", kind: "embedding", promptTokens: 500_000 }), 0.01);
  // whisper-1: $0.006 за минуту
  assertEquals(costUsd({ model: "whisper-1", kind: "transcription", audioSeconds: 90 }), 0.009);
});

Deno.test("неизвестная модель или нет длительности — стоимость не выдумываем", () => {
  assertEquals(costUsd({ model: "gpt-9-unknown", kind: "chat", promptTokens: 1000, completionTokens: 10 }), null);
  assertEquals(costUsd({ model: "whisper-1", kind: "transcription" }), null);
});

Deno.test("тезисы gpt-5.6-terra: кэшированный вход по своей цене", () => {
  // $2 / 1M вход, $0.20 / 1M из кэша, $12 / 1M выход (reasoning — внутри выхода)
  assertEquals(
    costUsd({ model: "gpt-5.6-terra", kind: "chat", promptTokens: 1_000_000, completionTokens: 1_000_000 }),
    14,
  );
  assertEquals(
    costUsd({
      model: "gpt-5.6-terra",
      kind: "chat",
      promptTokens: 1_000_000,
      cachedTokens: 500_000,
      completionTokens: 0,
    }),
    1.1,
  );
});

Deno.test("датированная версия модели считается по цене базовой", () => {
  assertEquals(
    costUsd({ model: "gpt-4o-mini-2024-07-18", kind: "chat", promptTokens: 1_000_000, completionTokens: 0 }),
    0.15,
  );
});

Deno.test("usage из ответа чата, эмбеддинга и транскрибации", () => {
  assertEquals(
    parseUsage("chat", {
      model: "gpt-4o",
      usage: {
        prompt_tokens: 10,
        prompt_tokens_details: { cached_tokens: 4 },
        completion_tokens: 3,
        completion_tokens_details: { reasoning_tokens: 2 },
      },
    }),
    { model: "gpt-4o", promptTokens: 10, cachedTokens: 4, completionTokens: 3, reasoningTokens: 2, audioSeconds: null },
  );
  assertEquals(
    parseUsage("embedding", { model: "text-embedding-3-small", usage: { prompt_tokens: 7, total_tokens: 7 } }),
    {
      model: "text-embedding-3-small",
      promptTokens: 7,
      cachedTokens: null,
      completionTokens: null,
      reasoningTokens: null,
      audioSeconds: null,
    },
  );
  assertEquals(
    parseUsage("transcription", { duration: 61.5, text: "…" }),
    {
      model: null,
      promptTokens: null,
      cachedTokens: null,
      completionTokens: null,
      reasoningTokens: null,
      audioSeconds: 61.5,
    },
  );
});

Deno.test("модель берётся из тела запроса: JSON и форма", () => {
  assertEquals(requestModel({ body: JSON.stringify({ model: "gpt-4o-mini", messages: [] }) }), "gpt-4o-mini");
  const form = new FormData();
  form.append("model", "whisper-1");
  assertEquals(requestModel({ body: form }), "whisper-1");
  assertEquals(requestModel({ body: "not json" }), null);
});
