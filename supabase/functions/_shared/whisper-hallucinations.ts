// Фильтр галлюцинаций Whisper. Единый источник для всех путей транскрибации
// (встречи — `meeting-processor.ts`, голосовые в боте — `swarm-bot/handlers/media.ts`).
//
// Whisper на тишине/шуме генерит «титры» из ютуб-обучения («Редактор субтитров … Корректор …»,
// «Продолжение следует», «Спасибо за просмотр», EN-аналоги). В реальной речи этих фраз не
// бывает, поэтому режем по подстроке (регистронезависимо). «субтитр» покрывает
// «Редактор субтитров …», «Субтитры сделал/подготовил/создавал». Источники:
// faster-whisper#621, openai/whisper#2378, whisper.cpp#2286.
export const WHISPER_HALLUCINATION_RE =
  /субтитр|продолжение следует|спасибо за просмотр|подписывайтесь|подпиш[иеё]тесь|подпишись на канал|до новых встреч|dimatorzok|amara\.org|thank you for watching|thanks for watching|please subscribe/i;

// Сегмент — галлюцинация, если пуст, матчит чёрный список фраз, ИЛИ это явная тишина
// (высокий no_speech_prob + низкий avg_logprob). Пороги консервативные: одни они «уверенные»
// галлюцинации не ловят (faster-whisper#621) — поэтому это лишь второй слой к чёрному списку.
// Вероятности опциональны (плоский ответ Whisper их не даёт) — тогда работает только список фраз.
export function isWhisperHallucination(text: string, noSpeechProb = 0, avgLogprob = 0): boolean {
  const t = text.trim();
  if (!t) return true;
  if (WHISPER_HALLUCINATION_RE.test(t)) return true;
  if (noSpeechProb > 0.8 && avgLogprob < -0.5) return true;
  return false;
}
