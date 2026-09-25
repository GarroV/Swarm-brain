import { normalizeExtractedDueDate, todayIso } from "./llm-date.ts";

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
  return fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")!}`,
    },
    body: extractRequestBody(text, today, stream),
  });
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

export async function gptExtractTasks(text: string): Promise<ExtractedTask[]> {
  const today = todayIso();
  const res = await callExtractor(text, today, false);
  if (!res.ok) return [];
  try {
    const raw = (await res.json()).choices[0].message.content.replace(
      /```json\n?|\n?```/g,
      "",
    ).trim();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as unknown[])
      .map((item) => toExtractedTask(item, today))
      .filter((t): t is ExtractedTask => t !== null);
  } catch {
    return [];
  }
}
