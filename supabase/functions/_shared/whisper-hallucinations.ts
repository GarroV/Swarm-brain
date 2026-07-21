// Фильтр галлюцинаций Whisper. Единый источник для всех путей транскрибации
// (встречи — `meeting-processor.ts`, голосовые в боте — `swarm-bot/handlers/media.ts`).
//
// Whisper на тишине/шуме генерит «титры» из ютуб-обучения («Редактор субтитров … Корректор …»,
// «Продолжение следует», «Спасибо за просмотр», EN-аналоги). В реальной речи этих фраз не
// бывает, поэтому режем по подстроке (регистронезависимо). «субтитр» покрывает
// «Редактор субтитров …», «Субтитры сделал/подготовил/создавал». Источники:
// faster-whisper#621, openai/whisper#2378, whisper.cpp#2286, arxiv 2501.11378, OpenWhispr#462.
//
// Список — мультиязычный (семейство «спасибо за просмотр/подпишись» есть на многих языках, включая
// валлийское "Diolch yn fawr" из инцидента b8b7a609). Это defence-in-depth; язык-НЕЗАВИСИМЫЙ фикс —
// детектор повторов isRepeatedFiller ниже (ловит любой переведённый аутро без ведения списка).
export const WHISPER_HALLUCINATION_RE =
  /субтитр|продолжение следует|спасибо за просмотр|подписывайтесь|подпиш[иеё]тесь|подпишись на канал|до новых встреч|dimatorzok|amara\.org|thank you for watching|thanks for watching|please subscribe|subscribe to (my|the|our) channel|subtitles by|diolch yn fawr|gracias por ver|obrigado por assistir|grazie per (aver )?guard|merci d'avoir regardé|danke f[üu]rs? zuschauen|untertitel|시청해 주셔서|ご視聴ありがとう|感谢观看|谢谢观看/i;

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

// ── Язык-независимый детектор повторяющегося «аутро» тишины ─────────────────────
// Тихая дорожка часто выдаёт ОДНУ фразу-«аутро», повторённую дословно по всем сегментам части
// (в любом языке — валлийское "Diolch yn fawr", "谢谢观看" и т.д.). Реальная речь так не выглядит.
// Ловим ЯЗЫК-НЕЗАВИСИМО: если одна нормализованная строка повторяется ≥REPEAT_MIN раз И доминирует
// в части (≥REPEAT_DOMINANCE), И она короткая (≤REPEAT_MAX_LEN) — считаем часть галлюцинацией.
//
// Пороги подобраны консервативно, чтобы НЕ съесть живую короткую речь: настоящий обмен «Да.»«Да.»
// (2–4 реплики) ниже REPEAT_MIN; галлюцинация-аутро повторяется десятками по всей тихой части
// (доминирование ~1.0). Длинные осмысленные фразы (>REPEAT_MAX_LEN) не трогаем вовсе.
export const REPEAT_MIN = 5;
export const REPEAT_DOMINANCE = 0.8;
export const REPEAT_MAX_LEN = 120;

export function isRepeatedFiller(texts: string[]): boolean {
  const norm = texts.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (norm.length < REPEAT_MIN) return false;
  const counts = new Map<string, number>();
  for (const t of norm) counts.set(t, (counts.get(t) ?? 0) + 1);
  let topText = "", top = 0;
  for (const [t, n] of counts) if (n > top) { top = n; topText = t; }
  if (top < REPEAT_MIN) return false;
  if (top / norm.length < REPEAT_DOMINANCE) return false;
  if (topText.length > REPEAT_MAX_LEN) return false;
  return true;
}
