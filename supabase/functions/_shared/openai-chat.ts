// Разбор ответа OpenAI chat/completions. Вынесен из meeting-processor ради юнит-тестов
// (meeting-processor читает env на импорте — в тестах неудобен).
//
// Зачем guard: GPT-5 (reasoning-модели) считают reasoning-токены в max_completion_tokens.
// На длинном входе модель может сжечь ВЕСЬ бюджет на reasoning и вернуть content=""
// (finish_reason="length") — это HTTP 200 без error, и без проверки пустой ответ молча
// записался бы как готовые тезисы (инцидент 2026-07-21, встреча af86df08: 100k-символьная
// стенограмма → draft_notes_md=""). Пустой content = сбой вызова: бросаем, чтобы сработал
// фолбэк на запасную модель в chatComplete.

interface ChatChoice {
  message?: { content?: string | null };
  finish_reason?: string;
}

export function extractChatContent(data: unknown, model: string): string {
  const d = data as { choices?: ChatChoice[]; usage?: unknown };
  const choice = d.choices?.[0];
  const content = (choice?.message?.content ?? "").trim();
  if (!content) {
    throw new Error(
      `пустой content от ${model}: finish_reason=${choice?.finish_reason ?? "нет"}, usage=${JSON.stringify(d.usage ?? {})}`,
    );
  }
  return content;
}
