import { normalizeExtractedDueDate, todayIso } from "./llm-date.ts";
import { externalFetch, VIA_OPENAI_LONG } from "./external-fetch.ts";

// Вынесено из swarm-api/index.ts без изменений (issue #514): тем же экстрактором теперь
// пользуется MCP (extract_tasks_from_meeting), а копий промпта в проекте и так хватает.
// ── Извлечение задач из тезисов встречи (тот же подход, что POST /tasks/extract,
//    плюс резолв исполнителей и привязка к встрече) ───────────────────────────────
export type ExtractedTask = {
  title: string;
  description?: string | null;
  assignee?: string | null;
  due_date?: string | null;
  country?: string | null;
};

// Пустоты, которые модель выдаёт СТРОКОЙ вместо JSON null. Промпт ниже это запрещает, но
// промпт можно проигнорировать, а проверку нет: строка "null" доезжала до карточки разбора
// серым чипом «null» вместо страны (issue #125). Тот же список продублирован на клиенте
// (`miniapp/src/lib/proposedTasks.ts`) — там он страхует уже любой кривой ответ API.
export const NULLISH_FIELDS = new Set([
  "",
  "null",
  "none",
  "nil",
  "undefined",
  "n/a",
  "na",
  "-",
  "—",
  "–",
]);

export function cleanExtractedField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return NULLISH_FIELDS.has(trimmed.toLowerCase()) ? null : trimmed;
}

// Промпт и тело запроса — ОДИН источник на оба режима (обычный ответ и поток). Копий промпта
// извлечения задач в проекте и так три (бот, api, историчные дубли); четвёртая ради формата
// доставки гарантированно разошлась бы с этой.
export const EXTRACT_MODEL = "gpt-4o-mini";
export const EXTRACT_MAX_TASKS = 10;

export function extractPrompt(today: string): string {
  return `Сегодня ${today}. Извлеки задачи из тезисов встречи. Верни JSON массив (только JSON, без markdown): [{"title":"короткая формулировка действия","description":"1 фраза контекста из обсуждения: зачем/какой ожидаемый результат/важная деталь. НЕ повторяй заголовок другими словами","assignee":"полное имя ответственного","due_date":"YYYY-MM-DD","country":"ISO-код рынка, например RS"}]. Бери только реальные поручения/действия с конкретным результатом. Если задач нет — пустой массив [].\nЕсли для поля (кроме title) в тексте нет данных — ставь JSON-литерал null БЕЗ кавычек. Строка "null" запрещена: это текст, а не пустое значение, и он попадает пользователю на экран.\ndue_date: год считай от сегодняшней даты. Если в тексте назван только день и месяц («до 17 августа») — подставь ближайший подходящий год, НИКОГДА не бери год из головы. Если срок не назван — null.`;
}

export function extractRequestBody(
  text: string,
  today: string,
  stream: boolean,
): string {
  return JSON.stringify({
    model: EXTRACT_MODEL,
    messages: [
      { role: "system", content: extractPrompt(today) },
      { role: "user", content: text.slice(0, 8000) },
    ],
    max_tokens: 1200,
    ...(stream ? { stream: true } : {}),
  });
}

export function callExtractor(
  text: string,
  today: string,
  stream: boolean,
): Promise<Response> {
  return externalFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")!}`,
    },
    body: extractRequestBody(text, today, stream),
  }, VIA_OPENAI_LONG);
}

// Слой 2 поверх промпта: выдуманный моделью год и строковые «пустоты» чиним здесь — промпт
// можно проигнорировать, проверку нет. Задача без заголовка отбрасывается (возвращаем null):
// показывать и создавать там нечего.
export function toExtractedTask(
  raw: unknown,
  today: string,
): ExtractedTask | null {
  const t = (raw ?? {}) as Record<string, unknown>;
  const title = cleanExtractedField(t.title);
  if (!title) return null;
  return {
    title,
    description: cleanExtractedField(t.description),
    assignee: cleanExtractedField(t.assignee),
    due_date: normalizeExtractedDueDate(cleanExtractedField(t.due_date), today),
    country: cleanExtractedField(t.country),
  };
}

// Результат разбора. Отказ модели и «задач нет» — РАЗНЫЕ ответы (issue #374): раньше сбой
// OpenAI возвращал пустой список, и экран честно говорил «задач нет», когда модель молчала
// (так выглядел отказ 18.09.2026). Ответ, который не разбирается в список, — тоже отказ.
export type ExtractResult =
  | { ok: true; tasks: ExtractedTask[] }
  | { ok: false; reason: "upstream" | "malformed" };

/** Ответ chat/completions → задачи. Чистая функция: без сети, под тестами. */
export function parseExtractorReply(reply: unknown, today: string): ExtractResult {
  const content = (reply as { choices?: Array<{ message?: { content?: unknown } }> } | null)
    ?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return { ok: false, reason: "malformed" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, "").trim());
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!Array.isArray(parsed)) return { ok: false, reason: "malformed" };
  return {
    ok: true,
    tasks: parsed.map((item) => toExtractedTask(item, today)).filter((t): t is ExtractedTask => t !== null),
  };
}

/** Тело ответа API при отказе модели (502): EN основной, RU рядом, код для клиента. */
export const EXTRACTOR_UNAVAILABLE = {
  error: "Task extraction is unavailable right now. Try again in a minute.",
  error_ru: "Разбор задач сейчас недоступен. Попробуйте через минуту.",
  code: "extractor_unavailable",
} as const;

export async function extractTasks(text: string): Promise<ExtractResult> {
  const today = todayIso();
  const res = await callExtractor(text, today, false);
  if (!res.ok) {
    console.error(`[task-extract] модель ответила ${res.status}`);
    return { ok: false, reason: "upstream" };
  }
  const reply = await res.json().catch(() => null);
  const result = parseExtractorReply(reply, today);
  if (!result.ok) console.error("[task-extract] ответ модели не разобрался в список задач");
  return result;
}
