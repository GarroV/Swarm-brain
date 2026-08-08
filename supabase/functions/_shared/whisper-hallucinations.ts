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
  /субтитр|продолжение следует|спасибо за просмотр|подписывайтесь|подпиш[иеё]тесь|подпишись на канал|добро пожаловать на наш канал|до новых встреч|dimatorzok|amara\.org|thank you for watching|thanks for watching|please subscribe|subscribe to (my|the|our) channel|welcome to (my|the|our) channel|subtitles by|diolch yn fawr|gracias por ver|obrigado por assistir|grazie per (aver )?guard|merci d'avoir regardé|danke f[üu]rs? zuschauen|untertitel|시청해 주셔서|ご視聴ありがとう|感谢观看|谢谢观看/i;

// Сегмент — галлюцинация, если пуст, матчит чёрный список фраз, ИЛИ это явная тишина
// (высокий no_speech_prob + низкий avg_logprob). Пороги консервативные: одни они «уверенные»
// галлюцинации не ловят (faster-whisper#621) — поэтому это лишь второй слой к чёрному списку.
// Вероятности опциональны (плоский ответ Whisper их не даёт) — тогда работает только список фраз.
export function isWhisperHallucination(text: string, noSpeechProb = 0, avgLogprob = 0): boolean {
  const t = text.trim();
  if (!t) return true;
  if (WHISPER_HALLUCINATION_RE.test(t)) return true;
  if (hasExcessiveInternalRepeat(t)) return true;
  if (noSpeechProb > 0.8 && avgLogprob < -0.5) return true;
  return false;
}

// ── Внутрисегментный повтор одной фразы ─────────────────────────────────────────
// Whisper на тишине/музыке иногда возвращает ОДИН сегмент, где короткая фраза повторена
// десятками раз («Добро пожаловать на наш канал!» ×69 в одном сегменте — инцидент
// 99d4e644). isRepeatedFiller (по массиву сегментов) и dropConsecutiveRuns (по ≥6 подряд
// идущим сегментам) это не ловят: тут ВСЁ внутри одного text-поля. Ловим язык-независимо:
// разбиваем сегмент на фразы (по . ! ? и переносам) и, если одна короткая фраза повторена
// ≥INTRA_REPEAT_MIN раз И доминирует (≥REPEAT_DOMINANCE), считаем сегмент галлюцинацией.
// Реальная речь так не выглядит (человек не повторяет одну фразу дословно 4+ раза подряд).
export const INTRA_REPEAT_MIN = 4;
export function hasExcessiveInternalRepeat(text: string): boolean {
  const parts = text.split(/[.!?\n]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (parts.length < INTRA_REPEAT_MIN) return false;
  const counts = new Map<string, number>();
  for (const p of parts) counts.set(p, (counts.get(p) ?? 0) + 1);
  let topText = "", top = 0;
  for (const [p, n] of counts) if (n > top) { top = n; topText = p; }
  if (top < INTRA_REPEAT_MIN) return false;
  if (top / parts.length < REPEAT_DOMINANCE) return false;
  if (topText.length > REPEAT_MAX_LEN) return false;
  return true;
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

// ── Схлопывание подряд идущих одинаковых коротких сегментов ─────────────────────
// Whisper на тишине залипает и штампует ОДИН токен подряд десятками на фикс. сетке
// (инцидент 564c2f73: «sviđanje»×77 по 5.00с, «ne»×9/×4 по 2.00с на молчащем микрофоне).
// isRepeatedFiller это не всегда ловит: смесь двух петель («sviđanje» 0.77 + «ne») держит
// любой одиночный токен под REPEAT_DOMINANCE. Здесь режем адресно — ЛЮБОЙ ран из ≥RUN_MIN
// подряд идущих сегментов с идентичным нормализованным коротким текстом. Реальная речь так
// не выглядит (человек не выдаёт 6+ идентичных односложных реплик подряд на ровной сетке),
// поэтому риск выкосить живое — околонулевой. Дженерик по тексту-аксессору: работает и над
// {start,end,text} (встречи), и над сырыми сегментами Whisper (голосовые бота).
export const RUN_MIN = 6;
export function dropConsecutiveRuns<T>(items: T[], getText: (x: T) => string): T[] {
  const out: T[] = [];
  let i = 0;
  while (i < items.length) {
    const key = getText(items[i]).trim().toLowerCase();
    let j = i + 1;
    while (j < items.length && getText(items[j]).trim().toLowerCase() === key) j++;
    const runLen = j - i;
    const isShortRun = key.length > 0 && key.length <= REPEAT_MAX_LEN && runLen >= RUN_MIN;
    if (!isShortRun) for (let k = i; k < j; k++) out.push(items[k]);
    i = j;
  }
  return out;
}

// ── Спам одиночных токенов по всей части ────────────────────────────────────────
// Тихий микрофон целиком галлюцинирует короткими односложными обрывками (инцидент 564c2f73:
// 100 mic-сегментов, ВСЕ односложные, ни одного из ≥3 слов). isRepeatedFiller это пропускает
// (двух-токенная смесь ниже порога доминирования). Дропаем часть целиком, если: сегментов
// ≥REPEAT_MIN, доля одиночных токенов ≥SINGLE_TOKEN_SPAM_SHARE, И НЕТ ни одного сегмента из
// ≥3 слов. Последнее — жёсткий предохранитель: в любой части с настоящим разговором есть хотя
// бы одна многословная реплика, поэтому реально говорящий микрофон целиком не выпадет.
export const SINGLE_TOKEN_MAX_LEN = 20;
export const SINGLE_TOKEN_SPAM_SHARE = 0.85;
export function isSingleTokenSpam(texts: string[]): boolean {
  const norm = texts.map((t) => t.trim()).filter(Boolean);
  if (norm.length < REPEAT_MIN) return false;
  // Есть хоть одна многословная реплика (≥3 слова) → это не сплошной спам, не трогаем часть.
  if (norm.some((t) => t.split(/\s+/).length >= 3)) return false;
  const singles = norm.filter((t) => !/\s/.test(t) && t.length <= SINGLE_TOKEN_MAX_LEN).length;
  return singles / norm.length >= SINGLE_TOKEN_SPAM_SHARE;
}
