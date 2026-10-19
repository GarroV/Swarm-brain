// Ретрай переехал в lib/retry.ts — тот же алгоритм (3 попытки, 500 мс × 2^i),
// но общий с дневным сводом и покрытый тестами.
import { withRetry } from "./retry.ts";
import { externalFetch, VIA_OPENAI_CHAT, VIA_OPENAI_EMBEDDING } from "../../_shared/external-fetch.ts";
import { openAIKeyHandle } from "../../_shared/workspace-keys.ts";
import { supabase } from "./supabase.ts";

// Ключ — пространства, для которого зовём модель (#233): своего нет → ключ сервера. `groupId`
// обязателен: null только у служебных вызовов без пространства (тогда ключ сервера), и такое место
// называет себя явно. Ключ берётся в момент вызова, на каждую попытку ретрая.
export function getEmbedding(text: string, groupId: string | null | undefined): Promise<number[]> {
  return withRetry(async () => {
    const key = await openAIKeyHandle(supabase, groupId);
    const res = await externalFetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.key}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
    }, { ...VIA_OPENAI_EMBEDDING, usage: { purpose: "bot:embedding" } }).catch(async (e) => {
      await key.noteError(); // таймаут/обрыв — мягкий сбой ключа
      throw e;
    });
    await key.noteResponse(res);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message ?? "OpenAI embeddings error");
    return data.data[0].embedding;
  });
}

// opts.temperature — для классификаторов ставим 0 (детерминизм: иначе gpt-4o-mini на
// дефолтной 1.0 галлюцинирует, напр. подставляет знакомую страну незнакомому городу).
// opts.json — response_format json_object (промпт обязан содержать слово JSON). НЕ включать
// для summary/тезисов (там markdown, не JSON).
export function chatComplete(
  system: string,
  user: string,
  opts: { temperature?: number; json?: boolean; groupId: string | null | undefined },
): Promise<string> {
  return withRetry(async () => {
    const key = await openAIKeyHandle(supabase, opts.groupId);
    const body: Record<string, unknown> = {
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: 2000,
    };
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.json) body.response_format = { type: "json_object" };
    const res = await externalFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.key}` },
      body: JSON.stringify(body),
    }, { ...VIA_OPENAI_CHAT, usage: { purpose: "bot:chat" } }).catch(async (e) => {
      await key.noteError(); // таймаут/обрыв — мягкий сбой ключа
      throw e;
    });
    await key.noteResponse(res);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message ?? "OpenAI error");
    return data.choices[0].message.content;
  });
}
