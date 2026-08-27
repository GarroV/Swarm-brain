// Разбор потока chat/completions (SSE от OpenAI) на текстовые дельты.
//
// Вынесено из swarm-api отдельным модулем ровно затем, чтобы это можно было проверить тестами
// БЕЗ ключа OpenAI и без похода в сеть: формат чужой, ошибиться в нём легко, а цена ошибки —
// молчаливо пустой разбор задач у человека на экране (лист открылся, «Читаю тезисы…», и в
// конце «Задач не найдено» вместо семи задач). Фикстура в `.test.ts` повторяет реальные кадры.
//
// Обрабатывается только то, что нам нужно от протокола: строки `data: …`, служебный `[DONE]`
// и `choices[0].delta.content`. Всё остальное (keep-alive-комментарии `:`, кадр с одной ролью,
// финальный кадр с `finish_reason` и без содержимого) молча пропускается.

export type OpenAiSseChunk = {
  /** Куски текста ответа в порядке прихода. */
  deltas: string[];
  /** Недописанное событие: скормить обратно вместе со следующим куском. */
  rest: string;
  /** Пришёл `[DONE]` — дальше читать нечего. */
  done: boolean;
};

/**
 * Разобрать очередной кусок потока.
 * `alreadyDone` — поток уже закончился раньше: тогда ничего не разбираем (хвост после `[DONE]`
 * протоколом не определён, и принимать его за содержимое ответа нельзя).
 */
export function readOpenAiSseChunk(buffer: string, alreadyDone: boolean): OpenAiSseChunk {
  if (alreadyDone) return { deltas: [], rest: "", done: true };

  const deltas: string[] = [];
  let done = false;

  // События разделены пустой строкой; последнее может быть недописано — оно уходит в rest.
  const events = buffer.split("\n\n");
  const rest = events.pop() ?? "";

  for (const event of events) {
    for (const rawLine of event.split("\n")) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue; // в т.ч. keep-alive-комментарии `: ping`
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") {
        done = true;
        // Ранний выход: всё, что после [DONE], к ответу отношения не имеет.
        return { deltas, rest: "", done };
      }
      try {
        const content = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content.length > 0) deltas.push(content);
      } catch {
        // Битый кадр — пропускаем именно его, а не роняем весь разбор: одна кривая строка
        // не должна стоить человеку всех задач.
        continue;
      }
    }
  }

  return { deltas, rest, done };
}
