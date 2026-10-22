// Разбор расшифровки диктовки в поля задачи одним вызовом модели (structured output).
// Модель та же, что у извлечения задач из тезисов (EXTRACT_MODEL). Что из ответа попадёт в
// задачу, решает normalizeVoiceTask (voice-task.ts), здесь только вызов и разбор конверта.
import { externalFetch, VIA_OPENAI_CHAT } from "./external-fetch.ts";
import { EXTRACT_MODEL, type ExtractorAuth } from "./task-extract.ts";
import { openAIKeyHandle } from "./workspace-keys.ts";
import { VOICE_TASK_SCHEMA, voiceTaskPrompt } from "./voice-task.ts";
import { wrapUntrustedForModel } from "./untrusted-prompt.ts";

const MAX_TRANSCRIPT_CHARS = 4000;

/** Содержимое ответа chat/completions → объект полей; null, если ответ не разобрался. */
export function parseVoiceReply(reply: unknown): Record<string, unknown> | null {
  const content = (reply as { choices?: Array<{ message?: { content?: unknown } }> } | null)
    ?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Поля задачи из расшифровки. null — модель недоступна или ответила не JSON: вызывающий
 * не теряет диктовку, а берёт расшифровку заголовком (normalizeVoiceTask с пустым разбором).
 */
export async function parseVoiceTask(
  auth: ExtractorAuth,
  transcript: string,
  today: string,
): Promise<Record<string, unknown> | null> {
  const key = await openAIKeyHandle(auth.supabase, auth.groupId);
  const res = await externalFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.key}` },
    body: JSON.stringify({
      model: EXTRACT_MODEL,
      messages: [
        { role: "system", content: voiceTaskPrompt(today) },
        { role: "user", content: wrapUntrustedForModel(transcript.slice(0, MAX_TRANSCRIPT_CHARS)) },
      ],
      response_format: { type: "json_schema", json_schema: VOICE_TASK_SCHEMA },
      max_tokens: 400,
    }),
  }, { ...VIA_OPENAI_CHAT, usage: { purpose: "task:voice-parse" } });
  await key.noteResponse(res);
  if (!res.ok) {
    console.error(`[voice-task] разбор: модель ответила ${res.status}`);
    return null;
  }
  const parsed = parseVoiceReply(await res.json().catch(() => null));
  if (!parsed) console.error("[voice-task] разбор: ответ модели не разобрался в объект");
  return parsed;
}
